import { randomUUID } from 'node:crypto';
import type { Feedback, Profile, Session } from '@curio/contracts';
import { DEFAULT_PROFILE } from '../engine/actions';
import type { ContextRow, NewDecision, NewIntervention, Store } from './types';

type InterventionRow = NewIntervention & { id: string; createdAt: string; savedAt: string | null };

/** In-process store for tests and local runs without Supabase. Data is lost on restart. */
export function createMemoryStore(): Store {
  let profile: Profile = { ...DEFAULT_PROFILE };
  const sessions = new Map<string, Session>();
  const contexts = new Map<string, ContextRow>();
  const decisions: (NewDecision & { id: string })[] = [];
  const interventions = new Map<string, InterventionRow>();
  const feedback = new Map<string, { value: Feedback; createdAt: string }>();
  let explorations = 0;
  const now = () => new Date().toISOString();

  return {
    async getProfile() {
      return profile;
    },
    async updateProfile(patch) {
      profile = { ...profile, ...patch };
      return profile;
    },

    async createSession(input) {
      const session: Session = {
        id: randomUUID(),
        goal: input.goal ?? null,
        mode: input.mode,
        arm: input.arm,
        startedAt: now(),
        endedAt: null,
        curiosityBefore: input.curiosityBefore ?? null,
        curiosityAfter: null,
        attentionBefore: input.attentionBefore ?? null,
        attentionAfter: null,
        distractions: null,
        notes: null,
      };
      sessions.set(session.id, session);
      return session;
    },
    async getSession(id) {
      return sessions.get(id) ?? null;
    },
    async endSession(id, input) {
      const s = sessions.get(id);
      if (!s) return null;
      const ended: Session = {
        ...s,
        endedAt: s.endedAt ?? now(),
        curiosityAfter: input.curiosityAfter ?? s.curiosityAfter,
        attentionAfter: input.attentionAfter ?? s.attentionAfter,
        distractions: input.distractions ?? s.distractions,
        notes: input.notes ?? s.notes,
      };
      sessions.set(id, ended);
      return ended;
    },

    async findContext(sessionId, textHash) {
      return [...contexts.values()].find((c) => c.sessionId === sessionId && c.textHash === textHash) ?? null;
    },
    async createContext(row) {
      const ctx: ContextRow = { ...row, id: randomUUID(), createdAt: now() };
      contexts.set(ctx.id, ctx);
      return ctx;
    },
    async getContext(id) {
      return contexts.get(id) ?? null;
    },

    async createDecision(row) {
      const id = randomUUID();
      decisions.push({ ...row, id });
      return id;
    },
    async createIntervention(row) {
      const iv: InterventionRow = { ...row, id: randomUUID(), createdAt: now(), savedAt: null };
      interventions.set(iv.id, iv);
      return { id: iv.id, action: iv.action, text: iv.text, createdAt: iv.createdAt };
    },
    async lastInterventionAt(sessionId) {
      const times = [...interventions.values()].filter((i) => i.sessionId === sessionId).map((i) => i.createdAt);
      return times.sort().at(-1) ?? null;
    },
    async countAutoInterventions(sessionId) {
      return [...interventions.values()].filter((i) => i.sessionId === sessionId && i.trigger !== 'manual').length;
    },

    async upsertFeedback(interventionId, value) {
      if (!interventions.has(interventionId)) return false;
      feedback.set(interventionId, { value, createdAt: now() });
      return true;
    },
    async getInterventionDetail(id) {
      const iv = interventions.get(id);
      const ctx = iv && contexts.get(iv.contextId);
      if (!iv || !ctx) return null;
      return { id, sessionId: iv.sessionId, action: iv.action, text: iv.text, topic: ctx.topic, summary: ctx.summary };
    },
    async saveIntervention(id) {
      const iv = interventions.get(id);
      if (!iv) return false;
      iv.savedAt ??= now();
      return true;
    },
    async listSaved() {
      return [...interventions.values()]
        .filter((i) => i.savedAt)
        .sort((a, b) => b.savedAt!.localeCompare(a.savedAt!))
        .map((i) => {
          const ctx = contexts.get(i.contextId);
          return {
            id: i.id,
            action: i.action,
            text: i.text,
            createdAt: i.createdAt,
            savedAt: i.savedAt!,
            topic: ctx?.topic ?? null,
            url: ctx?.url ?? null,
          };
        });
    },
    async createExploration(input) {
      if (!sessions.has(input.sessionId)) return false;
      explorations++;
      return true;
    },

    async feedbackHistory(limit) {
      return [...feedback.entries()]
        .flatMap(([id, f]) => {
          const iv = interventions.get(id);
          return iv ? [{ action: iv.action, value: f.value, createdAt: f.createdAt }] : [];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async snapshot() {
      return {
        sessions: [...sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        decisions: decisions.map((d) => ({ sessionId: d.sessionId, action: d.action, latencyMs: d.latencyMs })),
        interventions: [...interventions.values()].map((i) => ({ id: i.id, sessionId: i.sessionId, action: i.action })),
        feedback: [...feedback.entries()].map(([interventionId, f]) => ({ interventionId, value: f.value })),
        explorations,
      };
    },
  };
}
