import type { WxtStorageItem } from '#imports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { defaultSettings, sessionItem, settingsItem, type ActiveSession, type Settings } from '@/lib/storage';

/** Subscribes to a WXT storage item. `undefined` means still loading. */
export function useStorageItem<T>(item: WxtStorageItem<T, {}>) {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    item.getValue().then((v) => alive && setValue(v));
    const unwatch = item.watch((v) => setValue(v));
    return () => {
      alive = false;
      unwatch();
    };
  }, [item]);
  return value;
}

export function useSettings(): Settings | undefined {
  const value = useStorageItem(settingsItem);
  return useMemo(() => value && { ...defaultSettings, ...value }, [value]);
}

export function useSession(): ActiveSession | null | undefined {
  return useStorageItem(sessionItem);
}

/** Fetches once on mount and exposes a reload. */
export function useRemote<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadRef.current());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
