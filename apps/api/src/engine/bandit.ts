import type { Action, Feedback, StimulusAction } from '@curio/contracts';
import { STIMULUS_ACTIONS } from './actions';
import { sampleBeta, type Rng } from './random';

export type FeedbackEvent = { action: StimulusAction; value: Feedback; createdAt: string };
export type Posterior = { alpha: number; beta: number };
export type Posteriors = Record<StimulusAction, Posterior>;

const PRIOR: Posterior = { alpha: 1, beta: 1 };

/**
 * `none` has no direct feedback, so it competes as a fixed baseline: stimuli whose
 * learned value (discounted by distraction risk) falls below it lose to silence.
 * With no feedback yet and low risk it wins ~15–40% of draws; with high risk, ~90%.
 */
const NONE_BASELINE: Posterior = { alpha: 1.5, beta: 3.5 };

// helped is positive, not_interesting a soft negative, distracted a strong penalty;
// ignored is not a failure (may mean focus), so it does not update.
const UPDATES: Record<Feedback, Posterior> = {
  helped: { alpha: 1, beta: 0 },
  not_interesting: { alpha: 0, beta: 0.5 },
  distracted: { alpha: 0, beta: 2 },
  ignored: { alpha: 0, beta: 0 },
};

/** Beta posteriors per action with exponential forgetting so shifting interests count. */
export function computePosteriors(events: FeedbackEvent[], now = Date.now(), halfLifeDays = 30): Posteriors {
  const out = Object.fromEntries(STIMULUS_ACTIONS.map((a) => [a, { ...PRIOR }])) as Posteriors;
  for (const e of events) {
    const ageDays = Math.max(0, (now - Date.parse(e.createdAt)) / 86_400_000);
    const w = Math.pow(0.5, ageDays / halfLifeDays);
    const u = UPDATES[e.value];
    const p = out[e.action];
    if (!p) continue; // retired idea type
    p.alpha += u.alpha * w;
    p.beta += u.beta * w;
  }
  return out;
}

export type ChooseInput = {
  eligible: StimulusAction[];
  posteriors: Posteriors;
  distractionRisk: number;
  includeNone: boolean;
  rng?: Rng;
  /** Monte Carlo draws used to estimate selection probabilities for off-policy evaluation. */
  samples?: number;
};

export type Choice = { action: Action; probabilities: Partial<Record<Action, number>> };

/** Thompson Sampling over the eligible actions (plus `none` for automatic triggers). */
export function chooseAction(input: ChooseInput): Choice {
  const rng = input.rng ?? Math.random;
  const arms: Action[] = [...input.eligible, ...(input.includeNone ? (['none'] as const) : [])];
  if (arms.length === 0) return { action: 'none', probabilities: { none: 1 } };

  const risk = Math.min(1, Math.max(0, input.distractionRisk));
  const draw = (): Action => {
    let best: Action = arms[0]!;
    let bestScore = -Infinity;
    for (const arm of arms) {
      const p = arm === 'none' ? NONE_BASELINE : input.posteriors[arm];
      const theta = sampleBeta(p.alpha, p.beta, rng);
      const score = arm === 'none' ? theta : theta * (1 - risk);
      if (score > bestScore) {
        bestScore = score;
        best = arm;
      }
    }
    return best;
  };

  const action = draw();
  const samples = input.samples ?? 300;
  const counts: Partial<Record<Action, number>> = {};
  for (let i = 0; i < samples; i++) {
    const a = draw();
    counts[a] = (counts[a] ?? 0) + 1;
  }
  const probabilities = Object.fromEntries(
    arms.map((a) => [a, Math.round(((counts[a] ?? 0) / samples) * 1000) / 1000]),
  ) as Partial<Record<Action, number>>;

  return { action, probabilities };
}
