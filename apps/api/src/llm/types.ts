import type { z } from 'zod';

export type Usage = { inputTokens: number; outputTokens: number };

export type JsonRequest<T> = {
  /** Span / log name. */
  name: string;
  tier: 'fast' | 'main';
  system: string;
  user: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
};

export interface Llm {
  json<T>(req: JsonRequest<T>): Promise<{ data: T; usage: Usage }>;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

export const noUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0 });
