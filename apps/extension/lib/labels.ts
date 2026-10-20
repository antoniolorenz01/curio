import type { Action, Feedback, StimulusAction } from '@curio/contracts';

export const actionLabels: Record<Action, string> = {
  none: 'Nothing',
  question: 'Question',
  real_world_use: 'Real-world use',
  personal_connection: 'Personal connection',
  analogy: 'Analogy',
  surprise: 'Surprise',
};

export const stimulusActions: StimulusAction[] = [
  'question',
  'real_world_use',
  'personal_connection',
  'analogy',
  'surprise',
];

export const feedbackLabels: Record<Feedback, string> = {
  helped: 'Helpful',
  not_interesting: 'Not interested',
  distracted: 'Distracting',
  ignored: 'Ignored',
};

// Keys match the API's reasonCode (apps/api/src/engine/rules.ts and pipeline.ts);
// prefixed codes like `verification_failed:too_long` match on the part before the colon.
const reasonNotes: Record<string, string> = {
  cooldown: 'There was a suggestion a moment ago.',
  session_cap: 'This session already had several suggestions.',
  insufficient_content: 'Not enough context yet.',
  control_arm: 'Control session: no automatic suggestions.',
  session_ended: 'This session has ended.',
  verification_failed: "Couldn't come up with a good enough idea.",
};

/** Quiet note shown when a manual request ends in `none`. */
export function noneNote(reasonCode: string) {
  const note = reasonNotes[reasonCode] ?? reasonNotes[reasonCode.split(':')[0]!] ?? '';
  return `Not now — keep going. ${note}`.trim();
}
