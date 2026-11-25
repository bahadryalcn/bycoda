import { describe, expect, it } from "vitest";
import {
  canContinueTaskRuntime,
  parseTaskRunBudget,
  usageUpperBoundMinutes,
  type TaskRunBudgetUsage,
} from "./taskBudget";

describe("task run budgets", () => {
  it("retains optional legacy compatibility and normalizes unlimited values", () => {
    expect(parseTaskRunBudget(undefined)).toBeUndefined();
    expect(parseTaskRunBudget({})).toBeUndefined();
    expect(
      parseTaskRunBudget({ maxAttempts: 0, maxTokens: 0, maxAgentMinutes: 0 }),
    ).toBeUndefined();
    expect(parseTaskRunBudget({ maxAgentMinutes: 1.5, maxAttempts: 4, maxTokens: 500 })).toEqual({
      maxAgentMinutes: 1.5,
      maxAttempts: 4,
      maxTokens: 500,
      warningPercent: 80,
    });
  });
  it("preserves the owner's warning threshold", () => {
    expect(parseTaskRunBudget({ maxAttempts: 2, warningPercent: 95 })?.warningPercent).toBe(95);
  });
  it.each([
    null,
    [],
    "budget",
    { maxAttempts: -1 },
    { maxAttempts: 1.5 },
    { maxAttempts: "2" },
    { maxAgentMinutes: Infinity },
    { maxAgentMinutes: NaN },
    { maxAgentMinutes: 52_560_001 },
    { maxTokens: Number.MAX_SAFE_INTEGER + 1 },
    { warningPercent: 0 },
    { warningPercent: 101 },
    { warningPercent: 1.5 },
    { maxCost: 20 },
    { maxAttempts: 2, maxCost: 5 },
  ])("rejects malformed budget %j", (raw) => {
    expect(() => parseTaskRunBudget(raw)).toThrow();
  });
});

describe("unverified runtime decision", () => {
  const usage = (
    agentMinutes: number,
    uncertainty?: { extraMinutes: number; unboundedRuns: number },
  ) => ({ historyComplete: !uncertainty, agentMinutes, uncertainty }) as TaskRunBudgetUsage;
  const task = (budgetUsage: TaskRunBudgetUsage) => ({
    status: "blocked",
    maxRunMinutes: 70,
    budgetUsage,
  });
  it("offers the decision only when the upper bound reaches the limit or does not exist", () => {
    expect(canContinueTaskRuntime(task(usage(60, { extraMinutes: 20, unboundedRuns: 0 })))).toBe(
      true,
    );
    expect(canContinueTaskRuntime(task(usage(60, { extraMinutes: 5, unboundedRuns: 0 })))).toBe(
      false,
    );
    expect(canContinueTaskRuntime(task(usage(60, { extraMinutes: 0, unboundedRuns: 1 })))).toBe(
      true,
    );
    expect(canContinueTaskRuntime(task(usage(75, { extraMinutes: 5, unboundedRuns: 0 })))).toBe(
      false,
    );
    expect(canContinueTaskRuntime({ ...task(usage(60)), status: "queued" })).toBe(false);
  });
  it("stops counting uncertainty the owner accepted", () => {
    const measured = usage(60, { extraMinutes: 20, unboundedRuns: 1 });
    const runtimeAccepted = { extraMinutes: 20, unboundedRuns: 1, at: 1 };
    expect(usageUpperBoundMinutes(measured)).toBeNull();
    expect(usageUpperBoundMinutes(measured, runtimeAccepted)).toBe(60);
    expect(canContinueTaskRuntime({ ...task(measured), runtimeAccepted })).toBe(false);
  });
});
