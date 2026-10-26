import { describe, expect, it, vi } from "vitest";
import { ConversationGoalTools, type GoalWriteTool } from "./conversation-goal-tools";
import type { HostStore } from "./store";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { parseHostGoal, type HostGoal } from "../src/features/tasks/model/hostGoals";

const principal = {
  projectId: "project",
  sessionId: "caller",
  provider: "codex",
  kind: "session" as const,
};
function setup() {
  const session = {
    harness: "codex",
    providerAccountId: "account-work",
    model: "current-model",
    modelSettings: { effort: "medium" },
    runtimeMode: "supervised",
  };
  const store = {
    project: vi.fn(),
    session: vi.fn(() => ({ projectId: "project", session }) as ReturnType<HostStore["session"]>),
    sessionStateMetadata: vi.fn(() => undefined as ReturnType<HostStore["sessionStateMetadata"]>),
  };
  const rows: HostGoal[] = [];
  const taskRows: HostTask[] = [];
  const goals = {
    list: vi.fn(() => rows),
    create: vi.fn((raw: unknown) => {
      const input = parseHostGoal(raw);
      if (rows.some((goal) => goal.id === input.id)) throw new Error("This goal already exists.");
      const goal: HostGoal = {
        ...input,
        status: "planning",
        taskIds: [],
        createdAt: 1,
        updatedAt: 1,
      };
      rows.push(goal);
      return goal;
    }),
    replan: vi.fn((id: string) => rows.find((goal) => goal.id === id)!),
    cancel: vi.fn(async (id: string) => rows.find((goal) => goal.id === id)!),
    update: vi.fn((id: string, _raw: unknown, _expectedUpdatedAt: unknown) =>
      rows.find((goal) => goal.id === id)!,
    ),
    delete: vi.fn(async (_id: string, _withTasks = false) => {}),
  };
  const helper = new ConversationGoalTools(store, goals, { list: () => taskRows });
  const call = async (
    action: GoalWriteTool,
    input: Record<string, unknown>,
    authorized = () => true,
  ) => await helper.call(action, input, principal, authorized);
  const create = async () =>
    await call("goals.create", { goalId: "goal", title: "Deliver", prompt: "Implement safely" });
  return { session, store, rows, taskRows, goals, helper, call, create };
}

describe("conversation goal writes", () => {
  it("refuses direct execution, integration delivery and publication requested through conversation tools", async () => {
    const f = setup();
    for (const patch of [
      { isolate: false },
      { autoMerge: true },
      { deliveryRequested: true },
      { push: "origin" },
      { createPr: true },
    ])
      await expect(
        f.call("goals.create", { goalId: "goal", title: "Deliver", prompt: "Implement", ...patch }),
      ).rejects.toThrow("owner UI");
    expect(f.goals.create).not.toHaveBeenCalled();
  });

  it("pins the caller account rather than using the unauthenticated host default", async () => {
    const f = setup();
    await f.create();
    expect(f.goals.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "account-work" }),
    );
    f.rows[0].providerAccountId = "another-profile";
    await expect(
      f.call("goals.update", { goalId: "goal", expectedUpdatedAt: 1, maxRunMinutes: 10 }),
    ).rejects.toThrow("owner UI");
  });
  it("inherits desktop-only caller settings through the verified session resolver", async () => {
    const f = setup();
    const caller = await f.store.session("caller");
    f.store.session.mockImplementation(() => {
      throw new Error("Session not found on this machine");
    });
    const resolve = vi.fn(() => caller);
    const helper = new ConversationGoalTools(f.store, f.goals, { list: () => [] }, resolve);
    const goal = await helper.call(
      "goals.create",
      {
        goalId: "desktop-goal",
        title: "Desktop plan",
        prompt: "Implement safely",
      },
      principal,
      () => true,
    );
    expect(resolve).toHaveBeenCalledWith("caller");
    expect(goal).toMatchObject({
      harness: f.session.harness,
      model: f.session.model,
      modelSettings: f.session.modelSettings,
      runtimeMode: f.session.runtimeMode,
      projectIds: [principal.projectId],
      approvePlan: true,
      manualStart: true,
    });
    expect(f.goals.create).toHaveBeenCalledWith(expect.objectContaining({ autoMerge: false }));
    resolve.mockReturnValue({ ...caller, projectId: "foreign" });
    await expect(
      helper.call(
        "goals.create",
        {
          goalId: "foreign-goal",
          title: "Foreign",
          prompt: "Denied",
        },
        principal,
        () => true,
      ),
    ).rejects.toThrow("another project");
    await expect(
      helper.call(
        "goals.create",
        {
          goalId: "revoked-goal",
          title: "Revoked",
          prompt: "Denied",
        },
        principal,
        () => false,
      ),
    ).rejects.toThrow("revoked");
    expect(f.goals.create).toHaveBeenCalledTimes(1);
  });

  it("updates only bounded operational limits with matching execution identity and revision", async () => {
    const f = setup();
    await f.create();
    await f.call("goals.update", {
      goalId: "goal",
      expectedUpdatedAt: 1,
      maxRunningTasks: 3,
      continueUntilDone: true,
    });
    expect(f.goals.update).toHaveBeenCalledWith(
      "goal",
      { maxRunningTasks: 3, maxRunMinutes: 0, autoMerge: false, continueUntilDone: false },
      1,
    );
    f.goals.update.mockClear();
    for (const patch of [
      {},
      { maxRunningTasks: 9 },
      { maxRunningTasks: -1 },
      { maxRunMinutes: 10081 },
      { maxRunMinutes: 0.5 },
    ])
      await expect(
        f.call("goals.update", { goalId: "goal", expectedUpdatedAt: 1, ...patch }),
      ).rejects.toThrow();
    f.rows[0].runtimeMode = "auto" as HostGoal["runtimeMode"];
    await expect(
      f.call("goals.update", { goalId: "goal", expectedUpdatedAt: 1, maxRunMinutes: 10 }),
    ).rejects.toThrow("owner UI");
    expect(f.goals.update).not.toHaveBeenCalled();
  });

  it("deletes only inactive terminal goals or never-executed plans and always preserves tasks", async () => {
    const f = setup();
    await f.create();
    for (const status of ["done", "cancelled", "awaiting-approval", "blocked"] as const) {
      f.rows[0].status = status;
      expect(
        await f.call("goals.delete", { goalId: "goal", expectedUpdatedAt: 1, withTasks: true }),
      ).toMatchObject({ deleted: true, tasksPreserved: true });
      expect(f.goals.delete).toHaveBeenLastCalledWith("goal", false);
    }
    f.goals.delete.mockClear();
    for (const patch of [
      { status: "planning" },
      { status: "running" },
      { status: "blocked", taskIds: ["task"] },
      { status: "awaiting-approval", plannerRecoveryPending: true },
    ]) {
      f.rows[0] = {
        ...f.rows[0],
        taskIds: [],
        plannerRecoveryPending: false,
        ...patch,
      } as HostGoal;
      await expect(
        f.call("goals.delete", { goalId: "goal", expectedUpdatedAt: 1 }),
      ).rejects.toThrow("inactive");
    }
    f.rows[0] = {
      ...f.rows[0],
      status: "done",
      plannerRecoveryPending: false,
      plannerSessionId: "planner",
    };
    f.store.sessionStateMetadata.mockReturnValue({ status: "running" } as ReturnType<
      HostStore["sessionStateMetadata"]
    >);
    await expect(f.call("goals.delete", { goalId: "goal", expectedUpdatedAt: 1 })).rejects.toThrow(
      "inactive",
    );
    expect(f.goals.delete).not.toHaveBeenCalled();
  });
  it("inherits caller identity and fixes owner plan approval, manual start and managed worktree execution", async () => {
    const f = setup();
    const result = await f.call("goals.create", {
      goalId: "goal",
      title: "Deliver",
      prompt: "Implement safely",
      projectIds: ["foreign"],
      runtimeMode: "auto",
      model: "other",
      approvePlan: false,
      manualStart: false,
    });
    expect(result).toMatchObject({
      id: "goal",
      projectIds: ["project"],
      leadProjectId: "project",
      harness: "codex",
      model: "current-model",
      modelSettings: { effort: "medium" },
      runtimeMode: "supervised",
      approvePlan: true,
      manualStart: true,
      verifyDefaults: { review: true },
    });
    expect(f.goals.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoMerge: false, continueUntilDone: false }),
    );
    expect((result as HostGoal).autoMerge).not.toBe(true);
    await expect(f.create()).rejects.toThrow("already exists");
    expect(f.rows).toHaveLength(1);
  });

  it("refuses revoked or foreign session authority before mutation", async () => {
    const f = setup();
    await expect(f.call("goals.create", {}, () => false)).rejects.toThrow("revoked");
    f.store.session.mockReturnValue({ projectId: "foreign", session: f.session } as ReturnType<
      HostStore["session"]
    >);
    await expect(f.create()).rejects.toThrow("another project");
    expect(f.goals.create).not.toHaveBeenCalled();
  });

  it("guards replan and cancellation with singleton scope and exact revision", async () => {
    const f = setup();
    await f.create();
    for (const action of [
      "goals.replan",
      "goals.cancel",
      "goals.update",
      "goals.delete",
    ] as const) {
      await expect(f.call(action, { goalId: "goal", expectedUpdatedAt: 0 })).rejects.toThrow(
        "changed",
      );
      await expect(f.call(action, { goalId: "goal", expectedUpdatedAt: "1" })).rejects.toThrow(
        "changed",
      );
      f.rows[0].projectIds = ["project", "foreign"];
      await expect(f.call(action, { goalId: "goal", expectedUpdatedAt: 1 })).rejects.toThrow(
        "wholly",
      );
      f.rows[0].projectIds = ["project"];
    }
    await f.call("goals.replan", {
      goalId: "goal",
      expectedUpdatedAt: 1,
      feedback: "Smaller tasks",
    });
    expect(f.goals.replan).toHaveBeenCalledWith("goal", "Smaller tasks");
    await f.call("goals.cancel", { goalId: "goal", expectedUpdatedAt: 1 });
    expect(f.goals.cancel).toHaveBeenCalledWith("goal");
  });

  it("prevents planners, workers and reviewers from changing their own goal", async () => {
    const f = setup();
    await f.create();
    for (const role of ["planner", "worker", "reviewer"] as const) {
      f.rows[0].plannerSessionId = role === "planner" ? "caller" : undefined;
      f.taskRows.splice(0, f.taskRows.length);
      if (role !== "planner")
        f.taskRows.push({
          id: "task",
          goalId: "goal",
          projectId: "project",
          ...(role === "worker" ? { sessionId: "caller" } : { reviewer: { sessionId: "caller" } }),
        } as HostTask);
      for (const action of [
        "goals.replan",
        "goals.cancel",
        "goals.update",
        "goals.delete",
      ] as const)
        await expect(f.call(action, { goalId: "goal", expectedUpdatedAt: 1 })).rejects.toThrow(
          "own goal",
        );
    }
    expect(f.goals.replan).not.toHaveBeenCalled();
    expect(f.goals.cancel).not.toHaveBeenCalled();
  });

  it("refuses replanning settings that could change identity or skip owner approval", async () => {
    const f = setup();
    await f.create();
    const original = { ...f.rows[0] };
    for (const patch of [
      { approvePlan: false },
      { manualStart: false },
      { autoMerge: true },
      { isolate: false },
      { continueUntilDone: true },
      { runtimeMode: "auto" },
      { model: "foreign" },
      { modelSettings: { effort: "high" } },
    ]) {
      f.rows[0] = { ...original, ...patch } as HostGoal;
      await expect(
        f.call("goals.replan", { goalId: "goal", expectedUpdatedAt: 1 }),
      ).rejects.toThrow("owner UI");
    }
    expect(f.goals.replan).not.toHaveBeenCalled();
    await f.call("goals.cancel", { goalId: "goal", expectedUpdatedAt: 1 });
    expect(f.goals.cancel).toHaveBeenCalledWith("goal");
  });
});
