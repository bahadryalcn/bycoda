import { describe, expect, it } from "vitest";
import {
  argmax,
  distributionConfidence,
  noulConfidence,
  normalizeDistribution,
} from "./confidence";
import { DEFAULT_THRESHOLD } from "./decision-types";

describe("distributionConfidence", () => {
  it("is zero for a uniform distribution and one for a one-hot distribution", () => {
    expect(distributionConfidence([1 / 3, 1 / 3, 1 / 3])).toBeCloseTo(0, 12);
    expect(distributionConfidence([1, 0, 0])).toBe(1);
  });

  it("reproduces the confidence Clef reports for its choice answers (C01)", () => {
    // Clef answer C01-business-area: probabilities and confidence 0.985261026170726 (results.json).
    const probabilities = [
      0.9889457696280445, 0.003915241042971129, 0.00398514332312772, 0.0031538460058569374,
    ];
    expect(distributionConfidence(probabilities)).toBeCloseTo(0.985261026170726, 9);
  });

  it("uses the single value for a one-option list", () => {
    expect(distributionConfidence([0.6])).toBe(0.6);
  });
});

describe("noulConfidence", () => {
  it("is max(p, 1 - p), so the default threshold accepts p >= 0.85 or p <= 0.15", () => {
    expect(DEFAULT_THRESHOLD).toBe(0.85);
    expect(noulConfidence(0.9)).toBeCloseTo(0.9, 12);
    expect(noulConfidence(0.1)).toBeCloseTo(0.9, 12);
    expect(noulConfidence(0.5)).toBeCloseTo(0.5, 12);
    // Clef C07 (P(true) = 0.0158) and C08 (P(true) = 0.978) both pass the threshold.
    expect(noulConfidence(0.01577203927198383) >= DEFAULT_THRESHOLD).toBe(true);
    expect(noulConfidence(0.9782812900580788) >= DEFAULT_THRESHOLD).toBe(true);
    // Values just inside the band are rejected.
    expect(noulConfidence(0.16) >= DEFAULT_THRESHOLD).toBe(false);
    expect(noulConfidence(0.84) >= DEFAULT_THRESHOLD).toBe(false);
  });

  it("clamps out-of-range input", () => {
    expect(noulConfidence(1.4)).toBe(1);
    expect(noulConfidence(-0.2)).toBe(1);
  });
});

describe("normalizeDistribution", () => {
  it("renormalizes a list that does not sum to one", () => {
    expect(normalizeDistribution([2, 2])).toEqual([0.5, 0.5]);
  });

  it("rejects empty, negative, non-finite and zero-sum lists", () => {
    expect(normalizeDistribution([])).toBeNull();
    expect(normalizeDistribution([0.5, -0.1])).toBeNull();
    expect(normalizeDistribution([Number.NaN, 0.5])).toBeNull();
    expect(normalizeDistribution([0, 0])).toBeNull();
  });
});

describe("argmax", () => {
  it("returns the lowest index on a tie", () => {
    expect(argmax([0.2, 0.4, 0.4])).toBe(1);
    expect(argmax([0.1, 0.7, 0.2])).toBe(1);
  });
});
