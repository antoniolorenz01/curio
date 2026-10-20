import type { Arm, Mode, Profile, Trigger } from '@curio/contracts';

export const MIN_CONTENT_CHARS = 80;

export type RuleInput = {
  trigger: Trigger;
  mode: Mode;
  paused: boolean;
  arm: Arm;
  sessionEnded: boolean;
  contentChars: number;
  timeSinceLastSuggestionSec: number;
  autoInterventions: number;
  profile: Profile;
};

export type RuleResult = { blocked: true; reason: string } | { blocked: false };

/**
 * Deterministic gate, first in the order of authority (before the assessor and the bandit).
 * Manual requests are the user asking explicitly, so only hard limits apply to them.
 */
export function applyRules(input: RuleInput): RuleResult {
  const block = (reason: string): RuleResult => ({ blocked: true, reason });

  if (input.sessionEnded) return block('session_ended');
  if (input.contentChars < MIN_CONTENT_CHARS) return block('insufficient_content');
  if (input.trigger === 'manual') return { blocked: false };

  if (input.paused) return block('paused');
  if (input.mode === 'silence') return block('silence_mode');
  if (input.mode === 'manual') return block('manual_mode');
  if (input.arm === 'control') return block('control_arm');
  if (input.timeSinceLastSuggestionSec < input.profile.cooldownSec) return block('cooldown');
  if (input.autoInterventions >= input.profile.maxAutoPerSession) return block('session_cap');
  return { blocked: false };
}
