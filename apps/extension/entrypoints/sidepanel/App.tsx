import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { closeIfStale } from '@/lib/session';
import { useSettings } from './hooks';
import { InsightsView } from './views/InsightsView';
import { Saved } from './views/Saved';
import { SettingsView } from './views/SettingsView';
import { Study } from './views/Study';

type View = 'study' | 'saved' | 'insights' | 'settings';

const secondary: { id: Exclude<View, 'study'>; label: string }[] = [
  { id: 'saved', label: 'Saved' },
  { id: 'insights', label: 'Insights' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const settings = useSettings();
  const [view, setView] = useState<View>('study');

  useEffect(() => {
    void closeIfStale();
  }, []);

  if (!settings) return null;
  const title = secondary.find((s) => s.id === view)?.label;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-11 items-center justify-between border-b border-border bg-bg/95 px-3 backdrop-blur">
        {view === 'study' ? (
          <h1 className="text-sm font-semibold tracking-tight">Curio</h1>
        ) : (
          <button type="button" onClick={() => setView('study')} className="flex items-center gap-1.5 text-sm font-medium">
            <span aria-hidden>←</span> {title}
          </button>
        )}
        {view === 'study' && <Menu onSelect={setView} />}
      </header>

      <main className="flex-1 p-3">
        {view === 'study' && <Study settings={settings} />}
        {view === 'saved' && <Saved />}
        {view === 'insights' && <InsightsView />}
        {view === 'settings' && <SettingsView settings={settings} />}
      </main>
    </div>
  );
}

function Menu({ onSelect }: { onSelect: (view: View) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('rounded-md px-2 py-1 text-muted hover:bg-subtle hover:text-fg', open && 'bg-subtle text-fg')}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-36 rounded-md border border-border bg-card p-1 shadow-lg">
          {secondary.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-subtle"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
