import type {
  Action,
  AutoStatus,
  DecisionRequest,
  DecisionResponse,
  Session,
  StimulusAction,
  StudyContext,
} from '@curio/contracts';
import type { Llm, Usage } from '../llm/types';
import { traced } from '../observability/tracing';
import type { ContextRow, Store } from '../store/types';
import { allowedActions, POLICY_VERSION } from './actions';
import type { Assessment, Assessor } from './assessor';
import { chooseAction, computePosteriors } from './bandit';
import { generateIntervention } from './generator';
import type { Rng } from './random';
import { applyRules } from './rules';
import { verifyIntervention } from './verifier';

export type PipelineDeps = {
  store: Store;
  llm: Llm;
  assessor: Assessor;
  rng?: Rng;
  now?: () => number;
  /**
   * Development mode (CURIO_DEV): automatic triggers always produce a suggestion when possible,
   * skipping cooldowns and silence decisions. Those decisions are logged with a `dev:` reason.
   */
  dev?: boolean;
};

const FEEDBACK_WINDOW = 500;

/**
 * The deterministic part of the gate for automatic triggers, without page content.
 * Lets the extension skip reading and condensing a page when nothing could be shown anyway.
 */
export async function autoStatus(deps: Pick<PipelineDeps, 'store' | 'now' | 'dev'>, session: Session): Promise<AutoStatus> {
  const now = (deps.now ?? Date.now)();
  const [profile, lastAt, autoCount] = await Promise.all([
    deps.store.getProfile(),
    deps.store.lastInterventionAt(session.id),
    deps.store.countAutoInterventions(session.id),
  ]);
  const sinceLast = lastAt ? (now - Date.parse(lastAt)) / 1000 : Number.POSITIVE_INFINITY;
  const gate = applyRules({
    trigger: 'checkpoint',
    mode: 'occasional',
    paused: false,
    arm: session.arm,
    sessionEnded: session.endedAt !== null,
    contentChars: Number.POSITIVE_INFINITY,
    timeSinceLastSuggestionSec: sinceLast,
    autoInterventions: autoCount,
    profile,
    dev: deps.dev,
  });
  if (!gate.blocked) return { allowed: true, reason: null, retryInSec: null };
  const retryInSec = gate.reason === 'cooldown' ? Math.ceil(profile.cooldownSec - sinceLast) : null;
  return { allowed: false, reason: gate.reason, retryInSec };
}

/**
 * Order of authority: rules → assessor → bandit → LLM writes → verifier. Code keeps the final say.
 * Every exit, including `none`, is recorded so the policy can be evaluated later.
 */
export const decide = traced(
  'decide',
  async (deps: PipelineDeps, session: Session, ctx: ContextRow, req: DecisionRequest): Promise<DecisionResponse> => {
    const { store, llm } = deps;
    const now = deps.now ?? Date.now;
    const started = now();
    const timings: Record<string, number> = {};
    const usage: Record<string, Usage> = {};
    const time = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
      const t = now();
      try {
        return await fn();
      } finally {
        timings[stage] = now() - t;
      }
    };

    const manual = req.trigger === 'manual';
    const [profile, lastAt, autoCount] = await time('prepare', () =>
      Promise.all([store.getProfile(), store.lastInterventionAt(session.id), store.countAutoInterventions(session.id)]),
    );

    const context: StudyContext = {
      sessionId: session.id,
      topic: ctx.topic,
      goal: session.goal ?? undefined,
      sourceType: ctx.sourceType,
      excerptOrSummary: ctx.summary,
      interests: profile.interests,
      timeSinceLastSuggestionSec: lastAt ? (started - Date.parse(lastAt)) / 1000 : Number.POSITIVE_INFINITY,
      userPaused: req.paused,
      attentionSelfReport: req.attentionSelfReport,
    };
    const allowed = allowedActions(profile);

    let assessment: Assessment | null = null;
    let eligible: Action[] = [];
    let probabilities: Partial<Record<Action, number>> = {};

    const finish = async (action: Action, reasonCode: string, draft?: { text: string; anchor: string }) => {
      const persistStarted = now();
      const decisionId = await store.createDecision({
        sessionId: session.id,
        contextId: ctx.id,
        trigger: req.trigger,
        action,
        eligibleActions: eligible,
        probabilities,
        assessor: assessment?.source ?? null,
        assessorConfidence: assessment?.confidence ?? null,
        distractionRisk: assessment?.distractionRisk ?? null,
        policyVersion: POLICY_VERSION,
        reasonCode,
        latencyMs: now() - started,
        timings,
        usage,
      });
      const intervention =
        draft && action !== 'none'
          ? await store.createIntervention({
              decisionId,
              sessionId: session.id,
              contextId: ctx.id,
              trigger: req.trigger,
              action,
              text: draft.text,
              anchor: draft.anchor,
            })
          : null;

      // Own log line: no page or suggestion text, only what's needed to debug the policy.
      const stages = Object.entries({ ...timings, persist: now() - persistStarted })
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      console.info(
        `[decision] ${req.trigger} → ${action} (${reasonCode}) assessor=${assessment?.source ?? '-'} ${now() - started}ms [${stages}]`,
      );
      return {
        decisionId,
        decision: {
          action,
          eligibleActions: eligible,
          jevConfidence: assessment?.source === 'jev' ? assessment.confidence : undefined,
          distractionRisk: assessment?.distractionRisk,
          policyVersion: POLICY_VERSION,
          reasonCode,
        },
        intervention,
      } satisfies DecisionResponse;
    };

    // 1. Deterministic rules.
    const gate = applyRules({
      trigger: req.trigger,
      mode: req.mode,
      paused: req.paused,
      arm: session.arm,
      sessionEnded: session.endedAt !== null,
      contentChars: ctx.summary.length,
      timeSinceLastSuggestionSec: context.timeSinceLastSuggestionSec,
      autoInterventions: autoCount,
      profile,
      dev: deps.dev,
    });
    if (gate.blocked) return finish('none', gate.reason);
    const dev = deps.dev === true && !manual;
    let forced = false;

    // 2–3. Assessor filters, bandit picks. A requested action skips both.
    let action: Action;
    if (manual && req.requestedAction) {
      action = req.requestedAction;
      eligible = [action];
      probabilities = { [action]: 1 };
    } else {
      // History loads while the assessor runs; it's only needed if the assessor says go.
      const historyPromise = time('history', () => store.feedbackHistory(FEEDBACK_WINDOW));
      historyPromise.catch(() => {});
      assessment = await time('assess', () => deps.assessor.assess({ context, trigger: req.trigger, allowed }));
      if (assessment.usage) usage[assessment.source] = assessment.usage;
      eligible = assessment.eligibleActions;

      // The user asked, so "is now a good moment" doesn't apply to manual requests.
      if (!manual && !assessment.intervene) {
        if (!dev) return finish('none', `assessor_skip:${assessment.source}`);
        forced = true;
      }

      const history = await historyPromise;
      const choice = chooseAction({
        eligible: assessment.eligibleActions,
        posteriors: computePosteriors(history, started),
        distractionRisk: manual ? 0 : assessment.distractionRisk,
        includeNone: !manual && !dev,
        rng: deps.rng,
      });
      action = choice.action;
      probabilities = choice.probabilities;
      if (action === 'none') return finish('none', 'bandit_none');
    }

    // 4–5. Generate, verify, regenerate once, otherwise stay silent.
    const stimulus = action as StimulusAction;
    let rejection: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const draft = await time(`generate_${attempt}`, () =>
          generateIntervention(llm, stimulus, context, profile.language, rejection),
        );
        usage[`generate_${attempt}`] = draft.usage;
        const verdict = verifyIntervention(draft.text, draft.anchor, `${context.topic} ${context.excerptOrSummary}`, stimulus);
        if (verdict.ok) {
          const reason = manual ? 'manual_request' : dev ? `dev:${forced ? 'forced' : 'policy_selected'}` : 'policy_selected';
          return finish(action, reason, draft);
        }
        rejection = verdict.reason;
      } catch (err) {
        console.warn(`[decision] generation attempt ${attempt} failed:`, (err as Error).message);
        rejection = 'generation_error';
      }
    }
    return finish('none', `verification_failed:${rejection}`);
  },
);
