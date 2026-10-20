import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createAssessorChain, type AssessorStep } from './engine/assessor';
import { createJevAssessor } from './engine/assessor/jev';
import { createLlmAssessor } from './engine/assessor/llm';
import { jevEnabled, langsmithEnabled, loadEnv } from './env';
import { createOpenAiLlm } from './llm/openai';
import { initTracing } from './observability/tracing';
import { createMemoryStore } from './store/memory';
import { createSupabaseStore } from './store/supabase';

const env = loadEnv();

const tracing = await initTracing(langsmithEnabled(env), env.LANGSMITH_PROJECT);

const llm = await createOpenAiLlm({
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  fastModel: env.OPENAI_MODEL_FAST,
  reasoningEffort: env.OPENAI_REASONING_EFFORT,
  fastReasoningEffort: env.OPENAI_REASONING_EFFORT_FAST,
});

// Jev first when configured, then the small LLM, then the conservative rule.
const steps: AssessorStep[] = [];
if (jevEnabled(env)) {
  steps.push({
    assessor: createJevAssessor({ apiKey: env.TYPESAFE_API_KEY!, model: env.JEV_MODEL }),
    minConfidence: env.JEV_MIN_CONFIDENCE,
  });
}
steps.push({ assessor: createLlmAssessor(llm), minConfidence: 0 });

const useSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
if (!useSupabase) {
  console.warn('[api] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: using in-memory store (data is lost on restart)');
}
const store = useSupabase
  ? createSupabaseStore(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
  : createMemoryStore();

const app = createApp({ store, llm, assessor: createAssessorChain(steps), apiToken: env.API_TOKEN });

serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, () => {
  console.log(`api on http://${env.HOST}:${env.PORT}${env.API_TOKEN ? ' (token required)' : ' (local, no token)'}`);
  console.log(
    `  store=${useSupabase ? 'supabase' : 'memory'}` +
      ` assessor=${steps.map((s) => s.assessor.name).join('>')}>conservative` +
      ` langsmith=${tracing ? 'on' : 'off'}`,
  );
});
