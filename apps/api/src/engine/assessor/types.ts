import type { StimulusAction, StudyContext, Trigger } from '@curio/contracts';
import type { Usage } from '../../llm/types';

export type Assessment = {
  /** Whether now looks like a good moment for an optional prompt. */
  intervene: boolean;
  /** Estimated risk that interrupting now breaks focus (0–1). An estimate, not an observation. */
  distractionRisk: number;
  /** Actions that fit the material, best first. Never empty. */
  eligibleActions: StimulusAction[];
  confidence: number;
  source: string;
  usage?: Usage;
};

export type AssessInput = {
  context: StudyContext;
  trigger: Trigger;
  allowed: StimulusAction[];
};

/** Fast, structured judgement about the moment. Never writes the suggestion itself. */
export interface Assessor {
  readonly name: string;
  assess(input: AssessInput): Promise<Assessment>;
}

/** Keeps the top actions until `mass` of the probability is covered (max `limit`). */
export function topByProbability(
  probabilities: Partial<Record<StimulusAction, number>>,
  allowed: StimulusAction[],
  mass = 0.8,
  limit = 4,
): StimulusAction[] {
  const ranked = allowed
    .map((a) => [a, probabilities[a] ?? 0] as const)
    .sort((x, y) => y[1] - x[1]);
  const out: StimulusAction[] = [];
  let covered = 0;
  for (const [action, p] of ranked) {
    if (out.length >= limit || (out.length > 0 && covered >= mass)) break;
    out.push(action);
    covered += p;
  }
  return out.length > 0 ? out : allowed.slice(0, limit);
}

const TRIGGER_MEANING: Record<Trigger, string> = {
  manual: 'they asked for a suggestion',
  selection: 'they highlighted a passage',
  checkpoint: 'they have been reading this page for a while',
};

/** The state both Jev and the LLM assessor reason over. Page content is untrusted data. */
export function assessmentState({ context, trigger }: AssessInput) {
  return {
    trigger,
    triggerMeaning: TRIGGER_MEANING[trigger],
    topic: context.topic,
    studyGoal: context.goal ?? null,
    sourceType: context.sourceType,
    material: context.excerptOrSummary,
    learnerInterests: context.interests,
    secondsSinceLastSuggestion: Number.isFinite(context.timeSinceLastSuggestionSec)
      ? Math.round(context.timeSinceLastSuggestionSec)
      : null,
    selfReportedAttention1to5: context.attentionSelfReport ?? null,
  };
}
