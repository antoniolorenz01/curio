import type { Assessment, Assessor, AssessInput } from './types';

export type { Assessment, Assessor, AssessInput } from './types';

export type AssessorStep = { assessor: Assessor; minConfidence: number };

/** Conservative last resort: never pushes an automatic intervention. */
export function conservativeAssessment(input: AssessInput): Assessment {
  return {
    intervene: false,
    distractionRisk: 0.5,
    eligibleActions: input.allowed,
    confidence: 0,
    source: 'conservative',
  };
}

/**
 * Tries each assessor in order, falling through on errors or low confidence,
 * and ends with the conservative rule. Lets Jev be added or removed freely.
 */
export function createAssessorChain(steps: AssessorStep[]): Assessor {
  return {
    name: steps.map((s) => s.assessor.name).join('>') || 'conservative',
    async assess(input) {
      for (const { assessor, minConfidence } of steps) {
        try {
          const result = await assessor.assess(input);
          if (result.confidence >= minConfidence) return result;
          console.info(`[assessor] ${assessor.name} confidence ${result.confidence.toFixed(2)} < ${minConfidence}, falling back`);
        } catch (err) {
          console.warn(`[assessor] ${assessor.name} failed, falling back:`, (err as Error).message);
        }
      }
      return conservativeAssessment(input);
    },
  };
}
