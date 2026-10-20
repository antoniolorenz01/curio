import OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import { wrapOpenAIClient } from '../observability/tracing';
import type { JsonRequest, Llm } from './types';

type Options = {
  apiKey: string;
  model: string;
  fastModel: string;
  reasoningEffort?: string;
  fastReasoningEffort?: string;
};

export async function createOpenAiLlm(opts: Options): Promise<Llm> {
  const client = await wrapOpenAIClient(new OpenAI({ apiKey: opts.apiKey, maxRetries: 1 }));

  return {
    async json<T>(req: JsonRequest<T>) {
      const effort = req.tier === 'fast' ? opts.fastReasoningEffort : opts.reasoningEffort;
      const completion = await client.chat.completions.create(
        {
          model: req.tier === 'fast' ? opts.fastModel : opts.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: 2000,
          ...(effort ? { reasoning_effort: effort as ReasoningEffort } : {}),
        },
        { timeout: req.timeoutMs },
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error(`${req.name}: empty completion`);
      const data = req.schema.parse(JSON.parse(content));
      return {
        data,
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
