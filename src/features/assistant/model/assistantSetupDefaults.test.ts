import { expect, it } from "vitest";
import { assistantSetupDefaults } from "./assistantSetupDefaults";

it("offers one million tokens for an unconfigured missing or zero budget without granting authority", () => {
  for (const dailyTokenBudget of [undefined, 0]) {
    const profile = Object.freeze({
      dailyTokenBudget,
      setupComplete: false,
      autonomy: "report" as const,
      enabled: false,
    });
    expect(assistantSetupDefaults(profile)).toEqual({ ...profile, dailyTokenBudget: 1_000_000 });
    expect(profile.dailyTokenBudget).toBe(dailyTokenBudget);
  }
});

it("retains chosen budgets and completed profiles, including a disabled zero budget", () => {
  for (const profile of [
    { dailyTokenBudget: 5, setupComplete: false },
    { dailyTokenBudget: 275_000, setupComplete: false },
    { dailyTokenBudget: 0, setupComplete: true },
  ])
    expect(assistantSetupDefaults(profile)).toBe(profile);
});
