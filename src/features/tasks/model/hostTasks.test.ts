import { describe, expect, it } from "vitest";
import { parseHostTask, taskRequiresInstructions, type HostTask } from "./hostTasks";

const input = {
  id: "task",
  title: "Complete the report",
  prompt: "Finish all report sections",
  projectId: "project",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
};

describe("continuous task execution contract", () => {
  it("clears an explicit null reviewer without changing legacy omission semantics", () => {
    const omitted = parseHostTask(input);
    expect(Object.prototype.hasOwnProperty.call(omitted, "reviewerConfig")).toBe(false);
    const cleared = parseHostTask({ ...input, reviewerConfig: null });
    expect(Object.prototype.hasOwnProperty.call(cleared, "reviewerConfig")).toBe(true);
    expect(cleared.reviewerConfig).toBeUndefined();
    expect(JSON.parse(JSON.stringify(cleared))).not.toHaveProperty("reviewerConfig");
  });

  it.each([false, [], "none", 42, { model: "missing-fields" }])(
    "still rejects malformed reviewer profiles: %j",
    (reviewerConfig) => {
      expect(() => parseHostTask({ ...input, reviewerConfig })).toThrow("Invalid crew reviewer");
    },
  );

  it("retains named profiles, rejects paths and preserves the legacy default", () => {
    expect(parseHostTask({ ...input, providerAccountId: "account-work" }).providerAccountId).toBe(
      "account-work",
    );
    expect(parseHostTask(input).providerAccountId).toBeUndefined();
    for (const providerAccountId of ["../other", "", 12, null])
      expect(() => parseHostTask({ ...input, providerAccountId })).toThrow(
        "Invalid provider account ID",
      );
    expect(() => parseHostTask({ ...input, harness: "grok", providerAccountId: "work" })).toThrow(
      "Invalid provider account ID",
    );
  });
  it("preserves an enabled option and removes a disabled one", () => {
    expect(parseHostTask({ ...input, continueUntilDone: true }).continueUntilDone).toBe(true);
    expect(parseHostTask({ ...input, continueUntilDone: false }).continueUntilDone).toBeUndefined();
    expect(() => parseHostTask({ ...input, continueUntilDone: "true" })).toThrow(
      "Invalid task options",
    );
  });

  it("holds legacy budgets but allows progress beyond them in continuous mode", () => {
    const task: HostTask = {
      ...parseHostTask(input),
      status: "queued",
      createdAt: 0,
      updatedAt: 0,
      repairAttempts: 7,
      reviewFailureCount: 7,
    };
    expect(taskRequiresInstructions(task)).toBe(true);
    expect(taskRequiresInstructions({ ...task, continueUntilDone: true })).toBe(false);
  });

  it.each(["external", "no_progress"] as const)(
    "preserves %s blockers after the independent recovery",
    (reason) => {
      const task: HostTask = {
        ...parseHostTask(input),
        continueUntilDone: true,
        status: "blocked",
        createdAt: 0,
        updatedAt: 0,
        repairStop: { reason, message: "Concrete next action" },
        blockedTakeover: { at: 0, blocker: "Retained blocker" },
      };
      expect(taskRequiresInstructions(task)).toBe(true);
    },
  );
});
