import type { Feedback, Intervention, SourceType, StimulusAction } from '@curio/contracts';

// Message protocol between the page (content script), the side panel and the background,
// which is the only part that talks to the API.

export type PageSnapshot = { sourceType: SourceType; text: string; url: string; title: string };

export type CardData = { intervention: Intervention; topic: string; auto: boolean };

export type CollectResult = { ok: true; page: PageSnapshot } | { ok: false; reason: string };

export type Result = { ok: true } | { ok: false; reason: string };

export type MoreResult = { ok: true; text: string } | { ok: false; reason: string };

/** Reply to `curio:visit`: during a cooldown the page asks again later. */
export type VisitResult = { done: true } | { done: false; retryInSec: number };

/** Content script → background. */
export type ContentMessage =
  | { type: 'curio:selection'; page: PageSnapshot }
  /** The user has been reading this page for a while. */
  | { type: 'curio:visit'; url: string }
  | { type: 'curio:request'; page: PageSnapshot }
  | { type: 'curio:feedback'; interventionId: string; value: Feedback }
  | { type: 'curio:save'; interventionId: string }
  /** "Tell me more", or a question about the suggestion. Replies with a MoreResult. */
  | { type: 'curio:more'; interventionId: string; question?: string };

/** Side panel → background. */
export type PanelMessage = { type: 'curio:request-active'; requestedAction?: StimulusAction };

/** Background → content script. `collect` replies with a CollectResult. */
export type PageMessage =
  | { type: 'curio:collect'; manual: boolean }
  | { type: 'curio:loading' }
  | { type: 'curio:card'; card: CardData }
  | { type: 'curio:note'; text: string; tone: 'muted' | 'error' };

export function isCurioMessage<T extends { type: string }>(value: unknown): value is T {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('curio:')
  );
}
