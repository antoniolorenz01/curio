import type { Action, Insights } from '@curio/contracts';
import type { ReactNode } from 'react';
import { Button, Card, Note, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { actionLabels } from '@/lib/labels';
import { useRemote } from '../hooks';

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);
const ms = (value: number | null) => (value === null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`);
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function InsightsView() {
  const { data, error, loading, reload } = useRemote(api.insights);

  return (
    <div className="space-y-5">
      <SectionTitle
        action={
          <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
        }
      >
        Insights
      </SectionTitle>
      {error && <Note tone="error">{error}</Note>}
      {loading && !data && <Note>Loading…</Note>}
      {data && <InsightsBody data={data} />}
    </div>
  );
}

function InsightsBody({ data }: { data: Insights }) {
  const { totals, arms, latencyMs } = data;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Sessions" value={totals.sessions} />
        <Stat label="Suggestions" value={totals.interventions} />
        <Stat label="Own questions" value={totals.explorations} />
        <Stat label="Silence" value={pct(totals.noneRate)} hint="decisions to stay quiet" />
        <Stat label="Distraction" value={pct(totals.distractionRate)} hint="suggestions that distracted" />
        <Stat label="Latency" value={ms(latencyMs.p50)} hint={`p95 ${ms(latencyMs.p95)}`} />
      </div>

      <section>
        <SectionTitle>With and without suggestions</SectionTitle>
        <Card className="p-0">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="p-2 text-left font-medium" />
                <th className="p-2 text-right font-medium">Sessions</th>
                <th className="p-2 text-right font-medium">Rated</th>
                <th className="p-2 text-right font-medium">Curiosity</th>
                <th className="p-2 text-right font-medium">Focus</th>
              </tr>
            </thead>
            <tbody>
              {(['suggestions', 'control'] as const).map((arm) => (
                <tr key={arm} className="border-b border-border last:border-0">
                  <td className="p-2">{arm === 'suggestions' ? 'With' : 'Without (control)'}</td>
                  <td className="p-2 text-right tabular-nums">{arms[arm].sessions}</td>
                  <td className="p-2 text-right tabular-nums">{arms[arm].rated}</td>
                  <td className="p-2 text-right tabular-nums">{arms[arm].avgCuriosity?.toFixed(1) ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{arms[arm].avgAttention?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-1 text-[11px] text-muted">With a single user these are personal hints, not proof.</p>
      </section>

      <FeedbackByAction feedback={data.feedbackByAction} />
      <Policy policy={data.policy} />
      <RecentSessions sessions={data.recentSessions} />
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-2" >
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
      {hint && <p className="truncate text-[10px] text-muted">{hint}</p>}
    </Card>
  );
}

function FeedbackByAction({ feedback }: { feedback: Insights['feedbackByAction'] }) {
  const rows = Object.entries(feedback).filter(([, c]) => c.helped + c.not_interesting + c.distracted + c.ignored > 0);
  return (
    <section>
      <SectionTitle>Feedback by type</SectionTitle>
      {rows.length === 0 ? (
        <Note>No feedback yet.</Note>
      ) : (
        <Card className="space-y-2.5">
          {rows.map(([action, c]) => {
            const total = c.helped + c.not_interesting + c.distracted + c.ignored;
            const segments = [
              { key: 'helped', n: c.helped, className: 'bg-good' },
              { key: 'not_interesting', n: c.not_interesting, className: 'bg-muted/50' },
              { key: 'distracted', n: c.distracted, className: 'bg-bad' },
              { key: 'ignored', n: c.ignored, className: 'bg-border' },
            ];
            return (
              <div key={action}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{actionLabels[action as Action] ?? action}</span>
                  <span className="text-muted tabular-nums">
                    {c.helped}✓ · {c.not_interesting}· · {c.distracted}✗ · {c.ignored} ign.
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-subtle">
                  {segments.map((s) =>
                    s.n > 0 ? <div key={s.key} className={s.className} style={{ width: `${(s.n / total) * 100}%` }} /> : null,
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-muted">
            <span className="text-good">■</span> helpful · <span className="text-muted">■</span> not interested ·{' '}
            <span className="text-bad">■</span> distracting · ignored doesn't count as failure
          </p>
        </Card>
      )}
    </section>
  );
}

function Policy({ policy }: { policy: Insights['policy'] }) {
  if (policy.length === 0) return null;
  const sorted = [...policy].sort((a, b) => b.mean - a.mean);
  return (
    <section>
      <SectionTitle>What it learned</SectionTitle>
      <Card className="space-y-2">
        {sorted.map((p) => (
          <div key={p.action} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate">{actionLabels[p.action]}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(p.mean * 100)}%` }} />
            </div>
            <span className="text-right text-muted tabular-nums" title={`α ${p.alpha.toFixed(1)} · β ${p.beta.toFixed(1)}`}>
              {Math.round(p.mean * 100)}%
            </span>
          </div>
        ))}
        <p className="text-[11px] text-muted">Estimated chance that each kind of idea is useful to you.</p>
      </Card>
    </section>
  );
}

function RecentSessions({ sessions }: { sessions: Insights['recentSessions'] }) {
  return (
    <section>
      <SectionTitle>Recent sessions</SectionTitle>
      {sessions.length === 0 ? (
        <Note>No sessions yet.</Note>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card className="p-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{dateFormat.format(new Date(s.startedAt))}</span>
                  {s.goal && <span className="truncate text-muted">{s.goal}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted">
                  <span>{s.arm === 'control' ? 'Control' : 'With suggestions'}</span>
                  {s.curiosityAfter !== null && <span>Curiosity {s.curiosityAfter}</span>}
                  {s.attentionAfter !== null && <span>Focus {s.attentionAfter}</span>}
                  <span>
                    {s.interventions} sugg. · {s.helped}✓ · {s.distracted}✗
                  </span>
                  {!s.endedAt && <span className="text-warn">open</span>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
