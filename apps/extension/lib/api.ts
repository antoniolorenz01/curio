import {
  AutoStatus,
  ContextResult,
  DecisionResponse,
  FollowUpResponse,
  Insights,
  Profile,
  SavedIntervention,
  Session,
  type ContextInput,
  type CreateSessionInput,
  type DecisionRequest,
  type EndSessionInput,
  type ExplorationInput,
  type FeedbackInput,
  type UpdateProfileInput,
} from '@curio/contracts';
import { z } from 'zod';
import { defaultSettings, settingsItem } from './storage';

const TIMEOUT_MS = 15_000;
const Ok = z.object({ ok: z.literal(true) });

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown): Promise<T> {
  const { apiUrl, apiToken } = { ...defaultSettings, ...(await settingsItem.getValue()) };
  let res: Response;
  try {
    res = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiError(
      timedOut ? 'The server took too long.' : "Couldn't reach the server. Is `npm run dev` running?",
    );
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error;
    if (res.status === 401) throw new ApiError('The server requires a token. Add it under Settings → Advanced.', 401);
    throw new ApiError(message ?? `Server error (${res.status}).`, res.status);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError('Unexpected response from the server.');
  return parsed.data;
}

export const api = {
  getProfile: () => request(Profile, 'GET', '/profile'),
  updateProfile: (input: UpdateProfileInput) => request(Profile, 'PUT', '/profile', input),
  createSession: (input: CreateSessionInput) => request(Session, 'POST', '/sessions', input),
  endSession: (id: string, input: EndSessionInput) =>
    request(Session, 'PATCH', `/sessions/${encodeURIComponent(id)}/end`, input),
  autoStatus: (sessionId: string) =>
    request(AutoStatus, 'GET', `/sessions/${encodeURIComponent(sessionId)}/auto-status`),
  postContext: (input: ContextInput) => request(ContextResult, 'POST', '/context', input),
  decide: (input: DecisionRequest) => request(DecisionResponse, 'POST', '/decisions', input),
  feedback: (input: FeedbackInput) => request(Ok, 'POST', '/feedback', input),
  save: (interventionId: string) =>
    request(Ok, 'POST', `/interventions/${encodeURIComponent(interventionId)}/save`),
  saved: () => request(z.array(SavedIntervention), 'GET', '/interventions/saved'),
  more: (interventionId: string, question?: string) =>
    request(FollowUpResponse, 'POST', `/interventions/${encodeURIComponent(interventionId)}/more`, { question }),
  explore: (input: ExplorationInput) => request(Ok, 'POST', '/explorations', input),
  insights: () => request(Insights, 'GET', '/insights'),
};

export function errorMessage(err: unknown) {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}
