import { describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { MAX_REPAIR_ATTEMPTS, MAX_RUNTIME_RETRIES } from "./constants";
import { queueTakeover, repairOrBlock, retryTransientFailure } from "./recovery";
import {
  canTakeOverBlockedTask,
  MAX_TASK_REVIEW_FAILURES,
  taskRequiresInstructions,
} from "../../src/features/tasks/model/taskRules";

function setup(overrides: Partial<HostTask> = {}) {
  const task = {
    id: "task",
    projectId: "project",
    sessionId: "worker",
    status: "verifying",
    updatedAt: 10,
    reviewFailureCount: 1,
    verification: { review: { verdict: "fail", note: "Missing result", sessionId: "reviewer" } },
    ...overrides,
  } as HostTask;
  let current = task;
  let generation = 7;
  const generationRead = vi.fn(async (id: string) => {
    if (id !== task.id) throw new Error(`Unexpected admission generation task: ${id}`);
    return { generation };
  });
  const call = vi.fn(async (action: string) =>
    action === "agents.consult"
      ? { runId: "advisor", status: "running" }
      : { runId: "advisor", status: "succeeded", result: "Check the missing branch." },
  );
  const context = {
    store: {
      db: {
        prepare: vi.fn((sql: string) => {
          if (sql !== "SELECT generation FROM task_admission_generation WHERE id=?")
            throw new Error(`Unexpected repair fixture query: ${sql}`);
          return { get: generationRead };
        }),
      },
    },
    repairDelegation: { call },
    taskValue: vi.fn().mockResolvedValue("original"),
    unchangedTask: vi.fn().mockResolvedValue(task),
    transaction: async (work: () => Promise<unknown>) => work(),
    goalExecutionAllowed: vi.fn().mockResolvedValue(true),
    budgetReason: vi.fn().mockResolvedValue(undefined),
    now: () => 20,
    retryFeedback: vi.fn().mockResolvedValue("Missing result"),
    write: vi.fn(
      async (
        value: HostTask,
        _expectedValue?: string,
        reviewed?: HostTask,
        expectedGeneration?: number,
      ) => {
        if (expectedGeneration !== undefined && expectedGeneration !== generation)
          throw new Error("Task admission generation changed.");
        if (reviewed !== undefined && reviewed !== current)
          throw new Error("Reviewed task changed.");
        current = value;
        generation++;
        return value;
      },
    ),
    block: vi.fn(async (value: HostTask) => ({ ...value, status: "blocked" })),
    completeWithFindings: vi.fn().mockResolvedValue({ status: "done" }),
    find: vi.fn(async () => current),
  };
  return {
    task,
    call,
    context,
    run: () =>
      repairOrBlock(context as unknown as TaskContext, task, "Review failed: Missing result", 10),
  };
}

describe("one task repair with advisor", () => {
  it("uses one automatic correction allowance for runtime and review failures", () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(1);
    expect(MAX_RUNTIME_RETRIES).toBe(1);
    expect(MAX_TASK_REVIEW_FAILURES).toBe(2);
  });

  it("consults and waits for real advice before queuing the first correction", async () => {
    const { run, context, call } = setup();
    const result = await run();
    expect(call.mock.calls.map(([action]) => action)).toEqual(["agents.consult", "agents.wait"]);
    expect(call).toHaveBeenNthCalledWith(
      1,
      "agents.consult",
      expect.objectContaining({ context: expect.stringContaining("Missing result") }),
      { sessionId: "worker", projectId: "project" },
      expect.any(Function),
    );
    expect(result).toMatchObject({ status: "queued", repairAttempts: 1, reviewFailureCount: 1 });
    expect(result.retryFeedback).toContain("Check the missing branch.");
    expect(context.completeWithFindings).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "finishes second FAIL without another consultation (continueUntilDone=%s)",
    async (continueUntilDone) => {
      const { run, call, context } = setup({
        repairAttempts: 1,
        reviewFailureCount: 2,
        continueUntilDone,
      });
      await run();
      expect(context.completeWithFindings).toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
      expect(context.write).not.toHaveBeenCalled();
    },
  );

  it("blocks exhausted work that lacks a usable worker result", async () => {
    const { run, context } = setup({ repairAttempts: 1, sessionId: undefined });
    await run();
    expect(context.block).toHaveBeenCalled();
    expect(context.completeWithFindings).not.toHaveBeenCalled();
  });

  it("does not pretend consultation succeeded when delegation is unavailable", async () => {
    const { run, context, call } = setup();
    context.repairDelegation = undefined as never;
    await run();
    expect(context.block).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("delegation is unavailable"),
      expect.any(Number),
    );
    expect(call).not.toHaveBeenCalled();
    expect(context.write).toHaveBeenCalledTimes(1);
  });

  it("uses the same advisor and repair budget for legacy blocked-task takeover", async () => {
    const { task, context, call } = setup({ status: "blocked" });
    const result = await queueTakeover(context as unknown as TaskContext, task, 10, task, 7);
    expect(call).toHaveBeenCalledWith(
      "agents.consult",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result).toMatchObject({
      status: "queued",
      repairAttempts: 1,
      blockedTakeover: { previousSessionId: "worker" },
    });
    expect(context.write).toHaveBeenCalledWith(expect.anything(), undefined, task, 7);
    expect(context.store.db.prepare).toHaveBeenCalledWith(
      "SELECT generation FROM task_admission_generation WHERE id=?",
    );
    const savedAdvisor = await context.write.mock.results[0].value;
    expect(context.write).toHaveBeenNthCalledWith(2, expect.anything(), undefined, savedAdvisor, 8);
  });

  it("keeps an unavailable advisor blocked instead of allowing automatic takeover", () => {
    const { task } = setup({
      status: "blocked",
      error: "Review failed: Missing result",
      repairStop: { reason: "external", message: "Advisor unavailable" },
    });
    expect(canTakeOverBlockedTask(task)).toBe(false);
    expect(taskRequiresInstructions(task)).toBe(true);
  });

  it.each([false, true])(
    "does not grant takeover a second repair (continueUntilDone=%s)",
    (continueUntilDone) => {
      const { task } = setup({
        status: "blocked",
        error: "Review failed: Missing result",
        repairAttempts: 1,
        continueUntilDone,
      });
      expect(canTakeOverBlockedTask(task)).toBe(false);
      expect(taskRequiresInstructions(task)).toBe(true);
    },
  );

  it("does not queue a repair from an empty successful advisor reply", async () => {
    const { run, call, context } = setup();
    call.mockResolvedValue({ runId: "advisor", status: "succeeded", result: " " });
    await run();
    expect(context.block).toHaveBeenCalled();
    expect(context.write).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "cancelled"])("does not repair with advisor status %s", async (status) => {
    const { run, context, call } = setup();
    call.mockResolvedValue({ runId: "advisor", status } as never);
    await run();
    expect(context.block).toHaveBeenCalled();
    expect(context.write).toHaveBeenCalledTimes(1);
  });

  it.each(["queued", "running", "needsInput"])(
    "keeps %s consultation queued across scheduler ticks without consuming repair",
    async (status) => {
      const { run, context, call } = setup();
      call.mockResolvedValue({ runId: "advisor", status } as never);
      const waiting = await run();
      expect(waiting).toMatchObject({
        status: "queued",
        sessionId: "worker",
        repairAdvisor: { error: "Review failed: Missing result" },
      });
      expect(waiting.repairAttempts).toBeUndefined();
      expect(context.block).not.toHaveBeenCalled();
      const firstArgs = call.mock.calls[0];
      call.mockClear();
      call.mockResolvedValue({
        runId: "advisor",
        status: "succeeded",
        result: "Check current files.",
      });
      const resumed = await repairOrBlock(
        context as unknown as TaskContext,
        waiting,
        waiting.repairAdvisor!.error,
        30,
      );
      expect(call.mock.calls[0]?.slice(0, 3)).toEqual(firstArgs?.slice(0, 3));
      expect(resumed).toMatchObject({ status: "queued", repairAttempts: 1 });
      expect(resumed.repairAdvisor).toBeUndefined();
      expect(resumed.sessionId).toBeUndefined();
    },
  );

  it("refuses replay after owner changes instructions while consultation waits", async () => {
    const { run, context, call } = setup();
    call.mockResolvedValue({ runId: "advisor", status: "queued" } as never);
    const waiting = await run();
    call.mockClear();
    await repairOrBlock(
      context as unknown as TaskContext,
      { ...waiting, prompt: "Owner changed scope" },
      waiting.repairAdvisor!.error,
      30,
    );
    expect(call).not.toHaveBeenCalled();
    expect(context.block).toHaveBeenCalled();
  });

  it("does not overwrite an owner edit made during consultation", async () => {
    const { run, context } = setup();
    context.unchangedTask.mockResolvedValue(undefined);
    await run();
    expect(context.write).not.toHaveBeenCalled();
    expect(context.block).not.toHaveBeenCalled();
  });
});

describe("shared runtime and review repair allowance", () => {
  it("consults advisor and consumes repair allowance for transient runtime failure", async () => {
    const { task, call, context } = setup({ verification: undefined, reviewFailureCount: 0 });
    await retryTransientFailure(
      context as unknown as TaskContext,
      task,
      "Provider connection closed",
      10,
    );
    expect(call.mock.calls.map(([action]) => action)).toEqual(["agents.consult", "agents.wait"]);
    expect(context.write).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        repairAttempts: 1,
        ownerNotices: [expect.objectContaining({ id: expect.stringMatching(/^runtime-retry:/) })],
      }),
      undefined,
      undefined,
      undefined,
    );
  });

  it("cannot retry runtime failure after review consumed the shared allowance", async () => {
    const { task, call, context } = setup({ repairAttempts: 1, verification: undefined });
    await retryTransientFailure(
      context as unknown as TaskContext,
      task,
      "Provider connection closed",
      10,
    );
    expect(call).not.toHaveBeenCalled();
    expect(context.write).not.toHaveBeenCalled();
    expect(context.block).toHaveBeenCalled();
  });

  it("cannot repair review failure after runtime consumed the shared allowance", async () => {
    const { call, context, run } = setup({ repairAttempts: 1 });
    await run();
    expect(call).not.toHaveBeenCalled();
    expect(context.completeWithFindings).toHaveBeenCalled();
  });
});
