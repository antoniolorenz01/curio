import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const flag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true'));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('127.0.0.1'),
  // Only needed when the API is reachable from other machines.
  API_TOKEN: optional.pipe(z.string().min(16, 'API_TOKEN must be at least 16 characters').optional()),

  SUPABASE_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-5.4-mini'),
  OPENAI_MODEL_FAST: z.string().default('gpt-5.4-nano'),
  // Per tier. An empty value sends nothing and uses the model default.
  OPENAI_REASONING_EFFORT: z.string().default('low'),
  OPENAI_REASONING_EFFORT_FAST: z.string().default('none'),

  // Jev is on when a key is present, unless JEV_ENABLED=false.
  TYPESAFE_API_KEY: optional,
  JEV_ENABLED: flag(true),
  JEV_MODEL: z.string().default('jev-latest'),
  JEV_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),

  // LangSmith is on when a key is present, unless LANGSMITH_TRACING=false.
  LANGSMITH_API_KEY: optional,
  LANGSMITH_TRACING: flag(true),
  LANGSMITH_PROJECT: z.string().default('curio'),
});

export type Env = z.infer<typeof EnvSchema>;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (!parsed.data.API_TOKEN && !LOOPBACK.has(parsed.data.HOST)) {
    throw new Error(`Invalid environment:\n  API_TOKEN is required when HOST (${parsed.data.HOST}) is not local`);
  }
  return parsed.data;
}

export const jevEnabled = (env: Env) => Boolean(env.TYPESAFE_API_KEY) && env.JEV_ENABLED;
export const langsmithEnabled = (env: Env) => Boolean(env.LANGSMITH_API_KEY) && env.LANGSMITH_TRACING;
