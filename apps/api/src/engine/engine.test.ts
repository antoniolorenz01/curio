import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from './actions';
import { createAssessorChain, type Assessor } from './assessor';
import { createJevAssessor } from './assessor/jev';
import { topByProbability } from './assessor/types';
import { chooseAction, computePosteriors, type FeedbackEvent } from './bandit';
import { mulberry32, sampleBeta } from './random';
import { applyRules, type RuleInput } from './rules';
import { verifyIntervention } from './verifier';

const baseRules: RuleInput = {
  trigger: 'selection',
  mode: 'occasional',
  paused: false,
  arm: 'suggestions',
  sessionEnded: false,
  contentChars: 500,
  timeSinceLastSuggestionSec: Number.POSITIVE_INFINITY,
  autoInterventions: 0,
  profile: DEFAULT_PROFILE,
};

describe('rules', () => {
  it('lets an eligible automatic trigger through', () => {
    expect(applyRules(baseRules)).toEqual({ blocked: false });
  });

  it.each([
    [{ paused: true }, 'paused'],
    [{ mode: 'silence' as const }, 'silence_mode'],
    [{ mode: 'manual' as const }, 'manual_mode'],
    [{ arm: 'control' as const }, 'control_arm'],
    [{ timeSinceLastSuggestionSec: 30 }, 'cooldown'],
    [{ autoInterventions: 6 }, 'session_cap'],
    [{ contentChars: 10 }, 'insufficient_content'],
    [{ sessionEnded: true }, 'session_ended'],
  ])('blocks automatic triggers: %o → %s', (patch, reason) => {
    expect(applyRules({ ...baseRules, ...patch })).toEqual({ blocked: true, reason });
  });

  it('lets manual requests through pause, silence, cooldown and control arm', () => {
    const manual = { ...baseRules, trigger: 'manual' as const, paused: true, mode: 'silence' as const, arm: 'control' as const, timeSinceLastSuggestionSec: 1 };
    expect(applyRules(manual)).toEqual({ blocked: false });
  });

  it('still blocks manual requests without enough content', () => {
    expect(applyRules({ ...baseRules, trigger: 'manual', contentChars: 5 })).toEqual({ blocked: true, reason: 'insufficient_content' });
  });
});

describe('bandit', () => {
  const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 20) - daysAgo * 86_400_000).toISOString();
  const now = Date.UTC(2026, 9, 20);

  it('updates posteriors by feedback and ignores "ignored"', () => {
    const events: FeedbackEvent[] = [
      { action: 'analogy', value: 'helped', createdAt: at(0) },
      { action: 'analogy', value: 'ignored', createdAt: at(0) },
      { action: 'surprise', value: 'distracted', createdAt: at(0) },
      { action: 'question', value: 'not_interesting', createdAt: at(0) },
    ];
    const p = computePosteriors(events, now);
    expect(p.analogy).toEqual({ alpha: 2, beta: 1 });
    expect(p.surprise).toEqual({ alpha: 1, beta: 3 });
    expect(p.question).toEqual({ alpha: 1, beta: 1.5 });
  });

  it('forgets old feedback gradually', () => {
    const p = computePosteriors([{ action: 'analogy', value: 'helped', createdAt: at(30) }], now, 30);
    expect(p.analogy.alpha).toBeCloseTo(1.5);
  });

  it('prefers actions that helped and returns selection probabilities', () => {
    const events: FeedbackEvent[] = Array.from({ length: 20 }, () => ({ action: 'real_world_use' as const, value: 'helped' as const, createdAt: at(0) }));
    const choice = chooseAction({
      eligible: ['real_world_use', 'analogy'],
      posteriors: computePosteriors(events, now),
      distractionRisk: 0,
      includeNone: false,
      rng: mulberry32(1),
    });
    expect(choice.action).toBe('real_world_use');
    expect(choice.probabilities.real_world_use).toBeGreaterThan(0.8);
  });

  it('chooses none more often when distraction risk is high', () => {
    const run = (risk: number) =>
      chooseAction({ eligible: ['question'], posteriors: computePosteriors([], now), distractionRisk: risk, includeNone: true, rng: mulberry32(7), samples: 2000 })
        .probabilities.none!;
    expect(run(0.9)).toBeGreaterThan(run(0.1));
    expect(run(0.9)).toBeGreaterThan(0.8);
  });

  it('samples Beta with the right mean', () => {
    const rng = mulberry32(3);
    const xs = Array.from({ length: 5000 }, () => sampleBeta(2, 6, rng));
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.25, 1);
  });
});

describe('verifier', () => {
  const material = 'The derivative measures the instantaneous rate of change of a function with respect to its variable.';

  it('accepts a short prompt anchored in the material (case ignored)', () => {
    expect(verifyIntervention('What else around you has a rate of change you could measure today?', 'RATE OF CHANGE', material)).toEqual({ ok: true });
  });

  it('requires an actual question for the question type', () => {
    const text = 'Two consuls ruled at once so that either could block the other.';
    expect(verifyIntervention(text, 'rate of change', material, 'question')).toEqual({ ok: false, reason: 'question_without_question' });
    expect(verifyIntervention(`${text} Why would a city want that?`, 'rate of change', material, 'question')).toEqual({ ok: true });
  });

  it('ignores accents when matching the anchor', () => {
    expect(verifyIntervention('Why did cafés become places to argue about ideas?', 'Cafe culture', 'Café culture in Vienna shaped modern thought.')).toEqual({ ok: true });
  });

  it.each([
    ['short', 'rate of change', 'too_short'],
    ['x'.repeat(401), 'rate of change', 'too_long'],
    ['See https://example.com for an example of derivatives.', 'rate of change', 'contains_link'],
    ['As an AI language model, I suggest thinking about derivatives.', 'rate of change', 'meta_or_injection'],
    ['How does the speed of a car change while it brakes?', 'car acceleration', 'ungrounded_anchor'],
    ['How does the speed of a car change while it brakes?', 'of', 'missing_anchor'],
  ])('rejects %s', (text, anchor, reason) => {
    expect(verifyIntervention(text, anchor, material)).toEqual({ ok: false, reason });
  });
});

describe('assessors', () => {
  const input = {
    context: {
      sessionId: 's', topic: 'derivatives', sourceType: 'web' as const, excerptOrSummary: 'text',
      interests: [], timeSinceLastSuggestionSec: 900, userPaused: false,
    },
    trigger: 'selection' as const,
    allowed: ['question', 'analogy', 'real_world_use'] as const,
  };
  const fixed = (name: string, confidence: number, fail = false): Assessor => ({
    name,
    async assess() {
      if (fail) throw new Error('boom');
      return { intervene: true, distractionRisk: 0.1, eligibleActions: ['analogy'], confidence, source: name };
    },
  });

  it('falls back on error and on low confidence, ending conservative', async () => {
    const chain = createAssessorChain([
      { assessor: fixed('jev', 0.4), minConfidence: 0.7 },
      { assessor: fixed('llm', 0, true), minConfidence: 0 },
    ]);
    const result = await chain.assess({ ...input, allowed: [...input.allowed] });
    expect(result.source).toBe('conservative');
    expect(result.intervene).toBe(false);
  });

  it('uses the first confident assessor', async () => {
    const chain = createAssessorChain([
      { assessor: fixed('jev', 0.9), minConfidence: 0.7 },
      { assessor: fixed('llm', 1), minConfidence: 0 },
    ]);
    expect((await chain.assess({ ...input, allowed: [...input.allowed] })).source).toBe('jev');
  });

  it('keeps top actions by probability mass', () => {
    expect(topByProbability({ question: 0.6, analogy: 0.3, real_world_use: 0.1 }, ['question', 'analogy', 'real_world_use'])).toEqual(['question', 'analogy']);
  });

  it('maps a Jev System One response', async () => {
    let body: any;
    const jev = createJevAssessor({
      apiKey: 'k',
      model: 'jev-latest',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return Response.json({
          model: 'jev-1.13',
          answers: {
            good_moment: { type: 'noul', noul: 0.9 },
            distraction: { type: 'noul', noul: 0.2 },
            fit: { type: 'choice', choice: 'analogy', confidence: 0.8, probabilities: { analogy: 0.8, question: 0.15, real_world_use: 0.05 } },
          },
          usage: { input_tokens: 120, output_tokens: 3 },
        });
      }) as typeof fetch,
    });
    const result = await jev.assess({ ...input, allowed: [...input.allowed] });
    expect(body.model).toBe('jev-latest');
    expect(Object.keys(body.questions.fit.criteria)).toEqual(['question', 'analogy', 'real_world_use']);
    expect(result).toMatchObject({ intervene: true, distractionRisk: 0.2, eligibleActions: ['analogy'], confidence: 0.8, source: 'jev' });
  });

  it('throws on Jev HTTP errors so the chain can fall back', async () => {
    const jev = createJevAssessor({ apiKey: 'k', model: 'm', fetchImpl: (async () => new Response('x', { status: 503 })) as typeof fetch });
    await expect(jev.assess({ ...input, allowed: [...input.allowed] })).rejects.toThrow('HTTP 503');
  });
});
