import { describe, expect, it } from "vitest";
import { parseTaskRunBudget } from "./taskBudget";

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
