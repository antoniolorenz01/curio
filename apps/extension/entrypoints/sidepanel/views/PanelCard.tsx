import type { Feedback } from '@curio/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Input, Note } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { actionLabels } from '@/lib/labels';
import type { CardData } from '@/lib/messages';
import { touchSession } from '@/lib/session';
import { panelCardItem } from '@/lib/storage';
import { useStorageItem } from '../hooks';

/**
 * The idea card for tabs where Curio can't draw on the page (PDF viewers, browser pages).
 * Same actions as the in-page card.
 */
export function PanelCard() {
  const state = useStorageItem(panelCardItem);

  // Seen: clear the toolbar badge set when the idea arrived.
  useEffect(() => {
    if (state?.kind === 'card') void browser.action.setBadgeText({ text: '' });
  }, [state]);

  if (!state) return null;
  if (state.kind === 'loading') return <Note>Thinking…</Note>;
  if (state.kind === 'note') {
    return (
      <div className="flex items-start justify-between gap-2">
        <Note tone={state.tone}>{state.text}</Note>
        <button type="button" aria-label="Close" onClick={() => void panelCardItem.setValue(null)} className="text-muted">
          ✕
        </button>
      </div>
    );
  }
  return <IdeaCard key={state.card.intervention.id} card={state.card} />;
}

type Turn = { question?: string; answer: string | null; failed?: boolean };

function IdeaCard({ card }: { card: CardData }) {
  const id = card.intervention.id;
  const [saved, setSaved] = useState(false);
  const [thread, setThread] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => void panelCardItem.setValue(null);

  const answer = async (value: Feedback) => {
    close();
    await api.feedback({ interventionId: id, value }).then(touchSession, () => {});
  };

  const more = async (q?: string) => {
    setAsking(false);
    setQuestion('');
    setThread((t) => [...t, { question: q, answer: null }]);
    try {
      const { text } = await api.more(id, q);
      setThread((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer: text } : turn)));
    } catch {
      setThread((t) =>
        t.map((turn, i) =>
          i === t.length - 1 ? { ...turn, answer: "Couldn't answer right now. Try again.", failed: true } : turn,
        ),
      );
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim()) void more(question.trim());
  };

  const busy = thread.some((t) => t.answer === null);

  return (
    <Card className="space-y-3 border-accent/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-accent">{actionLabels[card.intervention.action]}</span>
        <button type="button" aria-label="Close" onClick={() => void answer('ignored')} className="text-muted hover:text-fg">
          ✕
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{card.intervention.text}</p>

      {thread.map((turn, i) => (
        <div key={i} className="space-y-1 border-t border-border pt-2">
          {turn.question && <p className="text-xs font-semibold text-muted">{turn.question}</p>}
          <p className={`text-[13px] leading-relaxed whitespace-pre-line ${turn.failed ? 'text-bad' : ''}`}>
            {turn.answer ?? 'Thinking…'}
          </p>
        </div>
      ))}

      {asking ? (
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="Ask something about this…"
            aria-label="Your question"
          />
          <Button type="submit" variant="primary" disabled={!question.trim()}>
            Send
          </Button>
        </form>
      ) : (
        <div className="flex gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => void more()}>
            Tell me more
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setAsking(true)}>
            Ask
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
        <Button size="sm" onClick={() => void answer('helped')}>
          Helpful
        </Button>
        <Button size="sm" onClick={() => void answer('not_interesting')}>
          Not interested
        </Button>
        <Button size="sm" onClick={() => void answer('distracted')}>
          Distracting
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={saved}
          onClick={() =>
            void api.save(id).then(
              () => setSaved(true),
              (err) => setError(errorMessage(err)),
            )
          }
        >
          {saved ? 'Saved ✓' : 'Save'}
        </Button>
      </div>
      {error && <Note tone="error">{error}</Note>}
    </Card>
  );
}
