import { StimulusAction, type Profile } from '@curio/contracts';

export const STIMULUS_ACTIONS = StimulusAction.options;

/** Older rows may hold idea types that were later retired; those are skipped when read. */
export const isStimulusAction = (value: unknown): value is StimulusAction => StimulusAction.safeParse(value).success;

/** Shared definitions used by the assessors (as criteria) and the generator (as instructions). */
export const ACTION_DESCRIPTIONS: Record<StimulusAction, string> = {
  question: 'An open question that makes the learner wonder about something in the material.',
  real_world_use: 'A concrete, real application of the idea outside the textbook.',
  personal_connection: "A link between the material and the learner's own interests or experience.",
  analogy: 'An analogy that maps the idea onto something familiar.',
  surprise: 'A surprising but true fact or counterintuitive consequence related to the material.',
};

export const POLICY_VERSION = 'rules-v1+ts-beta-v3';

export const DEFAULT_PROFILE: Profile = {
  interests: [],
  disabledActions: [],
  language: 'en',
  cooldownSec: 600,
  maxAutoPerSession: 6,
  controlRate: 0,
};

export function allowedActions(profile: Profile): StimulusAction[] {
  const allowed = STIMULUS_ACTIONS.filter((a) => !profile.disabledActions.includes(a));
  return allowed.length > 0 ? allowed : [...STIMULUS_ACTIONS];
}
