import type { Arm, Feedback, Insights, Session } from '@curio/contracts';
import type { Snapshot } from '../store/types';
import { STIMULUS_ACTIONS } from './actions';
import type { Posteriors } from './bandit';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, digits = 2) => (n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

const values = (sessions: Session[], key: 'curiosityAfter' | 'attentionAfter') =>
  sessions.flatMap((s) => (s[key] === null ? [] : [s[key]]));

export function computeInsights(snap: Snapshot, posteriors: Posteriors): Insights {
  const actionOf = new Map(snap.interventions.map((i) => [i.id, i]));
  const emptyCounts = (): Record<Feedback, number> => ({ helped: 0, not_interesting: 0, distracted: 0, ignored: 0 });

  const feedbackByAction: Record<string, Record<Feedback, number>> = Object.fromEntries(
    STIMULUS_ACTIONS.map((a) => [a, emptyCounts()]),
  );
  const perSession = new Map<string, Record<Feedback, number>>();
  for (const f of snap.feedback) {
    const iv = actionOf.get(f.interventionId);
    const counts = iv && feedbackByAction[iv.action];
    if (!iv || !counts) continue;
    counts[f.value]++;
    const s = perSession.get(iv.sessionId) ?? emptyCounts();
    s[f.value]++;
    perSession.set(iv.sessionId, s);
  }

  const interventionsPerSession = new Map<string, number>();
  for (const iv of snap.interventions) {
    interventionsPerSession.set(iv.sessionId, (interventionsPerSession.get(iv.sessionId) ?? 0) + 1);
  }

  const ended = snap.sessions.filter((s) => s.endedAt);
  const armStats = (arm: Arm) => {
    const list = ended.filter((s) => s.arm === arm);
    return {
      sessions: list.length,
      rated: list.filter((s) => s.curiosityAfter !== null || s.attentionAfter !== null).length,
      avgCuriosity: round(mean(values(list, 'curiosityAfter'))),
      avgAttention: round(mean(values(list, 'attentionAfter'))),
    };
  };

  const latencies = snap.decisions.map((d) => d.latencyMs).sort((a, b) => a - b);
  const noneCount = snap.decisions.filter((d) => d.action === 'none').length;
  const distracted = snap.feedback.filter((f) => f.value === 'distracted').length;

  return {
    totals: {
      sessions: snap.sessions.length,
      decisions: snap.decisions.length,
      interventions: snap.interventions.length,
      explorations: snap.explorations,
      noneRate: snap.decisions.length ? round(noneCount / snap.decisions.length, 3) : null,
      distractionRate: snap.interventions.length ? round(distracted / snap.interventions.length, 3) : null,
    },
    feedbackByAction,
    arms: { suggestions: armStats('suggestions'), control: armStats('control') },
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    policy: STIMULUS_ACTIONS.map((action) => {
      const { alpha, beta } = posteriors[action];
      return { action, alpha: round(alpha)!, beta: round(beta)!, mean: round(alpha / (alpha + beta), 3)! };
    }),
    recentSessions: snap.sessions.slice(0, 20).map((s) => {
      const fb = perSession.get(s.id) ?? emptyCounts();
      return {
        id: s.id,
        goal: s.goal,
        arm: s.arm,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        curiosityBefore: s.curiosityBefore,
        curiosityAfter: s.curiosityAfter,
        attentionBefore: s.attentionBefore,
        attentionAfter: s.attentionAfter,
        interventions: interventionsPerSession.get(s.id) ?? 0,
        helped: fb.helped,
        distracted: fb.distracted,
      };
    }),
  };
}
