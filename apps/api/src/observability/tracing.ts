// Optional LangSmith tracing. When disabled, `langsmith` is never imported and
// `traced` is a plain passthrough, so removing the key (or the package) is safe.

type AnyFn = (...args: any[]) => any;
type Traceable = <F extends AnyFn>(fn: F, config: { name: string; run_type?: string }) => F;

let traceable: Traceable | null = null;

export async function initTracing(enabled: boolean, project: string): Promise<boolean> {
  if (!enabled) return false;
  try {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_PROJECT ??= project;
    const mod = await import('langsmith/traceable');
    traceable = mod.traceable as unknown as Traceable;
    return true;
  } catch (err) {
    console.warn('[tracing] LangSmith unavailable, continuing without it:', (err as Error).message);
    return false;
  }
}

/** Wraps `fn` in a LangSmith span when tracing is on; otherwise calls it directly. */
export function traced<F extends AnyFn>(name: string, fn: F, runType = 'chain'): F {
  let wrapped: F | null = null;
  return ((...args: Parameters<F>) => {
    if (!traceable) return fn(...args);
    wrapped ??= traceable(fn, { name, run_type: runType });
    return wrapped(...args);
  }) as F;
}

/** Patches an OpenAI client so each completion shows up as an LLM run. */
export async function wrapOpenAIClient<T extends object>(client: T): Promise<T> {
  if (!traceable) return client;
  try {
    const { wrapOpenAI } = await import('langsmith/wrappers');
    return wrapOpenAI(client as any) as unknown as T;
  } catch {
    return client;
  }
}
