import { Button, Card, Note, SectionTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { actionLabels } from '@/lib/labels';
import { useRemote } from '../hooks';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function Saved() {
  const { data, error, loading, reload } = useRemote(api.saved);
  const safeUrl = (url: string | null) => (url && /^https?:\/\//.test(url) ? url : null);

  return (
    <div>
      <SectionTitle
        action={
          <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
        }
      >
        Saved
      </SectionTitle>
      {error && <Note tone="error">{error}</Note>}
      {loading && !data && <Note>Loading…</Note>}
      {data && data.length === 0 && <Note>Nothing saved yet. Use “Save” on a suggestion to keep it here.</Note>}
      <ul className="space-y-2">
        {data?.map((item) => (
          <li key={item.id}>
            <Card className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="font-medium text-accent">{actionLabels[item.action]}</span>
                <time dateTime={item.savedAt}>{dateFormat.format(new Date(item.savedAt))}</time>
              </div>
              <p className="text-sm whitespace-pre-line">{item.text}</p>
              {(item.topic || safeUrl(item.url)) && (
                <p className="truncate text-xs text-muted">
                  {item.topic}
                  {safeUrl(item.url) && (
                    <>
                      {item.topic && ' · '}
                      <a href={safeUrl(item.url)!} target="_blank" rel="noreferrer" className="underline hover:text-fg">
                        source
                      </a>
                    </>
                  )}
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
