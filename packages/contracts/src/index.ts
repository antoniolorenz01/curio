import { z } from 'zod';

// ---------- Core domain ----------

export const Action = z.enum([
  'none',
  'question',
  'real_world_use',
  'personal_connection',
  'analogy',
  'prediction',
  'surprise',
  'micro_experiment',
]);
export type Action = z.infer<typeof Action>;

/** Actions that produce an intervention (everything except `none`). */
export const StimulusAction = Action.exclude(['none']);
export type StimulusAction = z.infer<typeof StimulusAction>;

export const SourceType = z.enum(['web', 'selection', 'pdf', 'video']);
export type SourceType = z.infer<typeof SourceType>;

export const Mode = z.enum(['manual', 'occasional', 'silence']);
export type Mode = z.infer<typeof Mode>;

/** What caused a decision request. `manual` = the user explicitly asked. */
export const Trigger = z.enum(['manual', 'selection', 'checkpoint']);
export type Trigger = z.infer<typeof Trigger>;

export const Arm = z.enum(['suggestions', 'control']);
export type Arm = z.infer<typeof Arm>;

export const Rating = z.number().int().min(1).max(5);

export const StudyContext = z.object({
  sessionId: z.string(),
  topic: z.string(),
  goal: z.string().optional(),
  sourceType: SourceType,
  excerptOrSummary: z.string(),
  interests: z.array(z.string()),
  timeSinceLastSuggestionSec: z.number(),
  userPaused: z.boolean(),
  attentionSelfReport: Rating.optional(),
});
export type StudyContext = z.infer<typeof StudyContext>;

export const Decision = z.object({
  action: Action,
  eligibleActions: z.array(Action),
  jevConfidence: z.number().optional(),
  distractionRisk: z.number().optional(), // an estimate, not an observation
  policyVersion: z.string(),
  reasonCode: z.string(),
});
export type Decision = z.infer<typeof Decision>;

export const Feedback = z.enum(['helped', 'not_interesting', 'distracted', 'ignored']);
export type Feedback = z.infer<typeof Feedback>;

// ---------- Profile ----------

export const Profile = z.object({
  interests: z.array(z.string().min(1).max(80)).max(30),
  disabledActions: z.array(StimulusAction),
  language: z.string().min(2).max(10),
  cooldownSec: z.number().int().min(60).max(7200),
  maxAutoPerSession: z.number().int().min(0).max(50),
  /** Share of occasional-mode sessions assigned to the no-suggestions control arm. */
  controlRate: z.number().min(0).max(1),
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileInput = Profile.partial();
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

// ---------- Sessions ----------

export const CreateSessionInput = z.object({
  goal: z.string().max(500).optional(),
  mode: Mode,
  curiosityBefore: Rating.optional(),
  attentionBefore: Rating.optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;

export const EndSessionInput = z.object({
  curiosityAfter: Rating.optional(),
  attentionAfter: Rating.optional(),
  distractions: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
});
export type EndSessionInput = z.infer<typeof EndSessionInput>;

export const Session = z.object({
  id: z.string(),
  goal: z.string().nullable(),
  mode: Mode,
  arm: Arm,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  curiosityBefore: Rating.nullable(),
  curiosityAfter: Rating.nullable(),
  attentionBefore: Rating.nullable(),
  attentionAfter: Rating.nullable(),
  distractions: z.number().nullable(),
  notes: z.string().nullable(),
});
export type Session = z.infer<typeof Session>;

// ---------- Context ----------

export const ContextInput = z.object({
  sessionId: z.string(),
  sourceType: SourceType,
  url: z.string().max(2000).optional(),
  title: z.string().max(500).optional(),
  text: z.string().min(1).max(20_000),
});
export type ContextInput = z.infer<typeof ContextInput>;

export const ContextResult = z.object({
  contextId: z.string(),
  topic: z.string(),
  summary: z.string(),
  cached: z.boolean(),
});
export type ContextResult = z.infer<typeof ContextResult>;

// ---------- Decisions & interventions ----------

export const DecisionRequest = z.object({
  sessionId: z.string(),
  contextId: z.string(),
  trigger: Trigger,
  /** Client-side state is authoritative for mode and pause. */
  mode: Mode,
  paused: z.boolean(),
  requestedAction: StimulusAction.optional(),
  attentionSelfReport: Rating.optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const Intervention = z.object({
  id: z.string(),
  action: StimulusAction,
  text: z.string(),
  createdAt: z.string(),
});
export type Intervention = z.infer<typeof Intervention>;

export const DecisionResponse = z.object({
  decisionId: z.string(),
  decision: Decision,
  intervention: Intervention.nullable(),
});
export type DecisionResponse = z.infer<typeof DecisionResponse>;

/** Whether an automatic suggestion could happen now, checked before reading the page. */
export const AutoStatus = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  retryInSec: z.number().nullable(),
});
export type AutoStatus = z.infer<typeof AutoStatus>;

export const FeedbackInput = z.object({
  interventionId: z.string(),
  value: Feedback,
});
export type FeedbackInput = z.infer<typeof FeedbackInput>;

/** Ask for more about a suggestion: no question means "tell me more". */
export const FollowUpInput = z.object({
  question: z.string().trim().min(1).max(500).optional(),
});
export type FollowUpInput = z.infer<typeof FollowUpInput>;

export const FollowUpResponse = z.object({ text: z.string() });
export type FollowUpResponse = z.infer<typeof FollowUpResponse>;

export const SavedIntervention = Intervention.extend({
  topic: z.string().nullable(),
  url: z.string().nullable(),
  savedAt: z.string(),
});
export type SavedIntervention = z.infer<typeof SavedIntervention>;

// ---------- Explorations ----------

export const ExplorationInput = z.object({
  sessionId: z.string(),
  kind: z.enum(['question', 'search']),
  content: z.string().min(1).max(2000),
});
export type ExplorationInput = z.infer<typeof ExplorationInput>;

// ---------- Insights ----------

const FeedbackCounts = z.object({
  helped: z.number(),
  not_interesting: z.number(),
  distracted: z.number(),
  ignored: z.number(),
});

// Arms are assigned at random, so comparing end-of-session ratings is enough.
const ArmStats = z.object({
  sessions: z.number(),
  rated: z.number(),
  avgCuriosity: z.number().nullable(),
  avgAttention: z.number().nullable(),
});

export const Insights = z.object({
  totals: z.object({
    sessions: z.number(),
    decisions: z.number(),
    interventions: z.number(),
    explorations: z.number(),
    noneRate: z.number().nullable(),
    distractionRate: z.number().nullable(),
  }),
  feedbackByAction: z.record(z.string(), FeedbackCounts),
  arms: z.object({ suggestions: ArmStats, control: ArmStats }),
  latencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  policy: z.array(
    z.object({ action: Action, alpha: z.number(), beta: z.number(), mean: z.number() }),
  ),
  recentSessions: z.array(
    z.object({
      id: z.string(),
      goal: z.string().nullable(),
      arm: Arm,
      startedAt: z.string(),
      endedAt: z.string().nullable(),
      curiosityBefore: z.number().nullable(),
      curiosityAfter: z.number().nullable(),
      attentionBefore: z.number().nullable(),
      attentionAfter: z.number().nullable(),
      interventions: z.number(),
      helped: z.number(),
      distracted: z.number(),
    }),
  ),
});
export type Insights = z.infer<typeof Insights>;

// ---------- HTTP surface ----------
// Auth: only when the API runs with API_TOKEN (e.g. deployed). Then every route except
// GET /health requires `Authorization: Bearer <API_TOKEN>`. Locally there is no token.
//
// GET    /health                      → { ok: true }
// GET    /profile                     → Profile
// PUT    /profile                     UpdateProfileInput → Profile
// POST   /sessions                    CreateSessionInput → Session
// PATCH  /sessions/:id/end            EndSessionInput → Session
// GET    /sessions/:id/auto-status    → AutoStatus
// POST   /context                     ContextInput → ContextResult
// POST   /decisions                   DecisionRequest → DecisionResponse
// POST   /feedback                    FeedbackInput → { ok: true }
// POST   /interventions/:id/save      → { ok: true }
// POST   /interventions/:id/more      FollowUpInput → FollowUpResponse
// GET    /interventions/saved         → SavedIntervention[]
// POST   /explorations                ExplorationInput → { ok: true }
// GET    /insights                    → Insights
// Errors: { error: string, details?: unknown } with 4xx/5xx status.
