import { beforeEach, describe, expect, it, vi } from "vitest";
import { remoteRequest } from "../../connections/model/connections";
import { machineCapabilities, machineProjects } from "../../automations/model/machineSnapshot";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  boardGoalsFromHost,
  approveGoal,
  cancelGoal,
  createGoal,
  hostGoalFromDraft,
  newGoalDraft,
  sameGoalMachine,
  toggleGoalProject,
  replanGoal,
  updateGoal,
  recheckGoalFinalReview,
  type BoardGoal,
} from "./goalClient";
import type { HostGoal, HostGoalInput } from "./hostGoals";
import { TASK_AGENT_ERROR } from "./taskClient";

vi.mock("../../connections/model/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/connections")>()),
  remoteRequest: vi.fn(),
}));
vi.mock("../../automations/model/machineSnapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../automations/model/machineSnapshot")>()),
  machineProjects: vi.fn(),
  machineCapabilities: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(machineProjects).mockResolvedValue([]);
  vi.mocked(machineCapabilities).mockResolvedValue([
    "tasks.continue-until-done",
    "goals.direct-checkout",
    "goals.final-review",
    "tasks.run-budget",
    "tasks.preflight",
    "tasks.evaluation",
  ]);
});

const mac: RemoteMachine = {
  id: "machine-mac",
  name: "MacBook",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "env-mac",
  ssh: { target: "me@macbook", remotePort: 3774 },
};
const local: RemoteMachine = {
  id: "machine-local",
  name: LOCAL_SYNC_MACHINE_NAME,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "env-local",
};

const stored: HostGoal = {
  id: "launch",
  title: "Launch the beta",
  prompt: "Ship the beta",
  projectIds: ["p-app", "p-gone", "p-api"],
  leadProjectId: "p-app",
  harness: "claude",
  model: "claude:test",
  modelSettings: {},
  runtimeMode: "auto",
  maxRunMinutes: 0,
  verifyDefaults: { review: true },
  approvePlan: false,
  status: "planning",
  taskIds: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("goal client", () => {
  it("rejects unsupported final acceptance before project registration or any write", async () => {
    vi.mocked(machineCapabilities).mockResolvedValue([
      "tasks.continue-until-done",
      "goals.direct-checkout",
    ]);
    const draft = {
      ...newGoalDraft("G:/app", "claude", "claude:test"),
      title: "Goal",
      prompt: "Deliver checked work",
    };
    expect(draft.finalReview).toBe(true);
    await expect(createGoal([local], draft)).rejects.toThrow("verify the completed goal");
    expect(remoteRequest).not.toHaveBeenCalled();
    expect(machineProjects).not.toHaveBeenCalled();
  });

  it("serializes total budgets and requires their host capability before registration", async () => {
    const draft = {
      ...newGoalDraft("G:/app", "claude", "claude:test"),
      title: "Goal",
      prompt: "Deliver checked work",
      budget: { maxAgentMinutes: 12, maxAttempts: 8 },
    };
    expect(hostGoalFromDraft(draft, "goal", ["project"], "project")).toMatchObject({
      finalReview: true,
      budget: draft.budget,
    });
    vi.mocked(machineCapabilities).mockResolvedValue([
      "tasks.continue-until-done",
      "goals.direct-checkout",
      "goals.final-review",
    ]);
    await expect(createGoal([local], draft)).rejects.toThrow("total run budget");
    expect(remoteRequest).not.toHaveBeenCalled();
    expect(machineProjects).not.toHaveBeenCalled();
  });

  it("rechecks final acceptance against the exact goal revision", async () => {
    const [goal] = boardGoalsFromHost(
      local,
      [{ id: "p-app", cwd: "G:/app", name: "app" }],
      [{ ...stored, status: "blocked", finalReview: true }],
    );
    vi.mocked(remoteRequest).mockResolvedValue({
      ...stored,
      status: "running",
      finalReview: true,
      updatedAt: 3,
    });
    expect(await recheckGoalFinalReview(goal)).toMatchObject({ status: "running", updatedAt: 3 });
    expect(remoteRequest).toHaveBeenCalledWith(
      local.id,
      "goals.final-review.recheck",
      { goalId: goal.id, expectedUpdatedAt: goal.updatedAt },
      false,
      true,
    );
  });
  it("shows a host goal on its machine, with the projects it still has", () => {
    const [goal] = boardGoalsFromHost(
      mac,
      [
        { id: "p-api", cwd: "/Users/me/api", name: "api" },
        { id: "p-app", cwd: "/Users/me/app", name: "app" },
      ],
      [stored],
    );
    expect(goal).toMatchObject({
      machineId: "machine-mac",
      machineName: "MacBook",
    });
    expect(goal.projects).toEqual([
      { id: "p-app", cwd: "remote://env-mac/Users/me/app", name: "app" },
      { id: "p-api", cwd: "remote://env-mac/Users/me/api", name: "api" },
    ]);
    expect(
      boardGoalsFromHost(local, [{ id: "p-app", cwd: "G:/app", name: "app" }], [stored])[0],
    ).toMatchObject({
      machineName: "this computer",
      projects: [{ cwd: "G:/app" }],
    });
  });

  it("sends direct execution and drops irrelevant automatic merge", () => {
    const draft = {
      ...newGoalDraft("G:/app", "claude", "claude:test"),
      isolate: false,
      autoMerge: true,
    };
    expect(hostGoalFromDraft(draft, "goal", ["project"], "project")).toMatchObject({
      isolate: false,
    });
    expect(hostGoalFromDraft(draft, "goal", ["project"], "project").autoMerge).toBeUndefined();
  });

  it("rejects direct goals on an older host before any write", async () => {
    vi.mocked(machineCapabilities).mockResolvedValue(["tasks.continue-until-done"]);
    const draft = { ...newGoalDraft("G:/app", "claude", "claude:test"), isolate: false };
    await expect(createGoal([local], draft)).rejects.toThrow("Update the selected host");
    expect(remoteRequest).not.toHaveBeenCalled();
  });

  it("keeps a draft's projects on one machine", () => {
    expect(sameGoalMachine("G:/app", "G:/api")).toBe(true);
    expect(sameGoalMachine("remote://env-mac/a", "remote://env-mac/b")).toBe(true);
    expect(sameGoalMachine("G:/app", "remote://env-mac/b")).toBe(false);

    let draft = newGoalDraft("G:/app", "claude", "claude:test");
    draft = toggleGoalProject(draft, "remote://env-mac/api");
    expect(draft.cwds).toEqual(["G:/app"]);
    draft = toggleGoalProject(draft, "G:/api");
    expect(draft).toMatchObject({
      cwds: ["G:/app", "G:/api"],
      leadCwd: "G:/app",
    });
    // Removing the lead hands the lead to the first project left.
    draft = toggleGoalProject(draft, "G:/app");
    expect(draft).toMatchObject({ cwds: ["G:/api"], leadCwd: "G:/api" });
    draft = toggleGoalProject(draft, "G:/api");
    expect(draft).toMatchObject({ cwds: [], leadCwd: "" });
    // With nothing chosen, any machine's project can be the first.
    draft = toggleGoalProject(draft, "remote://env-mac/api");
    expect(draft).toMatchObject({
      cwds: ["remote://env-mac/api"],
      leadCwd: "remote://env-mac/api",
    });
  });

  it("allows at most eight projects", () => {
    let draft = newGoalDraft("G:/p0", "claude", "claude:test");
    for (let i = 1; i < 10; i += 1) draft = toggleGoalProject(draft, `G:/p${i}`);
    expect(draft.cwds).toHaveLength(8);
  });

  it("builds what the host stores", () => {
    const draft = {
      ...newGoalDraft("G:/app", "claude", "claude:test"),
      title: "Launch",
      prompt: "Ship",
      approvePlan: true,
      review: false,
      maxRunMinutes: 30,
    };
    expect(hostGoalFromDraft(draft, "id-1", ["p-app", "p-api"], "p-api")).toEqual({
      finalReview: true,
      id: "id-1",
      title: "Launch",
      prompt: "Ship",
      projectIds: ["p-app", "p-api"],
      leadProjectId: "p-api",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 30,
      isolate: false,
      verifyDefaults: { review: false },
      approvePlan: true,
      continueUntilDone: true,
    });
    expect(() =>
      hostGoalFromDraft({ ...draft, harness: "unknown" as never }, "id", ["p"], "p"),
    ).toThrow(TASK_AGENT_ERROR);
  });
});

describe("merging automatically in the goal draft", () => {
  it("sends autoMerge only when asked for", () => {
    const draft = {
      ...newGoalDraft("G:/app", "claude", "claude:test"),
      title: "Launch",
      prompt: "Ship",
    };
    expect(draft.autoMerge).toBe(false);
    expect(hostGoalFromDraft(draft, "id", ["p-app"], "p-app").autoMerge).toBeUndefined();
    expect(
      hostGoalFromDraft({ ...draft, isolate: true, autoMerge: true }, "id", ["p-app"], "p-app"),
    ).toMatchObject({ autoMerge: true });
  });
});

describe("confirmed goal mutation results", () => {
  it("returns a created remote goal with the resolved project and lead bindings without refreshing", async () => {
    vi.mocked(machineProjects).mockResolvedValue([
      { id: "p-api", cwd: "/Users/me/api", name: "api" },
      { id: "p-app", cwd: "/Users/me/app", name: "app" },
    ]);
    vi.mocked(remoteRequest).mockImplementation(async (_machineId, method, params) => {
      if (method !== "goals.create") throw new Error(`Unexpected refresh: ${method}`);
      return {
        ...stored,
        ...(params as { goal: HostGoalInput }).goal,
        createdAt: 10,
        updatedAt: 10,
      };
    });
    const created = await createGoal([local, mac], {
      ...newGoalDraft("remote://env-mac/Users/me/app", "claude", "claude:test"),
      machineId: mac.id,
      title: "Launch",
      prompt: "Ship",
      cwds: ["remote://env-mac/Users/me/app", "remote://env-mac/Users/me/api"],
      leadCwd: "remote://env-mac/Users/me/api",
    });
    expect(created).toMatchObject({
      machineId: mac.id,
      machineName: mac.name,
      leadProjectId: "p-api",
      projectIds: ["p-app", "p-api"],
      status: "planning",
      updatedAt: 10,
      projects: [
        { id: "p-app", cwd: "remote://env-mac/Users/me/app", name: "app" },
        { id: "p-api", cwd: "remote://env-mac/Users/me/api", name: "api" },
      ],
    });
    expect(remoteRequest).toHaveBeenCalledOnce();
    expect(remoteRequest).toHaveBeenCalledWith(
      mac.id,
      "goals.create",
      { goal: expect.objectContaining({ id: created.id, leadProjectId: "p-api" }) },
      false,
      true,
    );
  });

  it.each([
    {
      method: "goals.update",
      status: "running",
      invoke: (goal: BoardGoal) =>
        updateGoal(goal, {
          autoMerge: true,
          continueUntilDone: true,
          maxRunningTasks: 2,
          maxRunMinutes: 0,
        }),
      params: {
        settings: {
          autoMerge: true,
          continueUntilDone: true,
          maxRunningTasks: 2,
          maxRunMinutes: 0,
        },
        expectedUpdatedAt: stored.updatedAt,
      },
    },
    { method: "goals.approve", status: "running", invoke: approveGoal, params: {} },
    {
      method: "goals.replan",
      status: "planning",
      invoke: (goal: BoardGoal) => replanGoal(goal, "  Narrow scope  "),
      params: { feedback: "Narrow scope" },
    },
    { method: "goals.cancel", status: "cancelled", invoke: cancelGoal, params: {} },
  ] as const)(
    "returns the confirmed $method result and clears obsolete host fields",
    async ({ method, status, invoke, params }) => {
      const [current] = boardGoalsFromHost(
        local,
        [{ id: "p-app", cwd: "G:/app", name: "app" }],
        [stored],
      );
      const old = {
        ...current,
        stale: true,
        planError: "Old planner error",
        error: "Old task error",
        plan: { tasks: [] },
        plannerRecoveryPending: true,
      };
      vi.mocked(remoteRequest).mockResolvedValue({ ...stored, status, updatedAt: 20 });
      const updated = await invoke(old);
      expect(updated).toMatchObject({
        id: stored.id,
        status,
        updatedAt: 20,
        machineId: local.id,
        machineName: "this computer",
        projects: current.projects,
      });
      expect(updated.stale).toBeUndefined();
      expect(updated).not.toHaveProperty("planError");
      expect(updated).not.toHaveProperty("error");
      expect(updated).not.toHaveProperty("plan");
      expect(updated).not.toHaveProperty("plannerRecoveryPending");
      expect(remoteRequest).toHaveBeenCalledWith(
        local.id,
        method,
        { goalId: stored.id, ...params },
        false,
        true,
      );
      expect(remoteRequest).toHaveBeenCalledOnce();
      expect(machineProjects).not.toHaveBeenCalled();
      expect(old.stale).toBe(true);
    },
  );

  it("propagates mutation failures without fabricating an updated goal", async () => {
    const [current] = boardGoalsFromHost(mac, [], [stored]);
    vi.mocked(remoteRequest).mockRejectedValue(new Error("Host unavailable"));
    await expect(cancelGoal(current)).rejects.toThrow("Host unavailable");
    expect(current.status).toBe("planning");
  });
});
