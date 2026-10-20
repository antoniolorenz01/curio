import type { Feedback, Profile, Session, StimulusAction } from '@curio/contracts';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_PROFILE, isStimulusAction } from '../engine/actions';
import type { ContextRow, Store } from './types';

type Row = Record<string, any>;
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

const PROFILE_ID = 'me';
const SNAPSHOT_LIMIT = 5000;

function must<T>(res: Result<T>, what: string): T {
  if (res.error) throw new Error(`supabase ${what}: ${res.error.message}`);
  return res.data as T;
}

const toProfile = (r: Row): Profile => ({
  interests: r.interests,
  disabledActions: (r.disabled_actions as string[]).filter(isStimulusAction),
  language: r.language,
  cooldownSec: r.cooldown_sec,
  maxAutoPerSession: r.max_auto_per_session,
  controlRate: r.control_rate,
});

const toSession = (r: Row): Session => ({
  id: r.id,
  goal: r.goal,
  mode: r.mode,
  arm: r.arm,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  curiosityBefore: r.curiosity_before,
  curiosityAfter: r.curiosity_after,
  attentionBefore: r.attention_before,
  attentionAfter: r.attention_after,
  distractions: r.distractions,
  notes: r.notes,
});

const toContext = (r: Row): ContextRow => ({
  id: r.id,
  sessionId: r.session_id,
  sourceType: r.source_type,
  url: r.url,
  title: r.title,
  topic: r.topic,
  summary: r.summary,
  textHash: r.text_hash,
  charCount: r.char_count,
  createdAt: r.created_at,
});

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function createSupabaseStore(url: string, serviceRoleKey: string): Store {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Read on every decision and only changed through this API, so cache it (single instance).
  let cachedProfile: Profile | null = null;

  return {
    async getProfile() {
      if (cachedProfile) return cachedProfile;
      const row = await currentProfile();
      if (row) return (cachedProfile = row);
      return this.updateProfile({});
    },
    async updateProfile(patch) {
      const merged = { ...DEFAULT_PROFILE, ...(await currentProfile()), ...patch };
      const row = must<Row>(
        await db
          .from('profiles')
          .upsert({
            id: PROFILE_ID,
            interests: merged.interests,
            disabled_actions: merged.disabledActions,
            language: merged.language,
            cooldown_sec: merged.cooldownSec,
            max_auto_per_session: merged.maxAutoPerSession,
            control_rate: merged.controlRate,
            updated_at: new Date().toISOString(),
          })
          .select('*')
          .single(),
        'updateProfile',
      );
      return (cachedProfile = toProfile(row));
    },

    async createSession(input) {
      const row = must<Row>(
        await db
          .from('sessions')
          .insert({
            goal: input.goal ?? null,
            mode: input.mode,
            arm: input.arm,
            curiosity_before: input.curiosityBefore ?? null,
            attention_before: input.attentionBefore ?? null,
          })
          .select('*')
          .single(),
        'createSession',
      );
      return toSession(row);
    },
    async getSession(id) {
      if (!isUuid(id)) return null;
      const row = must<Row | null>(await db.from('sessions').select('*').eq('id', id).maybeSingle(), 'getSession');
      return row ? toSession(row) : null;
    },
    async endSession(id, input) {
      const current = await this.getSession(id);
      if (!current) return null;
      const row = must<Row>(
        await db
          .from('sessions')
          .update({
            ended_at: current.endedAt ?? new Date().toISOString(),
            curiosity_after: input.curiosityAfter ?? current.curiosityAfter,
            attention_after: input.attentionAfter ?? current.attentionAfter,
            distractions: input.distractions ?? current.distractions,
            notes: input.notes ?? current.notes,
          })
          .eq('id', id)
          .select('*')
          .single(),
        'endSession',
      );
      return toSession(row);
    },

    async findContext(sessionId, textHash) {
      const row = must<Row | null>(
        await db.from('contexts').select('*').eq('session_id', sessionId).eq('text_hash', textHash).maybeSingle(),
        'findContext',
      );
      return row ? toContext(row) : null;
    },
    async createContext(c) {
      const row = must<Row>(
        await db
          .from('contexts')
          .insert({
            session_id: c.sessionId,
            source_type: c.sourceType,
            url: c.url,
            title: c.title,
            topic: c.topic,
            summary: c.summary,
            text_hash: c.textHash,
            char_count: c.charCount,
          })
          .select('*')
          .single(),
        'createContext',
      );
      return toContext(row);
    },
    async getContext(id) {
      if (!isUuid(id)) return null;
      const row = must<Row | null>(await db.from('contexts').select('*').eq('id', id).maybeSingle(), 'getContext');
      return row ? toContext(row) : null;
    },

    async createDecision(d) {
      const row = must<Row>(
        await db
          .from('decisions')
          .insert({
            session_id: d.sessionId,
            context_id: d.contextId,
            trigger: d.trigger,
            action: d.action,
            eligible_actions: d.eligibleActions,
            probabilities: d.probabilities,
            assessor: d.assessor,
            assessor_confidence: d.assessorConfidence,
            distraction_risk: d.distractionRisk,
            policy_version: d.policyVersion,
            reason_code: d.reasonCode,
            latency_ms: d.latencyMs,
            timings: d.timings,
            usage: d.usage,
          })
          .select('id')
          .single(),
        'createDecision',
      );
      return row.id as string;
    },
    async createIntervention(iv) {
      const row = must<Row>(
        await db
          .from('interventions')
          .insert({
            decision_id: iv.decisionId,
            session_id: iv.sessionId,
            context_id: iv.contextId,
            trigger: iv.trigger,
            action: iv.action,
            text: iv.text,
            anchor: iv.anchor,
          })
          .select('id, action, text, created_at')
          .single(),
        'createIntervention',
      );
      return { id: row.id, action: row.action, text: row.text, createdAt: row.created_at };
    },
    async lastInterventionAt(sessionId) {
      const row = must<Row | null>(
        await db
          .from('interventions')
          .select('created_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'lastInterventionAt',
      );
      return row?.created_at ?? null;
    },
    async countAutoInterventions(sessionId) {
      const res = await db
        .from('interventions')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .neq('trigger', 'manual');
      if (res.error) throw new Error(`supabase countAutoInterventions: ${res.error.message}`);
      return res.count ?? 0;
    },

    async upsertFeedback(interventionId, value) {
      if (!isUuid(interventionId)) return false;
      const res = await db
        .from('feedback')
        .upsert(
          { intervention_id: interventionId, value, created_at: new Date().toISOString() },
          { onConflict: 'intervention_id' },
        );
      if (res.error?.code === '23503') return false; // unknown intervention
      must(res, 'upsertFeedback');
      return true;
    },
    async getInterventionDetail(id) {
      if (!isUuid(id)) return null;
      const row = must<Row | null>(
        await db
          .from('interventions')
          .select('id, session_id, action, text, contexts(topic, summary)')
          .eq('id', id)
          .maybeSingle(),
        'getInterventionDetail',
      );
      if (!row?.contexts) return null;
      return {
        id: row.id,
        sessionId: row.session_id,
        action: row.action as StimulusAction,
        text: row.text,
        topic: row.contexts.topic,
        summary: row.contexts.summary,
      };
    },
    async saveIntervention(id) {
      if (!isUuid(id)) return false;
      const rows = must<Row[]>(
        await db
          .from('interventions')
          .update({ saved_at: new Date().toISOString() })
          .eq('id', id)
          .is('saved_at', null)
          .select('id'),
        'saveIntervention',
      );
      if (rows.length > 0) return true;
      const exists = must<Row | null>(
        await db.from('interventions').select('id').eq('id', id).maybeSingle(),
        'saveIntervention',
      );
      return Boolean(exists);
    },
    async listSaved() {
      const rows = must<Row[]>(
        await db
          .from('interventions')
          .select('id, action, text, created_at, saved_at, contexts(topic, url)')
          .not('saved_at', 'is', null)
          .order('saved_at', { ascending: false })
          .limit(200),
        'listSaved',
      );
      return rows
        .filter((r) => isStimulusAction(r.action))
        .map((r) => ({
          id: r.id,
          action: r.action as StimulusAction,
          text: r.text,
          createdAt: r.created_at,
          savedAt: r.saved_at,
          topic: r.contexts?.topic ?? null,
          url: r.contexts?.url ?? null,
        }));
    },
    async createExploration(input) {
      if (!(await this.getSession(input.sessionId))) return false;
      must(
        await db.from('explorations').insert({ session_id: input.sessionId, kind: input.kind, content: input.content }),
        'createExploration',
      );
      return true;
    },

    async feedbackHistory(limit) {
      const rows = must<Row[]>(
        await db
          .from('feedback')
          .select('value, created_at, interventions(action)')
          .order('created_at', { ascending: false })
          .limit(limit),
        'feedbackHistory',
      );
      return rows.flatMap((r) =>
        r.interventions && isStimulusAction(r.interventions.action)
          ? [{ action: r.interventions.action as StimulusAction, value: r.value as Feedback, createdAt: r.created_at }]
          : [],
      );
    },
    async snapshot() {
      const [sessions, decisions, interventions, feedback, explorations] = await Promise.all([
        db.from('sessions').select('*').order('started_at', { ascending: false }).limit(SNAPSHOT_LIMIT),
        db
          .from('decisions')
          .select('session_id, action, latency_ms')
          .order('created_at', { ascending: false })
          .limit(SNAPSHOT_LIMIT),
        db
          .from('interventions')
          .select('id, session_id, action')
          .order('created_at', { ascending: false })
          .limit(SNAPSHOT_LIMIT),
        db
          .from('feedback')
          .select('intervention_id, value')
          .order('created_at', { ascending: false })
          .limit(SNAPSHOT_LIMIT),
        db.from('explorations').select('id', { count: 'exact', head: true }),
      ]);
      if (explorations.error) throw new Error(`supabase snapshot: ${explorations.error.message}`);
      return {
        sessions: must<Row[]>(sessions, 'snapshot').map(toSession),
        decisions: must<Row[]>(decisions, 'snapshot').map((r) => ({
          sessionId: r.session_id,
          action: r.action,
          latencyMs: r.latency_ms,
        })),
        interventions: must<Row[]>(interventions, 'snapshot')
          .filter((r) => isStimulusAction(r.action))
          .map((r) => ({
            id: r.id,
            sessionId: r.session_id,
            action: r.action,
          })),
        feedback: must<Row[]>(feedback, 'snapshot').map((r) => ({ interventionId: r.intervention_id, value: r.value })),
        explorations: explorations.count ?? 0,
      };
    },
  };

  async function currentProfile(): Promise<Profile | null> {
    const row = must<Row | null>(
      await db.from('profiles').select('*').eq('id', PROFILE_ID).maybeSingle(),
      'getProfile',
    );
    return row ? toProfile(row) : null;
  }
}
