import { describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { finishDeliveryReceipt, recoverMerge } from "./delivery";
import { cancel } from "./task-actions";
import { write as writeTask } from "./storage";

function canonicalContext(
  automaticDelivery?: NonNullable<TaskContext["managed"]>["automaticDelivery"],
) {
  let stored: HostTask | undefined;
  const context = {
    invalidatedAssistantGenerations: new Map(),
    automaticDeliveryControllers: new Map(),
    delivering: new Set(),
    pausedGoals: new Set(),
    projectListCache: new Map(),
    budgets: { read: async () => undefined },
    now: () => 2,
    get: async () => stored,
    taskValue: async () => JSON.stringify(stored),
    unchangedTask: vi.fn(async (_id: string, expected: string) =>
      JSON.stringify(stored) === expected ? stored : undefined,
    ),
    store: {
      db: {
        checkAuthorization: async () => undefined,
        scope: async (work: () => Promise<HostTask>) => work(),
        prepare: () => ({
          run: async (_id: string, value: string) => {
            stored = JSON.parse(value);
          },
        }),
      },
      afterCommit: (work: () => void) => work(),
    },
    managed: {
      automaticDelivery,
      registry: { get: async () => ({ id: "workspace", revision: 2, directoryState: "removed" }) },
      delivery: {
        review: async () => ({
          action: "merge",
          workspaceId: "workspace",
          expectedRevision: 2,
          token: "plan",
          blockers: [],
        }),
        merge: vi.fn(async () => {
          throw new Error("Native callback reached Git delivery");
        }),
      },
    },
  } as unknown as TaskContext;
  context.write = (task) => writeTask(context, task);
  return context;
}

function passingAutomaticReview(): HostTask {
  return {
    id: "task",
    projectId: "project",
    status: "review",
    autoMerge: true,
    workspaceId: "workspace",
    updatedAt: 1,
    verification: { review: { verdict: "pass", note: "PASS" } },
  } as HostTask;
}

describe("automatic task delivery fallback", () => {
  it("preserves Native eligibility through canonical review persistence and reaches its callback", async () => {
    const automaticDelivery = vi.fn(async (_task, _plan, execute) => {
      await execute({ ownerId: "owner", authorizationId: "authorization" });
    });
    const context = canonicalContext(automaticDelivery);
    const task = await context.write(passingAutomaticReview());
    expect(task.deliveryApprovalRequired).not.toBe(true);
    expect(task.autoMerge).toBe(true);
    await recoverMerge(context, task, 1);
    expect(automaticDelivery).toHaveBeenCalledOnce();
    expect(context.unchangedTask).toHaveBeenCalledOnce();
    expect(context.managed!.delivery.merge).toHaveBeenCalledOnce();
    // Native failure must persist a manual fallback instead of replaying on a later write.
    const fallback = (await context.get(task.id))!;
    expect(fallback.deliveryApprovalRequired).toBe(true);
    expect((await context.write(fallback)).deliveryApprovalRequired).toBe(true);
  });

  it("retains manual fallback on canonical writes without a Native delivery port", async () => {
    const context = canonicalContext();
    const task = await context.write(passingAutomaticReview());
    expect(task.autoMerge).toBe(true);
    expect(task.deliveryApprovalRequired).toBe(true);
    expect(task.deliveryState).toBe("awaitingOwner");
  });

  it("aborts before Stop waits for task readiness", async () => {
    const controller = new AbortController();
    let ready!: () => void;
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const context = {
      ready: pending,
      automaticDeliveryControllers: new Map([["task", controller]]),
      find: async () => undefined,
      jobs: new Map(),
    } as unknown as TaskContext;
    const stopping = cancel(context, "task", "Stopped");
    expect(controller.signal.aborted).toBe(true);
    ready();
    await stopping;
  });

  it("retains the preference and requires manual approval when Native is unavailable", async () => {
    const task = {
      id: "task",
      status: "review",
      autoMerge: true,
      deliveryRequested: true,
    } as HostTask;
    const write = vi.fn(async (value: HostTask) => value);
    await recoverMerge({ write, get: async () => task } as unknown as TaskContext, task, 1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        autoMerge: true,
        deliveryRequested: undefined,
        deliveryApprovalRequired: true,
        deliveryState: "awaitingOwner",
      }),
    );
  });

  it("retains the workspace receipt without marking a stopped task done during completion", async () => {
    const controller = new AbortController();
    const task = { id: "task", projectId: "project", status: "review" } as HostTask;
    const write = vi.fn(async (value: HostTask) => value);
    const context = {
      automaticDeliveryControllers: new Map([[task.id, controller]]),
      pausedGoals: new Set(),
      now: () => 1,
      write,
      store: {
        project: async () => {
          controller.abort();
          return { cwd: "target" };
        },
      },
    } as unknown as TaskContext;
    await expect(
      finishDeliveryReceipt(
        context,
        task,
        {
          operationId: "operation",
          workspaceId: "workspace",
          sourceHead: "source",
          previousTargetHead: "before",
          targetHead: "after",
          workspaceRevision: 2,
        },
        "plan",
      ),
    ).rejects.toThrow("Task stopped during delivery; the workspace receipt is retained.");
    expect(write).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("never requests Native delivery for failed review or open findings", async () => {
    const automaticDelivery = vi.fn();
    const write = vi.fn(async (value: HostTask) => value);
    const task = {
      id: "task",
      status: "review",
      autoMerge: true,
      workspaceId: "workspace",
      verification: { review: { verdict: "fail", note: "Defect" } },
    } as HostTask;
    const context = {
      write,
      get: async () => task,
      managed: { automaticDelivery },
    } as unknown as TaskContext;
    await recoverMerge(context, task, 1);
    expect(automaticDelivery).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ deliveryApprovalRequired: true }));
  });

  it("refuses a Native callback after the exact task generation is stopped", async () => {
    let current = {
      id: "task",
      projectId: "project",
      status: "review",
      autoMerge: true,
      workspaceId: "workspace",
      updatedAt: 1,
      verification: { review: { verdict: "pass", note: "PASS" } },
    } as HostTask;
    let callback: ((owner: never) => Promise<HostTask>) | undefined;
    const plan = {
      action: "merge",
      workspaceId: "workspace",
      expectedRevision: 2,
      token: "plan",
      blockers: [],
      sourceHead: "source",
      targetHead: "target",
    };
    const context = {
      get: async () => current,
      write: async (value: HostTask) => {
        current = value;
        return value;
      },
      now: () => 2,
      taskValue: async () => JSON.stringify(current),
      unchangedTask: async (_id: string, expected: string) =>
        JSON.stringify(current) === expected ? current : undefined,
      managed: {
        registry: {
          get: async () => ({ id: "workspace", revision: 2, directoryState: "removed" }),
        },
        delivery: { review: async () => plan },
        automaticDelivery: async (_task: HostTask, _plan: unknown, execute: typeof callback) => {
          callback = execute;
        },
      },
      pausedGoals: new Set(),
      automaticDeliveryControllers: new Map(),
    } as unknown as TaskContext;
    await recoverMerge(context, current, 1);
    expect(callback).toBeDefined();
    current = { ...current, status: "blocked", updatedAt: 3 };
    const execute = callback as unknown as (owner: never) => Promise<HostTask>;
    await expect(execute(undefined as never)).rejects.toThrow(
      "Task changed after automatic delivery review",
    );
  });
});
