import { expect, it } from "vitest";
import { assistantSetupDefaults } from "./assistantSetupDefaults";

it("offers one million tokens for a missing, zero or below-minimum budget without granting authority", () => {
  for (const [dailyTokenBudget, setupComplete] of [
    [undefined, false],
    [0, false],
    [5, false],
    // A completed profile without a usable budget would otherwise block quick setup.
    [0, true],
    [19_999, true],
  ] as const) {
    const profile = Object.freeze({
      dailyTokenBudget,
      setupComplete,
      autonomy: "report" as const,
      enabled: false,
    });
    expect(assistantSetupDefaults(profile)).toEqual({ ...profile, dailyTokenBudget: 1_000_000 });
    expect(profile.dailyTokenBudget).toBe(dailyTokenBudget);
  }
});

it("retains chosen budgets at or above the minimum", () => {
  for (const profile of [
    { dailyTokenBudget: 20_000, setupComplete: false },
    { dailyTokenBudget: 275_000, setupComplete: true },
  ])
    expect(assistantSetupDefaults(profile)).toBe(profile);
});
