import { describe, expect, it, vi } from "vitest";
import type { HostTask, TaskDeliveryReview } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { attemptConflictPeer, settleConflictPeer } from "./conflict-peer";
import { git } from "./git";

vi.mock("./git", () => ({ git: vi.fn() }));

function fixture() {
  const parent = {
    id: "parent-peer",
    projectId: "project",
    createdAt: 1,
    workInvocationId: "parent-run",
    status: "review",
    autoMerge: true,
    worktreeCwd: "source-path",
    conflictRecovery: {
      childId: "child",
      sourceHead: "source",
      targetHead: "target",
      targetDirectory: "target-path",
      targetBranch: "main",
    },
  } as HostTask;
  const peer = {
    id: "peer",
    projectId: "project",
    createdAt: 2,
    workInvocationId: "peer-generation",
    status: "running",
    worktreeCwd: "target-path",
    sessionId: "peer-session",
    runId: "peer-run",
  } as HostTask;
  const rows = new Map([
    [parent.id, parent],
    [peer.id, peer],
  ]);
  const session = {
    projectId: "project",
    status: "running",
    runId: "peer-run",
    session: { cwd: "target-path", blocks: [] },
  };
  let authorized = true;
  const command = vi.fn(async () => ({
    commandId: "accepted",
    sessionId: "peer-session",
    revision: 1,
  }));
  const context = {
    find: async (id: string) => rows.get(id),
    list: async () => [...rows.values()],
    taskValue: async (id: string) => JSON.stringify(rows.get(id)),
    unchangedTask: async (id: string, value: string) =>
      JSON.stringify(rows.get(id)) === value ? rows.get(id) : undefined,
    transaction: async (work: () => Promise<unknown>) => work(),
    write: async (task: HostTask) => {
      rows.set(task.id, task);
      return task;
    },
    now: () => 10,
    goalExecutionAllowed: async () => true,
    assistantTaskAdmission: async () => authorized,
    store: { session: async () => session },
    engine: { command },
    taskMessage: async (_task: HostTask, _reason: string, work: () => Promise<unknown>) => work(),
    admitCommand: async (
      admission: { check: (stage: { sessionId: string }) => Promise<void> },
      work: () => Promise<unknown>,
    ) => {
      await admission.check({ sessionId: "peer-session" });
      return work();
    },
  } as unknown as TaskContext;
  const plan = {
    action: "merge",
    sourceHead: "source",
    targetHead: "resolved",
    targetDirectory: "target-path",
    targetBranchRef: "refs/heads/main",
    blockers: [],
  } as TaskDeliveryReview;
  vi.mocked(git).mockImplementation(async (cwd, args) =>
    cwd === "source-path" ? "source" : args[0] === "symbolic-ref" ? "main" : "target",
  );
  return {
    parent,
    peer,
    rows,
    session,
    context,
    command,
    plan,
    deny: () => {
      authorized = false;
    },
  };
}

describe("committed conflict peer", () => {
  it("falls back only when no target writer exists and holds ambiguous writers", async () => {
    const f = fixture();
    f.rows.delete(f.peer.id);
    expect(await attemptConflictPeer(f.context, f.parent, "advice")).toBe(false);
    f.rows.set(f.peer.id, f.peer);
    f.rows.set("other", { ...f.peer, id: "other" });
    expect(await attemptConflictPeer(f.context, f.parent, "advice")).toBe(true);
    expect(f.command).not.toHaveBeenCalled();
    expect(f.rows.get(f.parent.id)?.conflictRecovery?.peer).toBeUndefined();
  });
  it("persists one exact intent and never resends an unknown outcome across re-entry", async () => {
    const f = fixture();
    f.command.mockRejectedValueOnce(new Error("delivery unknown"));
    expect(await attemptConflictPeer(f.context, f.parent, "advice")).toBe(true);
    const saved = f.rows.get(f.parent.id)!;
    expect(saved.conflictRecovery?.peer).toMatchObject({
      taskId: "peer",
      workInvocationId: "peer-generation",
      sessionId: "peer-session",
      runId: "peer-run",
      commandId: expect.any(String),
    });
    expect(f.command).toHaveBeenCalledTimes(1);
    expect(await attemptConflictPeer(f.context, saved, "advice")).toBe(true);
    await settleConflictPeer(f.context, saved, f.plan);
    expect(f.rows.get(f.parent.id)?.conflictRecovery?.peer).toEqual(saved.conflictRecovery?.peer);
    expect(f.command).toHaveBeenCalledTimes(1);
  });
  it("holds a later physical run and clears only after retirement and a clean fresh plan", async () => {
    const f = fixture();
    await attemptConflictPeer(f.context, f.parent, "advice");
    const saved = f.rows.get(f.parent.id)!;
    f.session.runId = "later-run";
    await settleConflictPeer(f.context, saved, f.plan);
    expect(f.rows.get(f.parent.id)?.conflictRecovery?.peer).toBeTruthy();
    f.session.status = "idle";
    f.peer.status = "done";
    await settleConflictPeer(f.context, saved, f.plan);
    expect(f.rows.get(f.parent.id)?.conflictRecovery).toBeUndefined();
  });
  it("keeps spent repair for owner review when the retired peer did not resolve conflict", async () => {
    const f = fixture();
    await attemptConflictPeer(f.context, f.parent, "advice");
    const saved = f.rows.get(f.parent.id)!;
    f.session.status = "idle";
    f.peer.status = "done";
    await expect(
      settleConflictPeer(f.context, saved, {
        ...f.plan,
        committedConflict: { sourceHead: "source", targetHead: "target" },
      }),
    ).rejects.toThrow("owner review");
    expect(f.rows.get(f.parent.id)?.conflictRecovery?.peer).toBeTruthy();
  });
  it("does not send after authority revocation or a changed target head", async () => {
    const denied = fixture();
    denied.deny();
    expect(await attemptConflictPeer(denied.context, denied.parent, "advice")).toBe(true);
    expect(denied.command).not.toHaveBeenCalled();
    expect(denied.rows.get(denied.parent.id)?.conflictRecovery?.peer).toBeTruthy();
    const changed = fixture();
    vi.mocked(git).mockResolvedValue("advanced");
    expect(await attemptConflictPeer(changed.context, changed.parent, "advice")).toBe(true);
    expect(changed.command).not.toHaveBeenCalled();
    expect(changed.rows.get(changed.parent.id)?.conflictRecovery?.peer).toBeUndefined();
  });
});
