/** One candidate model of a member, with the review observations the Host counted for it. */
export type CandidateReviewObservation = {
  harness: string;
  model: string;
  observations: { count: number; accepted: number; passed: number };
};

export type ModelPerformance = {
  model: string;
  harness: string;
  count: number;
  /** Fraction 0-1; absent when nothing was reviewed on this model. */
  firstPassRate?: number;
};

export type MemberPerformance = {
  reviewed: number;
  /** Fraction 0-1 of reviewed assignments that passed first time; absent when none reviewed. */
  firstPassRate?: number;
  /** Fraction 0-1 of reviewed assignments the owner accepted; absent when none reviewed. */
  acceptedRate?: number;
  /** Models with reviewed work, most reviewed first. */
  perModel: ModelPerformance[];
};

function rate(part: number, whole: number): number | undefined {
  return whole > 0 ? part / whole : undefined;
}

/** Sums the Host's per-candidate observations into the member's review performance. */
export function memberPerformance(candidates: CandidateReviewObservation[]): MemberPerformance {
  let reviewed = 0;
  let accepted = 0;
  let passed = 0;
  const models = new Map<
    string,
    { model: string; harness: string; count: number; passed: number }
  >();
  for (const candidate of candidates) {
    const { count, accepted: acceptedCount, passed: passedCount } = candidate.observations;
    reviewed += count;
    accepted += acceptedCount;
    passed += passedCount;
    if (count === 0) continue;
    const key = `${candidate.harness}\n${candidate.model}`;
    const entry = models.get(key) ?? {
      model: candidate.model,
      harness: candidate.harness,
      count: 0,
      passed: 0,
    };
    entry.count += count;
    entry.passed += passedCount;
    models.set(key, entry);
  }
  const perModel = [...models.values()]
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .map(({ model, harness, count, passed: modelPassed }) => ({
      model,
      harness,
      count,
      firstPassRate: rate(modelPassed, count),
    }));
  return {
    reviewed,
    firstPassRate: rate(passed, reviewed),
    acceptedRate: rate(accepted, reviewed),
    perModel,
  };
}
