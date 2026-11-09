import { expect, it, vi } from "vitest";
const utility = vi.hoisted(() => ({
  text: vi.fn(async () => ({ text: "Reply", tokens: 1 })),
  wake: vi.fn(async () => ({ actions: [], tokens: 1 })),
}));
vi.mock("./assistant-text", () => ({ assistantText: () => utility.text, chiefActions: () => [] }));
vi.mock("../chief/assistant-chief-context", () => ({
  createAssistantChiefContext: () => ({ wake: utility.wake }),
}));
import { assistantExecutionPorts, readManualSessionUsage } from "./assistant-runtime";
import type { HostStore } from "../../store";
import type { HostGoals } from "../../goals/goals";
import type { HostTasks } from "../../tasks/tasks";
import type { AsyncHostNotes } from "../../host-notes-async";
import type {
  AssistantProfile,
  AssistantJob,
} from "../../../src/shared/model/host-contracts/assistant";
function fixture() {
  utility.text.mockClear();
  utility.wake.mockClear();
  const create = vi.fn(async (raw) => ({ id: raw.id }));
  const list = vi.fn(async () => [] as { id: string }[]);
  const goals = { create, list } as unknown as HostGoals;
  const store = {
    ready: Promise.resolve(),
    db: {
      scope: async (fn: () => unknown) => fn(),
      exec: async () => undefined,
      prepare: () => ({ get: async () => undefined }),
    },
    attachmentDir: "test/attachments",
    projects: vi.fn(async () => [{ id: "p1" }]),
  } as unknown as HostStore;
  const tasks = {} as HostTasks;
  return { create, list, store, goals, tasks };
}
it("selects independent reply and Chief utilities before provider context binding without changing worker execution", async () => {
  const f = fixture(),
    ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  const execution = {
    harness: "codex",
    model: "worker-saved",
    modelSettings: { effort: "high" },
    runtimeMode: "full-access",
    maxRunMinutes: 45,
  } as const;
  const profile = {
    execution,
    chiefExecution: { ...execution, harness: "claude", model: "chief-saved" },
    replyExecution: { ...execution, model: "reply-saved", modelSettings: { effort: "low" } },
  } as unknown as AssistantProfile;
  await ports.reply!({
    profile,
    thread: { summary: "" },
    messages: [],
    instructions: "quoted rules",
    tokenCap: 8000,
    signal: new AbortController().signal,
  } as any);
  expect(utility.text.mock.calls[0][0].execution).toMatchObject({
    model: "reply-saved",
    modelSettings: { effort: "low" },
  });
  await ports.chiefWake!({
    profile,
    operationId: "chief-turn",
    stateCard: "canonical",
    events: [],
    tokenCap: 8000,
    signal: new AbortController().signal,
    contextPolicy: { soft: 10000, hard: 20000 },
  });
  expect(utility.wake.mock.calls[0][0].profile.execution).toMatchObject({
    harness: "claude",
    model: "chief-saved",
  });
  expect(profile.execution).toBe(execution);
});
it("passes planning identity separately to a canonical Goal while workers retain their model and permissions", async () => {
  const f = fixture(),
    ports = assistantExecutionPorts(f.store, f.goals, f.tasks),
    execution = {
      harness: "codex",
      model: "worker-saved",
      modelSettings: { effort: "high" },
      runtimeMode: "supervised",
      maxRunMinutes: 30,
    } as const;
  const profile = {
    execution,
    planningExecution: {
      ...execution,
      harness: "claude",
      model: "planner-saved",
      modelSettings: { effort: "low" },
      runtimeMode: "full-access",
    },
    planApproval: "always",
  } as unknown as AssistantProfile;
  await ports.createGoal!({
    job: {
      id: "roles",
      projectId: "p1",
      title: "Scoped job",
      request: "Implement",
    } as AssistantJob,
    profile,
  });
  expect(f.create.mock.calls[0][0]).toMatchObject({
    harness: "codex",
    model: "worker-saved",
    modelSettings: { effort: "high" },
    runtimeMode: "supervised",
    plannerExecution: {
      harness: "claude",
      model: "planner-saved",
      modelSettings: { effort: "low" },
    },
  });
  expect(f.create.mock.calls[0][0].plannerExecution).not.toHaveProperty("runtimeMode");
});
it("uses durable job identity and never enables automatic delivery", async () => {
  const f = fixture();
  const ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  const job = {
    id: "j1",
    projectId: "p1",
    title: "Research",
    request: "Read only",
  } as AssistantJob;
  const profile = {
    execution: {
      harness: "codex",
      model: "chosen-model",
      modelSettings: {},
      runtimeMode: "full-access",
      maxRunMinutes: 30,
    },
    planApproval: "always",
  } as AssistantProfile;
  expect(await ports.createGoal!({ job, profile })).toEqual({ goalId: "assistant-j1" });
  expect(f.create).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "assistant-j1",
      // The goal row must exist before admission or the job waits forever.
      expectedAbsent: true,
      autoMerge: false,
      approvePlan: true,
      projectIds: ["p1"],
      model: "chosen-model",
    }),
  );
  f.list.mockResolvedValue([{ id: "assistant-j1", projectIds: ["p1"], leadProjectId: "p1" }]);
  expect(await ports.findGoal!("j1", job)).toEqual({ goalId: "assistant-j1" });
  await ports.createGoal!({ job, profile });
  expect(f.create).toHaveBeenCalledOnce();
});
it("reports a missing linked goal with its typed code so the job can be resubmitted", async () => {
  const f = fixture();
  const ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  f.list.mockResolvedValue([]);
  await expect(ports.goalStatus!("assistant-j2", undefined, [])).rejects.toMatchObject({
    code: "ASSISTANT_GOAL_MISSING",
    message: "The linked goal is unavailable.",
  });
});
it("gives assigned Claude workers provider compaction while preserving separate planner settings", async () => {
  const f = fixture(),
    ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  const profile = {
    execution: {
      harness: "claude",
      model: "claude:worker",
      modelSettings: { context: "1m", effort: "high" },
      runtimeMode: "supervised",
      maxRunMinutes: 30,
    },
    planningExecution: {
      harness: "claude",
      model: "claude:planner",
      modelSettings: { effort: "low" },
    },
    planApproval: "always",
    workerSoftContext: 150000,
    workerCompactPercent: 50,
  } as AssistantProfile;
  await ports.createGoal!({
    job: { id: "compaction", projectId: "p1", title: "Work", request: "Implement" } as AssistantJob,
    profile,
  });
  expect(f.create.mock.calls[0][0]).toMatchObject({
    modelSettings: {
      context: "1m",
      effort: "high",
      autoCompact: "on",
      autoCompactWindow: "150000",
    },
    runtimeMode: "supervised",
    plannerExecution: { model: "claude:planner", modelSettings: { effort: "low" } },
  });
  expect(profile.execution!.modelSettings).not.toHaveProperty("autoCompact");
});
it("refuses to overwrite an owner or project note through an assistant id", async () => {
  const f = fixture();
  const notes = {
    get: vi.fn(async () => ({ id: "owner", tags: [], sourceCwd: undefined })),
    save: vi.fn(),
    delete: vi.fn(),
  } as unknown as AsyncHostNotes;
  const ports = assistantExecutionPorts(f.store, f.goals, f.tasks, () => notes);
  await expect(
    ports.saveNote!({ id: "owner", title: "New", body: "New", expectedUpdatedAt: 0 }),
  ).rejects.toThrow("not a global assistant note");
  await expect(ports.deleteNote!("owner", 0)).rejects.toThrow("not a global assistant note");
  expect(notes.save).not.toHaveBeenCalled();
  expect(notes.delete).not.toHaveBeenCalled();
});
it("uses actual current-run output for job stalls and treats missing activity as unknown", async () => {
  const f = fixture(),
    now = Date.now(),
    goal = { id: "assistant-j1", status: "running", taskIds: ["task"], projectIds: ["p1"] };
  f.list.mockResolvedValue([goal]);
  const task = { id: "task", goalId: goal.id, projectId: "p1", sessionId: "worker" };
  Object.assign(f.tasks, {
    list: vi.fn(async () => [task]),
    hasRunningGoalWork: vi.fn(async () => true),
  });
  const record = {
    projectId: "p1",
    runId: "current",
    status: "running",
    updatedAt: now,
    runActivity: { runId: "current", lastActivityAt: now - 20 * 60000 },
    session: { blocks: [] },
  };
  Object.assign(f.store, { session: vi.fn(async () => record) });
  const ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  expect((await ports.goalStatus!(goal.id)).lastActivityAt).toBe(now - 20 * 60000);
  record.updatedAt = now + 1;
  expect((await ports.goalStatus!(goal.id)).lastActivityAt).toBe(now - 20 * 60000);
  record.runActivity.runId = "previous";
  expect((await ports.goalStatus!(goal.id)).lastActivityAt).toBeUndefined();
  record.runActivity = { runId: "current", lastActivityAt: now + 60000 };
  expect((await ports.goalStatus!(goal.id)).lastActivityAt).toBeUndefined();
});
it("explains why a goal is waiting: error, plan approval or owner input", async () => {
  const f = fixture(),
    ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  Object.assign(f.tasks, {
    list: vi.fn(async () => []),
    hasRunningGoalWork: vi.fn(async () => false),
  });
  const status = async (goal: Record<string, unknown>) => {
    f.list.mockResolvedValue([{ id: "g", taskIds: [], projectIds: ["p1"], ...goal }] as never);
    return ports.goalStatus!("g");
  };
  expect(await status({ status: "blocked", error: "boom" })).toMatchObject({
    status: "waiting",
    waitingReason: "error",
    summary: "boom",
  });
  expect(await status({ status: "awaiting-approval" })).toMatchObject({
    status: "waiting",
    waitingReason: "planApproval",
  });
  expect(await status({ status: "running" })).not.toHaveProperty("waitingReason");
});
it("keeps mid-turn question answers/steers on the original usage key without prematurely settling or double charging", async () => {
  const f = fixture(),
    goal = { id: "assistant-j1", status: "running", taskIds: ["task"], projectIds: ["p1"] };
  f.list.mockResolvedValue([goal]);
  Object.assign(f.tasks, {
    list: vi.fn(async () => [
      { id: "task", goalId: goal.id, projectId: "p1", sessionId: "worker" },
    ]),
    hasRunningGoalWork: vi.fn(async () => true),
  });
  const original = {
    id: "root",
    role: "user",
    text: "Original work",
    startedAt: 1000,
    turnMetrics: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 2, cacheHitPercent: 20 },
    durationMs: undefined as number | undefined,
  };
  const record = {
    projectId: "p1",
    runId: "run",
    status: "running",
    session: {
      id: "worker",
      harness: "codex",
      blocks: [
        original,
        {
          id: "answer",
          role: "user",
          text: "Clarification",
          continuationOf: "root",
          startedAt: 1100,
          turnMetrics: { inputTokens: 10, outputTokens: 20 },
        },
      ],
    },
  };
  Object.assign(f.store, { session: vi.fn(async () => record) });
  const ports = assistantExecutionPorts(f.store, f.goals, f.tasks);
  const active = await ports.goalStatus!(goal.id);
  expect(active.tokens).toBe(30);
  expect(active.usageTurns).toEqual([
    {
      key: "worker:root",
      tokens: 30,
      at: 1000,
      cacheMetrics: { cacheReadTokens: 2, cacheHitPercent: 20 },
      settled: false,
    },
  ]);
  original.durationMs = 500;
  expect((await ports.goalStatus!(goal.id)).usageTurns![0].settled).toBe(true);
});

it("reads manual cache metrics only from the original accepted authored root turn", async () => {
  const author = { kind: "assistant-manual", supervisionId: "grant", operationId: "op" };
  const root = {
    id: "root",
    role: "user",
    text: "Continue",
    author,
    startedAt: 1000,
    turnMetrics: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheHitPercent: 0 },
  };
  const store = {
    session: async () => ({
      status: "running",
      session: {
        harness: "codex",
        blocks: [
          root,
          {
            ...root,
            id: "continuation",
            continuationOf: "root",
            turnMetrics: { inputTokens: 999, cacheReadTokens: 999 },
          },
        ],
      },
    }),
  } as unknown as HostStore;
  const result = await readManualSessionUsage(store, {
    id: "grant",
    sessionId: "worker",
    enrolledAt: 500,
    source: { harness: "codex" },
  } as any);
  expect(result.turns).toEqual([
    {
      key: "worker:root",
      tokens: 30,
      at: 1000,
      operationId: "op",
      cacheMetrics: { cacheReadTokens: 0, cacheHitPercent: 0 },
      settled: false,
    },
  ]);
  expect(result.incomplete).toBe(false);
});
