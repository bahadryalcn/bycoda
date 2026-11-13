import { describe, expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import {
  conflictChildAdmitted,
  conflictStopGeneration,
  fenceConflictChildren,
  releaseConflictStop,
  recoverCommittedConflict,
} from "./conflict-recovery";
import type { TaskDeliveryReview } from "../../src/features/tasks/model/hostTasks";
import { git } from "./git";
import { consultRepairAdvisor } from "./recovery";
import { budgetParent } from "./goal-budget";

vi.mock("./git", () => ({ git: vi.fn() }));
vi.mock("./recovery", () => ({ consultRepairAdvisor: vi.fn() }));

const binding = {
  id: "parent",
  createdAt: 4,
  workInvocationId: "invocation",
  sourceHead: "source",
  targetHead: "target",
  targetDirectory: "target-path",
  targetBranch: "main",
};
const child = { id: "child", conflictParent: binding } as HostTask;
function fixture() {
  const parent = {
    id: "parent",
    createdAt: 4,
    workInvocationId: "invocation",
    status: "review",
    autoMerge: true,
    worktreeCwd: "source-path",
    deliveryCwd: "target-path",
    conflictRecovery: {
      childId: "child",
      sourceHead: "source",
      targetHead: "target",
      targetDirectory: "target-path",
      targetBranch: "main",
    },
  } as HostTask;
  const context = {
    find: async () => parent,
    goalExecutionAllowed: async () => true,
  } as unknown as TaskContext;
  vi.mocked(git).mockImplementation(async (cwd, args) =>
    cwd === "source-path" ? "source" : args[0] === "symbolic-ref" ? "main" : "target",
  );
  return { parent, context };
}

describe("committed conflict child admission", () => {
  it("admits only the bound parent generation and reviewed heads", async () => {
    const { parent, context } = fixture();
    expect(await conflictChildAdmitted(context, child)).toBe(true);
    parent.workInvocationId = "later-owner-run";
    expect(await conflictChildAdmitted(context, child)).toBe(false);
  });
  it("holds new dispatch immediately on Stop until a matching canonical restart", async () => {
    const { context } = fixture();
    const before = conflictStopGeneration("parent");
    fenceConflictChildren("parent");
    expect(await conflictChildAdmitted(context, child)).toBe(false);
    releaseConflictStop("parent", before);
    expect(await conflictChildAdmitted(context, child)).toBe(false);
    releaseConflictStop("parent", conflictStopGeneration("parent"));
    expect(await conflictChildAdmitted(context, child)).toBe(true);
  });
  it("refuses dispatch when either checkout advances or the parent stops", async () => {
    const { parent, context } = fixture();
    vi.mocked(git).mockResolvedValue("different");
    expect(await conflictChildAdmitted(context, child)).toBe(false);
    parent.status = "blocked";
    expect(await conflictChildAdmitted(context, child)).toBe(false);
  });
});

describe("committed conflict reservation", () => {
  it("does not repair dirty-overlap or other delivery blockers", async () => {
    const task = { id: "parent", worktreeCwd: "source", workInvocationId: "run" } as HostTask;
    const plan = {
      action: "merge",
      committedConflict: { sourceHead: "source", targetHead: "target" },
      blockers: [
        "Committed branches conflict; resolve in the source and review again",
        "Delivery overlaps dirty target paths",
      ],
    } as TaskDeliveryReview;
    await expect(recoverCommittedConflict({} as TaskContext, task, plan)).rejects.toThrow(
      "additional blockers",
    );
  });
  it("does not reserve a second automatic repair", async () => {
    const task = {
      id: "parent",
      worktreeCwd: "source",
      workInvocationId: "run",
      repairAttempts: 1,
    } as HostTask;
    const plan = {
      action: "merge",
      committedConflict: { sourceHead: "source", targetHead: "target" },
      blockers: ["Committed branches conflict; resolve in the source and review again"],
    } as TaskDeliveryReview;
    await expect(recoverCommittedConflict({} as TaskContext, task, plan)).rejects.toThrow(
      "correction limit",
    );
  });
});

describe("durable conflict child lifecycle", () => {
  it("retains one reservation while advice is pending and replans after the child is delivered", async () => {
    const task = {
      id: "parent",
      projectId: "project",
      createdAt: 1,
      updatedAt: 1,
      workInvocationId: "owner-run",
      status: "review",
      autoMerge: true,
      worktreeCwd: "source-path",
      sessionId: "worker",
      title: "Original",
      prompt: "Original work",
      harness: "codex",
      model: "model",
      modelSettings: {},
      runtimeMode: "fullAccess",
      maxRunMinutes: 0,
    } as HostTask;
    const plan = {
      action: "merge",
      sourceHead: "source",
      targetHead: "target",
      targetDirectory: "target-path",
      targetBranchRef: "refs/heads/main",
      committedConflict: { sourceHead: "source", targetHead: "target" },
      blockers: ["Committed branches conflict; resolve in the source and review again"],
    } as TaskDeliveryReview;
    const tasks = new Map<string, HostTask>([[task.id, task]]);
    const context = {
      find: async (id: string) => tasks.get(id),
      taskValue: async (id: string) => JSON.stringify(tasks.get(id)),
      unchangedTask: async (id: string, expected: string) =>
        JSON.stringify(tasks.get(id)) === expected ? tasks.get(id) : undefined,
      transaction: async (work: () => Promise<unknown>) => work(),
      write: async (value: HostTask) => {
        tasks.set(value.id, value);
        return value;
      },
      now: () => 2,
      goalExecutionAllowed: async () => true,
    } as unknown as TaskContext;
    vi.mocked(git).mockImplementation(async (cwd, args) =>
      cwd === "source-path" ? "source" : args[0] === "symbolic-ref" ? "main" : "target",
    );
    vi.mocked(consultRepairAdvisor)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("advice");
    await recoverCommittedConflict(context, task, plan);
    const reserved = tasks.get("parent")!;
    const childId = reserved.conflictRecovery!.childId;
    expect(reserved.repairAttempts).toBe(1);
    expect(tasks.size).toBe(1);
    await recoverCommittedConflict(context, reserved, plan);
    expect(tasks.size).toBe(2);
    expect(tasks.get(childId)?.conflictParent?.id).toBe("parent");
    expect(await budgetParent(context, tasks.get(childId)!)).toEqual(tasks.get("parent"));
    await recoverCommittedConflict(context, tasks.get("parent")!, plan);
    expect(tasks.size).toBe(2);
    tasks.set(childId, { ...tasks.get(childId)!, status: "done", merged: true });
    const cleanPlan = { ...plan, committedConflict: undefined, blockers: [] } as TaskDeliveryReview;
    await recoverCommittedConflict(context, tasks.get("parent")!, cleanPlan);
    expect(tasks.get("parent")?.conflictRecovery).toBeUndefined();
  });
});
