import type { Profile, StimulusAction } from '@curio/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, Input, Label, Note, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { actionLabels, stimulusActions } from '@/lib/labels';
import { updateSettings, type Settings } from '@/lib/storage';
import { useRemote } from '../hooks';

type Status = { tone: 'muted' | 'error'; text: string } | null;

export function SettingsView({ settings }: { settings: Settings }) {
  return (
    <div className="space-y-6">
      <ProfileSettings />
      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase">Advanced</summary>
        <div className="pt-3">
          <ConnectionSettings settings={settings} />
        </div>
      </details>
    </div>
  );
}

function ConnectionSettings({ settings }: { settings: Settings }) {
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [apiToken, setApiToken] = useState(settings.apiToken);
  const [checkpointMin, setCheckpointMin] = useState(String(settings.checkpointMin));
  const [status, setStatus] = useState<Status>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minutes = Math.round(Number(checkpointMin));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
      setStatus({ tone: 'error', text: 'The interval must be between 1 and 120 minutes.' });
      return;
    }
    try {
      new URL(apiUrl);
    } catch {
      setStatus({ tone: 'error', text: 'The server URL is not valid.' });
      return;
    }
    await updateSettings({ apiUrl: apiUrl.trim(), apiToken: apiToken.trim(), checkpointMin: minutes });
    setStatus({ tone: 'muted', text: 'Saved.' });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <Label>Server</Label>
        <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:8787" />
      </label>
      <label className="block">
        <Label hint="only if the server isn't on this computer">Token</Label>
        <Input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} autoComplete="off" />
      </label>
      <label className="block">
        <Label hint="automatic suggestions">Check the page every (min)</Label>
        <Input
          type="number"
          min={1}
          max={120}
          value={checkpointMin}
          onChange={(e) => setCheckpointMin(e.target.value)}
        />
      </label>
      {status && <Note tone={status.tone}>{status.text}</Note>}
      <Button type="submit">Save</Button>
    </form>
  );
}

function ProfileSettings() {
  const { data, error, loading, reload, setData } = useRemote(api.getProfile);

  return (
    <section className="space-y-3">
      <SectionTitle
        action={
          error ? (
            <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading}>
              Retry
            </Button>
          ) : undefined
        }
      >
        Preferences
      </SectionTitle>
      {error && <Note tone="error">{error}</Note>}
      {loading && !data && <Note>Loading…</Note>}
      {data && <ProfileForm profile={data} onSaved={setData} />}
    </section>
  );
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const [interests, setInterests] = useState(profile.interests.join(', '));
  const [disabled, setDisabled] = useState<StimulusAction[]>(profile.disabledActions);
  const [cooldownMin, setCooldownMin] = useState(String(Math.round(profile.cooldownSec / 60)));
  const [maxAuto, setMaxAuto] = useState(String(profile.maxAutoPerSession));
  const [controlPct, setControlPct] = useState(String(Math.round(profile.controlRate * 100)));
  const [language, setLanguage] = useState(profile.language);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setStatus(null), [interests, disabled, cooldownMin, maxAuto, controlPct, language]);

  const toggle = (action: StimulusAction) =>
    setDisabled((current) => (current.includes(action) ? current.filter((a) => a !== action) : [...current, action]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cooldown = Math.round(Number(cooldownMin) * 60);
    const max = Math.round(Number(maxAuto));
    const control = Number(controlPct) / 100;
    if (!(cooldown >= 60 && cooldown <= 7200))
      return setStatus({ tone: 'error', text: 'The pause between suggestions must be 1 to 120 min.' });
    if (!(max >= 0 && max <= 50)) return setStatus({ tone: 'error', text: 'The per-session maximum must be 0 to 50.' });
    if (!(control >= 0 && control <= 1))
      return setStatus({ tone: 'error', text: 'The control percentage must be 0 to 100.' });
    if (disabled.length === stimulusActions.length)
      return setStatus({ tone: 'error', text: 'Keep at least one type enabled.' });

    setBusy(true);
    try {
      const saved = await api.updateProfile({
        interests: interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 30)
          .map((s) => s.slice(0, 80)),
        disabledActions: disabled,
        cooldownSec: cooldown,
        maxAutoPerSession: max,
        controlRate: control,
        language: language.trim() || 'en',
      });
      onSaved(saved);
      setStatus({ tone: 'muted', text: 'Preferences saved.' });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <Label hint="comma-separated">Your interests</Label>
        <Input
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="programming, music, history"
        />
      </label>
      <Note>Curio uses them to connect what you read with what you enjoy.</Note>

      <fieldset>
        <Label>Kinds of ideas</Label>
        <Card className="grid grid-cols-2 gap-1.5 p-2">
          {stimulusActions.map((action) => (
            <label key={action} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!disabled.includes(action)} onChange={() => toggle(action)} />
              {actionLabels[action]}
            </label>
          ))}
        </Card>
      </fieldset>

      <details>
        <summary className="cursor-pointer text-xs text-muted">More options</summary>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <label className="block">
            <Label>Minimum pause (min)</Label>
            <Input
              type="number"
              min={1}
              max={120}
              value={cooldownMin}
              onChange={(e) => setCooldownMin(e.target.value)}
            />
          </label>
          <label className="block">
            <Label>Max automatic</Label>
            <Input type="number" min={0} max={50} value={maxAuto} onChange={(e) => setMaxAuto(e.target.value)} />
          </label>
          <label className="block">
            <Label hint="%">Control sessions</Label>
            <Input type="number" min={0} max={100} value={controlPct} onChange={(e) => setControlPct(e.target.value)} />
          </label>
          <label className="block">
            <Label hint="for suggestions">Language</Label>
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={10} placeholder="en" />
          </label>
        </div>
        <Note>
          Control sessions: a share of sessions with no automatic suggestions, to compare whether they help.
        </Note>
      </details>

      {status && <Note tone={status.tone}>{status.text}</Note>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
