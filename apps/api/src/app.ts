import {
  ContextInput,
  CreateSessionInput,
  DecisionRequest,
  EndSessionInput,
  ExplorationInput,
  FeedbackInput,
  FollowUpInput,
  type FollowUpResponse,
  UpdateProfileInput,
  type ContextResult,
} from '@curio/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { computePosteriors } from './engine/bandit';
import { condense, hashText, normalizeText } from './engine/context';
import { followUp } from './engine/followup';
import { computeInsights } from './engine/insights';
import { autoStatus, decide, type PipelineDeps } from './engine/pipeline';
import { bearerAuth, extensionOriginOnly, parseBody, rateLimit } from './http/middleware';

/** Without `apiToken` the API is local-only and open to the extension. */
export type AppDeps = PipelineDeps & { apiToken?: string };

export function createApp(deps: AppDeps) {
  const { store, llm } = deps;
  const rng = deps.rng ?? Math.random;
  const app = new Hono();

  app.use('*', cors({ origin: (origin) => (origin.startsWith('chrome-extension://') ? origin : null) }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error('[api]', err);
    return c.json({ error: 'internal_error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.get('/health', (c) => c.json({ ok: true }));

  const api = new Hono();
  api.use('*', extensionOriginOnly());
  if (deps.apiToken) api.use('*', bearerAuth(deps.apiToken));
  api.use('*', rateLimit(120, 60_000));
  api.use('/context', rateLimit(30, 60_000, 'context'));
  api.use('/decisions', rateLimit(30, 60_000, 'decisions'));

  api.get('/profile', async (c) => c.json(await store.getProfile()));

  api.put('/profile', async (c) => {
    const patch = await parseBody(UpdateProfileInput, c.req);
    return c.json(await store.updateProfile(patch));
  });

  api.post('/sessions', async (c) => {
    const input = await parseBody(CreateSessionInput, c.req);
    const profile = await store.getProfile();
    // Random assignment to the control arm lets us compare sessions with and without suggestions.
    const arm = rng() < profile.controlRate ? 'control' : 'suggestions';
    return c.json(await store.createSession({ ...input, arm }), 201);
  });

  api.patch('/sessions/:id/end', async (c) => {
    const input = await parseBody(EndSessionInput, c.req);
    const session = await store.endSession(c.req.param('id'), input);
    return session ? c.json(session) : c.json({ error: 'session_not_found' }, 404);
  });

  api.get('/sessions/:id/auto-status', async (c) => {
    const session = await store.getSession(c.req.param('id'));
    return session ? c.json(await autoStatus(deps, session)) : c.json({ error: 'session_not_found' }, 404);
  });

  api.post('/context', async (c) => {
    const input = await parseBody(ContextInput, c.req);
    const session = await store.getSession(input.sessionId);
    if (!session) return c.json({ error: 'session_not_found' }, 404);
    if (session.endedAt) return c.json({ error: 'session_ended' }, 409);

    const text = normalizeText(input.text);
    if (!text) return c.json({ error: 'empty_text' }, 400);
    const textHash = hashText(text);

    const existing = await store.findContext(session.id, textHash);
    if (existing) {
      return c.json({ contextId: existing.id, topic: existing.topic, summary: existing.summary, cached: true } satisfies ContextResult);
    }

    const condensed = await condense(llm, text, input.sourceType, input.title);
    const row = await store.createContext({
      sessionId: session.id,
      sourceType: input.sourceType,
      url: input.url ?? null,
      title: input.title ?? null,
      topic: condensed.topic,
      summary: condensed.summary,
      textHash,
      charCount: text.length,
    });
    return c.json({ contextId: row.id, topic: row.topic, summary: row.summary, cached: false } satisfies ContextResult);
  });

  api.post('/decisions', async (c) => {
    const req = await parseBody(DecisionRequest, c.req);
    const [session, ctx] = await Promise.all([store.getSession(req.sessionId), store.getContext(req.contextId)]);
    if (!session) return c.json({ error: 'session_not_found' }, 404);
    if (!ctx || ctx.sessionId !== session.id) return c.json({ error: 'context_not_found' }, 404);
    return c.json(await decide(deps, session, ctx, req));
  });

  api.post('/feedback', async (c) => {
    const input = await parseBody(FeedbackInput, c.req);
    const ok = await store.upsertFeedback(input.interventionId, input.value);
    return ok ? c.json({ ok: true }) : c.json({ error: 'intervention_not_found' }, 404);
  });

  api.post('/interventions/:id/save', async (c) => {
    const ok = await store.saveIntervention(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'intervention_not_found' }, 404);
  });

  api.get('/interventions/saved', async (c) => c.json(await store.listSaved()));

  api.post('/interventions/:id/more', async (c) => {
    const { question } = await parseBody(FollowUpInput, c.req);
    const detail = await store.getInterventionDetail(c.req.param('id'));
    if (!detail) return c.json({ error: 'intervention_not_found' }, 404);
    const profile = await store.getProfile();
    try {
      const { text } = await followUp(llm, detail, profile.language, question);
      // Asking for more is voluntary exploration, one of the curiosity signals worth measuring.
      await store.createExploration({
        sessionId: detail.sessionId,
        kind: 'question',
        content: question ?? `Tell me more: ${detail.text.slice(0, 160)}`,
      });
      return c.json({ text } satisfies FollowUpResponse);
    } catch (err) {
      console.warn('[followup] failed:', (err as Error).message);
      return c.json({ error: 'followup_failed' }, 502);
    }
  });

  api.post('/explorations', async (c) => {
    const input = await parseBody(ExplorationInput, c.req);
    const ok = await store.createExploration(input);
    return ok ? c.json({ ok: true }) : c.json({ error: 'session_not_found' }, 404);
  });

  api.get('/insights', async (c) => {
    const [snapshot, history] = await Promise.all([store.snapshot(), store.feedbackHistory(500)]);
    return c.json(computeInsights(snapshot, computePosteriors(history)));
  });

  app.route('/', api);
  return app;
}
