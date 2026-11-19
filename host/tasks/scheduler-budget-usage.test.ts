import { describe, expect, it } from "vitest";
import type { TaskRunBudgetUsage } from "../../src/features/tasks/model/taskBudget";
import { budgetUsageChanged } from "./scheduler";

const usage = (overrides: Partial<TaskRunBudgetUsage> = {}): TaskRunBudgetUsage => ({
  historyComplete: true,
  agentMinutes: 1,
  attempts: 1,
  completedRuns: 0,
  runningRuns: 1,
  reportedTokens: 10,
  tokens: null,
  tokensComplete: false,
  unknownTokenRuns: 0,
  reportedCostUsd: null,
  estimatedCostUsd: null,
  measuredAt: 1000,
  ...overrides,
});

describe("budgetUsageChanged", () => {
  it("ignores the measurement time and live elapsed minutes of an unchanged running run", () => {
    expect(budgetUsageChanged(usage(), usage({ agentMinutes: 1.5, measuredAt: 31_000 }))).toBe(
      false,
    );
  });

  it("rewrites when tokens, cost or run counts change while a run is live", () => {
    expect(budgetUsageChanged(usage(), usage({ reportedTokens: 11 }))).toBe(true);
    expect(budgetUsageChanged(usage(), usage({ reportedCostUsd: 0.2 }))).toBe(true);
    expect(budgetUsageChanged(usage(), usage({ attempts: 2, runningRuns: 2 }))).toBe(true);
  });

  it("rewrites with exact minutes once the run settles or nothing was stored", () => {
    expect(
      budgetUsageChanged(usage(), usage({ agentMinutes: 2, runningRuns: 0, completedRuns: 1 })),
    ).toBe(true);
    expect(budgetUsageChanged(undefined, usage())).toBe(true);
    expect(
      budgetUsageChanged(usage({ runningRuns: 0 }), usage({ runningRuns: 0, agentMinutes: 2 })),
    ).toBe(true);
  });
});
