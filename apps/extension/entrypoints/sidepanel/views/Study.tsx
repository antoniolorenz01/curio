import type { StimulusAction } from '@curio/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Input, Note, RatingInput, Switch } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { actionLabels, stimulusActions } from '@/lib/labels';
import type { PanelMessage, Result } from '@/lib/messages';
import { endSession, ensureSession } from '@/lib/session';
import { autoOn, updateSettings, type ActiveSession, type Settings } from '@/lib/storage';
import { useSession } from '../hooks';

export function Study({ settings }: { settings: Settings }) {
  const session = useSession();

  return (
    <div className="space-y-5">
      <Ask />
      <div className="space-y-3">
        <AutoSuggest settings={settings} />
        <Switch
          checked={settings.selectionButton}
          onChange={(selectionButton) => void updateSettings({ selectionButton })}
          label="Button on selected text"
          description="Shows Curio next to the text you select."
        />
      </div>
      <OwnQuestion autoSuggest={autoOn(settings)} />
      {session && <SessionFooter session={session} />}
    </div>
  );
}

function Ask() {
  const [choosing, setChoosing] = useState(false);
  const [action, setAction] = useState<StimulusAction | ''>('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    setBusy(true);
    setNote(null);
    const message: PanelMessage = { type: 'curio:request-active', requestedAction: action || undefined };
    const result = (await browser.runtime.sendMessage(message).catch(() => null)) as Result | null;
    if (!result?.ok) setNote(result?.reason ?? "Couldn't reach the extension. Try reloading it.");
    setBusy(false);
  };

  return (
    <Card className="space-y-2.5">
      <p className="text-xs text-muted">
        Select text on the page and tap <b>Curio</b>, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>. The
        idea shows up in a corner of the page.
      </p>
      <Button variant="primary" className="w-full" disabled={busy} onClick={() => void ask()}>
        {action ? `Suggest: ${actionLabels[action]}` : 'Suggest something about this page'}
      </Button>
      {choosing ? (
        <select
          aria-label="Kind of idea"
          value={action}
          onChange={(e) => setAction(e.target.value as StimulusAction | '')}
          className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-fg"
        >
          <option value="">Let Curio choose</option>
          {stimulusActions.map((a) => (
            <option key={a} value={a}>
              {actionLabels[a]}
            </option>
          ))}
        </select>
      ) : (
        <button type="button" onClick={() => setChoosing(true)} className="text-xs text-muted hover:text-fg">
          Choose the kind of idea
        </button>
      )}
      {note && <Note tone="error">{note}</Note>}
    </Card>
  );
}

function AutoSuggest({ settings }: { settings: Settings }) {
  const [askingConsent, setAskingConsent] = useState(false);
  const on = autoOn(settings);

  const toggle = (next: boolean) => {
    if (next && !settings.autoConsent) return setAskingConsent(true);
    void updateSettings({ autoSuggest: next });
  };

  return (
    <div className="space-y-2">
      <Switch
        checked={on}
        onChange={toggle}
        label="Automatic suggestions"
        description={on ? 'Now and then, only when it seems like a good moment.' : 'Only when you ask.'}
      />
      {askingConsent && (
        <Card className="space-y-2">
          <p className="text-xs">
            Curio will read pages you stay on (about 45 s) and long passages you select, to decide whether a
            suggestion is worth it. Once per page, and never more than one suggestion every few minutes. It never reads
            mail, chats, social feeds, or account and banking pages.
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setAskingConsent(false);
                void updateSettings({ autoConsent: true, autoSuggest: true });
              }}
            >
              Turn on
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAskingConsent(false)}>
              Not now
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function OwnQuestion({ autoSuggest }: { autoSuggest: boolean }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<{ tone: 'muted' | 'error'; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    try {
      const sessionId = await ensureSession(autoSuggest);
      await api.explore({ sessionId, kind: 'question', content: text });
      setContent('');
      setStatus({ tone: 'muted', text: 'Question noted.' });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-1.5 border-t border-border pt-4">
      <div className="flex gap-2">
        <Input
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setStatus(null);
          }}
          maxLength={2000}
          placeholder="Note a question of your own…"
          aria-label="Your own question"
        />
        <Button type="submit" disabled={!content.trim()}>
          Note
        </Button>
      </div>
      {status && <Note tone={status.tone}>{status.text}</Note>}
    </form>
  );
}

function SessionFooter({ session }: { session: ActiveSession }) {
  const [rating, setRating] = useState(false);
  const [curiosity, setCuriosity] = useState<number>();
  const [attention, setAttention] = useState<number>();
  const since = new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => setRating(false), [session.sessionId]);

  const finish = async (withRatings: boolean) => {
    await endSession(withRatings ? { curiosityAfter: curiosity, attentionAfter: attention } : {});
    setRating(false);
  };

  if (!rating) {
    return (
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Studying since {since}</span>
        <button type="button" onClick={() => setRating(true)} className="hover:text-fg">
          Finish
        </button>
      </div>
    );
  }

  return (
    <Card className="space-y-3">
      <p className="text-sm font-medium">How did it go?</p>
      <RatingInput label="Did it spark your curiosity?" value={curiosity} onChange={setCuriosity} />
      <RatingInput label="Could you stay focused?" value={attention} onChange={setAttention} />
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={!curiosity && !attention} onClick={() => void finish(true)}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void finish(false)}>
          Skip
        </Button>
      </div>
    </Card>
  );
}
