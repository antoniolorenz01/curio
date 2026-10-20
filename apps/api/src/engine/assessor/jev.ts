import { z } from 'zod';
import { ACTION_DESCRIPTIONS } from '../actions';
import { assessmentState, topByProbability, type Assessor } from './types';

// Raw HTTP client for TypeSafe's System One endpoint (docs.typesafe.ai/api/system-one).
// No SDK dependency, so Jev can be switched off just by removing TYPESAFE_API_KEY.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

const Response = z.object({
  model: z.string().optional(),
  answers: z.object({
    good_moment: z.object({ noul: z.number() }),
    distraction: z.object({ noul: z.number() }),
    fit: z.object({
      choice: z.string(),
      confidence: z.number(),
      probabilities: z.record(z.string(), z.number()),
    }),
  }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

type Options = { apiKey: string; model: string; timeoutMs?: number; fetchImpl?: typeof fetch };

export function createJevAssessor(opts: Options): Assessor {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    name: 'jev',
    async assess(input) {
      const criteria = Object.fromEntries(input.allowed.map((a) => [a, ACTION_DESCRIPTIONS[a]]));
      const res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
        body: JSON.stringify({
          model: opts.model,
          state: assessmentState(input),
          questions: {
            good_moment: {
              type: 'noul',
              instructions:
                'Is this a good moment to offer the learner one brief, optional curiosity prompt about the material without breaking their focus?',
              criteria: {
                true: 'A short optional prompt would likely deepen interest now.',
                false: 'The learner is better left alone right now.',
              },
            },
            distraction: {
              type: 'noul',
              instructions: 'Would an interruption right now likely distract the learner from their study goal?',
            },
            fit: {
              type: 'choice',
              instructions: 'Which kind of curiosity prompt fits this material best?',
              criteria,
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`jev: HTTP ${res.status}`);

      const { answers, usage } = Response.parse(await res.json());
      const goodMoment = answers.good_moment.noul;
      const probabilities = answers.fit.probabilities as Partial<Record<(typeof input.allowed)[number], number>>;

      return {
        intervene: goodMoment >= 0.5,
        distractionRisk: answers.distraction.noul,
        eligibleActions: topByProbability(probabilities, input.allowed),
        // Least certain of the two decisions that matter.
        confidence: Math.min(answers.fit.confidence, Math.max(goodMoment, 1 - goodMoment)),
        source: 'jev',
        usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : undefined,
      };
    },
  };
}
