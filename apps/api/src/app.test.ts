import { DecisionResponse, Insights, Session } from '@curio/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createAssessorChain } from './engine/assessor';
import { createLlmAssessor } from './engine/assessor/llm';
import { mulberry32 } from './engine/random';
import type { JsonRequest, Llm } from './llm/types';
import { createMemoryStore } from './store/memory';

const TOKEN = 'test-token-0123456789';
const MATERIAL =
  'The derivative measures the instantaneous rate of change of a function. In machine learning, gradient descent uses derivatives to adjust the parameters of a model.';

/** Scripted LLM: answers by request name so the whole pipeline runs without a network. */
function fakeLlm(overrides: Partial<Record<string, () => unknown>> = {}): Llm & { calls: string[] } {
  const calls: string[] = [];
  const answers: Record<string, () => unknown> = {
    condense: () => ({ topic: 'Derivatives', summary: MATERIAL }),
    assess: () => ({ intervene_probability: 0.9, distraction_risk: 0.05, fitting_actions: ['real_world_use'], confidence: 0.9 }),
    generate: () => ({
      text: 'Gradient descent uses derivatives to train neural networks: each step nudges every weight downhill on the error.',
      anchor: 'gradient descent uses derivatives',
    }),
    followup: () => ({
      text: 'With gradient descent, each step moves the parameters in the direction where the error drops fastest. The derivative says which way and how far.',
    }),
    ...overrides,
  };
  return {
    calls,
    async json<T>(req: JsonRequest<T>) {
      calls.push(req.name);
      const answer = answers[req.name];
      if (!answer) throw new Error(`unexpected llm call ${req.name}`);
      return { data: req.schema.parse(answer()), usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

/** `apiToken: null` runs the API in local, token-less mode. */
function setup(llm = fakeLlm(), apiToken: string | null = TOKEN, dev = false) {
  const store = createMemoryStore();
  const app = createApp({
    store,
    llm,
    assessor: createAssessorChain([{ assessor: createLlmAssessor(llm), minConfidence: 0 }]),
    apiToken: apiToken ?? undefined,
    rng: mulberry32(42),
    dev,
  });
  const call = async (method: string, path: string, body?: unknown, token = TOKEN) => {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, store, llm, call };
}

async function startWithContext(t: ReturnType<typeof setup>, mode: 'manual' | 'occasional' = 'occasional') {
  const session = Session.parse((await t.call('POST', '/sessions', { goal: 'Understand derivatives', mode, curiosityBefore: 2, attentionBefore: 3 })).body);
  const ctx = (await t.call('POST', '/context', { sessionId: session.id, sourceType: 'selection', text: MATERIAL })).body;
  return { session, contextId: ctx.contextId as string };
}

describe('api', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('serves /health without auth and rejects bad tokens elsewhere', async () => {
    expect((await t.app.request('/health')).status).toBe(200);
    expect((await t.call('GET', '/profile', undefined, 'wrong-token-0123456789')).status).toBe(401);
  });

  it('needs no token when running locally without one', async () => {
    const local = setup(fakeLlm(), null);
    const res = await local.app.request('/profile');
    expect(res.status).toBe(200);
  });

  it('rejects requests from web pages but accepts the extension', async () => {
    const local = setup(fakeLlm(), null);
    const from = (origin: string) => local.app.request('/profile', { headers: { Origin: origin } });
    expect((await from('https://evil.example')).status).toBe(403);
    expect((await from('chrome-extension://abcdef')).status).toBe(200);
  });

  it('requires JSON bodies so cross-site form posts cannot get through', async () => {
    const res = await t.app.request('/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ mode: 'manual' }),
    });
    expect(res.status).toBe(415);
  });

  it('validates bodies', async () => {
    const res = await t.call('POST', '/sessions', { mode: 'loud' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });

  it('runs the full loop: session → context → decision → feedback → save → end → insights', async () => {
    const { session, contextId } = await startWithContext(t);

    const again = await t.call('POST', '/context', { sessionId: session.id, sourceType: 'selection', text: `  ${MATERIAL}  ` });
    expect(again.body).toMatchObject({ contextId, cached: true });

    const decision = DecisionResponse.parse(
      (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false })).body,
    );
    expect(decision.decision.action).toBe('real_world_use');
    expect(decision.decision.reasonCode).toBe('policy_selected');
    expect(decision.intervention?.text).toContain('Gradient');

    const ivId = decision.intervention!.id;
    expect((await t.call('POST', '/feedback', { interventionId: ivId, value: 'helped' })).body).toEqual({ ok: true });
    expect((await t.call('POST', `/interventions/${ivId}/save`)).status).toBe(200);
    const saved = (await t.call('GET', '/interventions/saved')).body;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: ivId, topic: 'Derivatives' });

    expect((await t.call('POST', '/explorations', { sessionId: session.id, kind: 'question', content: 'What about integrals?' })).status).toBe(200);

    const ended = (await t.call('PATCH', `/sessions/${session.id}/end`, { curiosityAfter: 4, attentionAfter: 4, distractions: 0 })).body;
    expect(ended.endedAt).not.toBeNull();

    const insights = Insights.parse((await t.call('GET', '/insights')).body);
    expect(insights.totals).toMatchObject({ sessions: 1, decisions: 1, interventions: 1, explorations: 1 });
    expect(insights.feedbackByAction.real_world_use!.helped).toBe(1);
    expect(insights.arms.suggestions).toMatchObject({ sessions: 1, rated: 1, avgCuriosity: 4, avgAttention: 4 });
    expect(insights.policy.find((p) => p.action === 'real_world_use')!.alpha).toBe(2);
  });

  it('reports whether an automatic suggestion is possible before reading a page', async () => {
    const { session, contextId } = await startWithContext(t);
    expect((await t.call('GET', `/sessions/${session.id}/auto-status`)).body).toEqual({ allowed: true, reason: null, retryInSec: null });

    await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false });
    const after = (await t.call('GET', `/sessions/${session.id}/auto-status`)).body;
    expect(after).toMatchObject({ allowed: false, reason: 'cooldown' });
    expect(after.retryInSec).toBeGreaterThan(590);
    expect((await t.call('GET', '/sessions/nope/auto-status')).status).toBe(404);
  });

  it('answers follow-ups about a suggestion and counts them as explorations', async () => {
    const { session, contextId } = await startWithContext(t, 'manual');
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'manual', mode: 'manual', paused: false })).body;
    const id = res.intervention.id;

    const more = await t.call('POST', `/interventions/${id}/more`, {});
    expect(more.status).toBe(200);
    expect(more.body.text).toContain('gradient');
    expect((await t.call('POST', `/interventions/${id}/more`, { question: 'And in neural networks?' })).status).toBe(200);
    expect((await t.store.snapshot()).explorations).toBe(2);

    expect((await t.call('POST', '/interventions/nope/more', {})).status).toBe(404);
  });

  it('returns 502 when a follow-up comes back unusable', async () => {
    t = setup(fakeLlm({ followup: () => ({ text: 'See https://example.com for more details.' }) }));
    const { session, contextId } = await startWithContext(t, 'manual');
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'manual', mode: 'manual', paused: false })).body;
    expect((await t.call('POST', `/interventions/${res.intervention.id}/more`, {})).status).toBe(502);
  });

  it('in dev mode, automatic triggers skip the cooldown and the assessor saying no', async () => {
    t = setup(fakeLlm({ assess: () => ({ intervene_probability: 0.1, distraction_risk: 0.8, fitting_actions: ['analogy'], confidence: 0.9 }) }), TOKEN, true);
    expect((await t.app.request('/health')).status).toBe(200);
    expect(await (await t.app.request('/health')).json()).toEqual({ ok: true, dev: true });

    const { session, contextId } = await startWithContext(t);
    const req = { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false };
    const first = (await t.call('POST', '/decisions', req)).body;
    expect(first.decision.reasonCode).toBe('dev:forced');
    expect(first.intervention).not.toBeNull();
    const second = (await t.call('POST', '/decisions', req)).body;
    expect(second.intervention).not.toBeNull();
    expect((await t.call('GET', `/sessions/${session.id}/auto-status`)).body.allowed).toBe(true);
  });

  it('applies cooldown to automatic triggers and logs the none decision', async () => {
    const { session, contextId } = await startWithContext(t);
    const req = { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false };
    expect((await t.call('POST', '/decisions', req)).body.intervention).not.toBeNull();

    const second = (await t.call('POST', '/decisions', req)).body;
    expect(second.decision).toMatchObject({ action: 'none', reasonCode: 'cooldown' });
    expect(second.intervention).toBeNull();
    expect((await t.store.snapshot()).decisions).toHaveLength(2);
  });

  it('serves manual requests in silence mode with the requested action, skipping the assessor', async () => {
    const { session, contextId } = await startWithContext(t, 'manual');
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'manual', mode: 'silence', paused: true, requestedAction: 'analogy' })).body;
    expect(res.decision).toMatchObject({ action: 'analogy', reasonCode: 'manual_request' });
    expect(t.llm.calls).not.toContain('assess');
  });

  it('stays silent when the assessor says it is not a good moment', async () => {
    const llm = fakeLlm({ assess: () => ({ intervene_probability: 0.1, distraction_risk: 0.8, fitting_actions: ['question'], confidence: 0.9 }) });
    t = setup(llm);
    const { session, contextId } = await startWithContext(t);
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'checkpoint', mode: 'occasional', paused: false })).body;
    expect(res.decision).toMatchObject({ action: 'none', reasonCode: 'assessor_skip:llm' });
  });

  it('regenerates once on an ungrounded draft, then stays silent', async () => {
    const llm = fakeLlm({ generate: () => ({ text: 'Integrals are the way back: what would the integral of this look like?', anchor: 'fundamental theorem of calculus' }) });
    t = setup(llm);
    const { session, contextId } = await startWithContext(t, 'manual');
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'manual', mode: 'manual', paused: false })).body;
    expect(res.decision).toMatchObject({ action: 'none', reasonCode: 'verification_failed:ungrounded_anchor' });
    expect(llm.calls.filter((c) => c === 'generate')).toHaveLength(2);
  });

  it('stays silent when the model is down', async () => {
    const llm = fakeLlm({
      assess: () => { throw new Error('down'); },
      generate: () => { throw new Error('down'); },
    });
    t = setup(llm);
    const { session, contextId } = await startWithContext(t);
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false })).body;
    expect(res.decision).toMatchObject({ action: 'none', reasonCode: 'assessor_skip:conservative' });
  });

  it('degrades context to an excerpt when condensing fails', async () => {
    t = setup(fakeLlm({ condense: () => { throw new Error('down'); } }));
    const session = (await t.call('POST', '/sessions', { mode: 'manual' })).body;
    const ctx = await t.call('POST', '/context', { sessionId: session.id, sourceType: 'web', title: 'Derivative — Wikipedia', text: MATERIAL });
    expect(ctx.status).toBe(200);
    expect(ctx.body.topic).toBe('Derivative — Wikipedia');
  });

  it('assigns the control arm by profile rate and blocks automatic suggestions there', async () => {
    await t.call('PUT', '/profile', { controlRate: 1 });
    const { session, contextId } = await startWithContext(t);
    expect(session.arm).toBe('control');
    const res = (await t.call('POST', '/decisions', { sessionId: session.id, contextId, trigger: 'selection', mode: 'occasional', paused: false })).body;
    expect(res.decision.reasonCode).toBe('control_arm');
  });

  it('rejects contexts from another session and unknown ids', async () => {
    const a = await startWithContext(t);
    const b = await startWithContext(t);
    const res = await t.call('POST', '/decisions', { sessionId: b.session.id, contextId: a.contextId, trigger: 'manual', mode: 'manual', paused: false });
    expect(res.status).toBe(404);
    expect((await t.call('POST', '/feedback', { interventionId: 'nope', value: 'helped' })).status).toBe(404);
  });
});
