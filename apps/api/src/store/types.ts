import type {
  Action,
  Arm,
  CreateSessionInput,
  EndSessionInput,
  ExplorationInput,
  Feedback,
  Intervention,
  Profile,
  SavedIntervention,
  Session,
  SourceType,
  StimulusAction,
  Trigger,
  UpdateProfileInput,
} from '@curio/contracts';
import type { FeedbackEvent } from '../engine/bandit';
import type { Usage } from '../llm/types';

export type ContextRow = {
  id: string;
  sessionId: string;
  sourceType: SourceType;
  url: string | null;
  title: string | null;
  topic: string;
  summary: string;
  textHash: string;
  charCount: number;
  createdAt: string;
};

export type NewContext = Omit<ContextRow, 'id' | 'createdAt'>;

export type NewDecision = {
  sessionId: string;
  contextId: string;
  trigger: Trigger;
  action: Action;
  eligibleActions: Action[];
  probabilities: Partial<Record<Action, number>>;
  assessor: string | null;
  assessorConfidence: number | null;
  distractionRisk: number | null;
  policyVersion: string;
  reasonCode: string;
  latencyMs: number;
  timings: Record<string, number>;
  usage: Record<string, Usage>;
};

export type NewIntervention = {
  decisionId: string;
  sessionId: string;
  contextId: string;
  trigger: Trigger;
  action: StimulusAction;
  text: string;
  anchor: string | null;
};

/** An intervention with the context it was written from, for follow-ups. */
export type InterventionDetail = {
  id: string;
  sessionId: string;
  action: StimulusAction;
  text: string;
  topic: string;
  summary: string;
};

/** Raw rows for computing insights; small enough for a single user. */
export type Snapshot = {
  sessions: Session[];
  decisions: { sessionId: string; action: Action; latencyMs: number }[];
  interventions: { id: string; sessionId: string; action: StimulusAction }[];
  feedback: { interventionId: string; value: Feedback }[];
  explorations: number;
};

export interface Store {
  getProfile(): Promise<Profile>;
  updateProfile(patch: UpdateProfileInput): Promise<Profile>;

  createSession(input: CreateSessionInput & { arm: Arm }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  endSession(id: string, input: EndSessionInput): Promise<Session | null>;

  findContext(sessionId: string, textHash: string): Promise<ContextRow | null>;
  createContext(row: NewContext): Promise<ContextRow>;
  getContext(id: string): Promise<ContextRow | null>;

  createDecision(row: NewDecision): Promise<string>;
  createIntervention(row: NewIntervention): Promise<Intervention>;
  /** Timestamp of the last intervention shown in the session, if any. */
  lastInterventionAt(sessionId: string): Promise<string | null>;
  countAutoInterventions(sessionId: string): Promise<number>;

  /** Records feedback; a later answer for the same intervention replaces the earlier one. */
  upsertFeedback(interventionId: string, value: Feedback): Promise<boolean>;
  saveIntervention(id: string): Promise<boolean>;
  getInterventionDetail(id: string): Promise<InterventionDetail | null>;
  listSaved(): Promise<SavedIntervention[]>;
  createExploration(input: ExplorationInput): Promise<boolean>;

  feedbackHistory(limit: number): Promise<FeedbackEvent[]>;
  snapshot(): Promise<Snapshot>;
}
