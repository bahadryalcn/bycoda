/**
 * One confidence scale for every provider, in [0, 1]. Providers report different confidence
 * definitions, so the gateway keeps their raw values and computes this value from probabilities.
 *
 * - choice and score with n options: c = (n * p_max - 1) / (n - 1), clamped to [0, 1].
 *   Uniform probabilities give 0; a one-hot distribution gives 1. Verified against the owner's
 *   recorded Clef choice answers (clef verification 2026-10-06): the formula reproduces Clef's
 *   own `confidence` exactly for every choice case.
 * - noul with P(true) = p: c = max(p, 1 - p). With the default threshold 0.85 this accepts exactly
 *   p >= 0.85 or p <= 0.15, which is the rule the owner set. The earlier idea |2p - 1| would have
 *   required p >= 0.925 for the same threshold, so it is not used. Equivalently c = (1 + |2p - 1|) / 2.
 * - Single option (n = 1): c = p_max.
 *
 * Score answers use the same choice formula over the level distribution. This is the Gateway's
 * own scale; Clef's score confidence is different (checked on C11 and C12) and is kept only as
 * `raw`.
 */

/** Renormalizes a probability list. Returns null when the list is empty, has a non-finite or negative entry, or sums to zero. */
export function normalizeDistribution(values: readonly number[]): number[] | null {
  if (values.length === 0) return null;
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum <= 0) return null;
  return values.map((value) => value / sum);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Confidence of a choice or score answer from its normalized probabilities. */
export function distributionConfidence(probabilities: readonly number[]): number {
  const n = probabilities.length;
  const max = Math.max(...probabilities);
  if (n < 2) return clamp01(max);
  return clamp01((n * max - 1) / (n - 1));
}

/** Confidence of a noul answer from the probability that the statement is true. */
export function noulConfidence(probabilityTrue: number): number {
  const p = clamp01(probabilityTrue);
  return Math.max(p, 1 - p);
}

/** Index of the most probable option; ties resolve to the lowest index. */
export function argmax(probabilities: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[best]) best = index;
  }
  return best;
}
