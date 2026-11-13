import { expect, it, vi } from "vitest";
import { ConversationThreadWorkTools } from "./conversation-thread-work-tools";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/tasks";
import type { HostGoals } from "../goals/goals";
import type { HostAutomations } from "../automations/automations";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import type { AssistantModelPoolRow } from "../../src/shared/model/assistantModelPool";

const poolRow = (over: Partial<AssistantModelPoolRow>): AssistantModelPoolRow => ({
  id: "row-1",
  harness: "codex",
  model: "gpt",
  modelSettings: { effort: "high" },
  runtimeMode: "supervised",
  maxRunMinutes: 30,
  roles: ["worker"],
  unknownLimit: "use",
  ...over,
});
const pool = {
  rows: [
    poolRow({}),
    poolRow({ id: "row-2", harness: "claude", model: "sonnet", modelSettings: {} }),
  ],
};

function fixture(source = pool) {
  const receipts = new Map<string, string>();
  let records: Array<Record<string, unknown>> = [];
  const store = {
    project: vi.fn(async () => ({ id: "p", cwd: "/repo" })),
    db: {
      prepare: (sql: string) => ({
        get: async (key: string) => (receipts.has(key) ? { value: receipts.get(key) } : undefined),
        run: async (one: string, two: string) => {
          if (sql.startsWith("INSERT")) {
            if (receipts.has(one)) return { changes: 0 };
            receipts.set(one, two);
          } else receipts.set(two, one);
          return { changes: 1 };
        },
      }),
    },
  } as unknown as HostStore;
  const tasks = {
    list: vi.fn(async () => records),
    save: vi.fn(async (input) => {
      const task = { ...input, updatedAt: 2 };
      records.push(task);
      return task;
    }),
    startTask: vi.fn(async () => ({ status: "running" })),
    move: vi.fn(),
  };
  const goals = {
    list: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    create: vi.fn(),
    update: vi.fn(),
    replan: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn(),
  };
  const automations = {
    list: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    save: vi.fn(),
    delete: vi.fn(),
    runs: vi.fn(),
    runNow: vi.fn(),
    stopRun: vi.fn(),
  };
  const approve = vi.fn(async (operation: { operationHash: string }) => ({
    approved: true,
    operationHash: operation.operationHash,
  }));
  const service = (track?: ConstructorParameters<typeof ConversationThreadWorkTools>[6]) =>
    new ConversationThreadWorkTools(
      store,
      tasks as unknown as HostTasks,
      goals as unknown as HostGoals,
      automations as unknown as HostAutomations,
      approve,
      async () => source,
      track,
    );
  const principal = {
    kind: "assistant-thread",
    threadId: "thread",
    projectId: "p",
    environmentId: "env",
  } as RuntimeLogSubjectPrincipal;
  const authorized = vi.fn(async () => true);
  return {
    service,
    principal,
    authorized,
    tasks,
    goals,
    automations,
    approve,
    receipts,
    set records(value: Array<Record<string, unknown>>) {
      records = value;
    },
  };
}
const input = {
  taskId: "task",
  title: "Task",
  prompt: "Do work",
  execution: { harness: "codex", model: "gpt", runtimeMode: "auto", modelSettings: {} },
};
it("creates global work with explicit reviewed execution and deduplicates across service recreation", async () => {
  const f = fixture();
  const result = await f
    .service()
    .call("tasks.create", input, f.principal, f.authorized, "request");
  expect(result).toMatchObject({
    projectId: "p",
    autoMerge: false,
    continueUntilDone: false,
    review: true,
    harness: "codex",
    expectedAbsent: true,
  });
  expect(
    await f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).toEqual(result);
  expect(f.tasks.save).toHaveBeenCalledOnce();
  expect(f.approve).toHaveBeenCalledOnce();
  await expect(
    f
      .service()
      .call("tasks.create", { ...input, prompt: "Changed" }, f.principal, f.authorized, "request"),
  ).rejects.toThrow("reused");
});
it("keeps uncertain effects retained instead of replaying after an acknowledgement is lost", async () => {
  const f = fixture();
  f.tasks.save.mockRejectedValueOnce(new Error("lost acknowledgement"));
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).rejects.toThrow("lost acknowledgement");
  expect(
    await f.service().call("tasks.create", input, f.principal, f.authorized, "request"),
  ).toMatchObject({ status: "uncertain", requestId: "request" });
  expect(f.tasks.save).toHaveBeenCalledOnce();
});
it("requires exact native approval and refuses changed state after approval", async () => {
  const f = fixture();
  f.approve.mockResolvedValueOnce({ approved: true, operationHash: "wrong" });
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "one"),
  ).rejects.toThrow("approval");
  expect(f.tasks.save).not.toHaveBeenCalled();
  f.approve.mockImplementationOnce(async (operation) => {
    f.records = [{ id: "task", projectId: "p", updatedAt: 1 }];
    return { approved: true, operationHash: operation.operationHash };
  });
  await expect(
    f.service().call("tasks.create", input, f.principal, f.authorized, "two"),
  ).rejects.toThrow("changed during approval");
  expect(f.tasks.save).not.toHaveBeenCalled();
});
it("requires explicit execution and current thread authority; hides foreign work", async () => {
  const f = fixture();
  await expect(
    f
      .service()
      .call("tasks.create", { ...input, execution: undefined }, f.principal, f.authorized, "one"),
  ).rejects.toThrow();
  f.authorized.mockResolvedValueOnce(false);
  await expect(f.service().call("tasks.list", {}, f.principal, f.authorized)).rejects.toThrow(
    "revoked",
  );
  f.records = [{ id: "foreign", projectId: "other" }];
  expect(await f.service().call("tasks.list", {}, f.principal, f.authorized)).toMatchObject({
    items: [],
    total: 0,
  });
  await expect(
    f.service().call("tasks.start", { taskId: "foreign" }, f.principal, f.authorized, "two"),
  ).rejects.toThrow("not wholly");
  expect(f.approve).not.toHaveBeenCalled();
});
it("retains reviewed configuration through task and automation canonical saves", async () => {
  const f = fixture();
  const task = { id: "task", projectId: "p", title: "Old", status: "todo", updatedAt: 1 };
  f.records = [task];
  await f
    .service()
    .call("tasks.update", { taskId: "task", title: "New" }, f.principal, f.authorized, "task-edit");
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({ title: "New", expectedConfiguration: task }),
  );
  const automation = { id: "auto", projectId: "p", name: "Old", updatedAt: 4 };
  f.automations.list.mockResolvedValue([automation]);
  await f
    .service()
    .call("automations.pause", { automationId: "auto" }, f.principal, f.authorized, "auto-edit");
  expect(f.automations.save).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, expectedConfiguration: automation }),
  );
  f.automations.list.mockResolvedValue([]);
  await f
    .service()
    .call(
      "automations.create",
      { automationId: "new-auto", execution: input.execution, name: "New", prompt: "Work" },
      f.principal,
      f.authorized,
      "auto-create",
    );
  expect(f.automations.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: "new-auto", expectedAbsent: true }),
  );
});
it("passes the reviewed snapshot into execution admission and valid complete goal settings", async () => {
  const f = fixture();
  const task = { id: "task", projectId: "p", status: "todo", updatedAt: 1 };
  f.records = [task];
  await f.service().call("tasks.start", { taskId: "task" }, f.principal, f.authorized, "start");
  expect(f.tasks.startTask).toHaveBeenCalledWith("task", task);
  const automation = { id: "auto", projectId: "p", updatedAt: 4 };
  f.automations.list.mockResolvedValue([automation]);
  await f
    .service()
    .call("automations.runNow", { automationId: "auto" }, f.principal, f.authorized, "run");
  expect(f.automations.runNow).toHaveBeenCalledWith("auto", automation);
  const goal = {
    id: "goal",
    projectIds: ["p"],
    approvePlan: true,
    manualStart: true,
    updatedAt: 5,
    maxRunningTasks: 2,
    maxRunMinutes: 10,
  };
  f.goals.list.mockResolvedValue([goal]);
  await f
    .service()
    .call(
      "goals.update",
      { goalId: "goal", maxRunMinutes: 20 },
      f.principal,
      f.authorized,
      "goal-edit",
    );
  expect(f.goals.update).toHaveBeenCalledWith(
    "goal",
    expect.objectContaining({
      autoMerge: false,
      continueUntilDone: false,
      maxRunningTasks: 2,
      maxRunMinutes: 20,
    }),
    5,
  );
});

it("uses a distinct delegated principal and rejects stale target revisions", async () => {
  const f = fixture();
  const principal = {
    kind: "delegated-assistant-thread" as const,
    originEnvironmentId: "origin",
    targetEnvironmentId: "target",
    threadId: "thread",
    projectId: "p",
    grantId: "grant",
  };
  const service = f.service();
  expect(await service.callDelegated("tasks.create", input, principal, f.authorized)).toMatchObject(
    { projectId: "p", expectedAbsent: true },
  );
  await expect(
    service.callDelegated(
      "tasks.update",
      { taskId: "task", title: "changed", expectedUpdatedAt: 1 },
      principal,
      f.authorized,
    ),
  ).rejects.toThrow("Work changed");
  expect(f.tasks.save).toHaveBeenCalledOnce();
});

it("qualifies project state before review and checks scope again before the effect", async () => {
  const f = fixture();
  let captures = 0;
  const result = await f
    .service()
    .call("tasks.create", input, f.principal, f.authorized, "scope-test", async (effect) => {
      captures++;
      if (captures === 2) throw new Error("Project became private");
      return effect();
    })
    .catch((error) => error);
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toContain("Project became private");
  expect(f.approve).toHaveBeenCalledOnce();
  expect(f.tasks.save).not.toHaveBeenCalled();
  expect(captures).toBe(2);
});

it("rejects a model outside the pool for task, goal and automation creation", async () => {
  const f = fixture();
  const outside = { ...input, execution: { harness: "codex", model: "other" } };
  await expect(
    f.service().call("tasks.create", outside, f.principal, f.authorized, "t"),
  ).rejects.toThrow("not in the assistant's model pool. Choose one of: gpt, sonnet.");
  await expect(
    f
      .service()
      .call(
        "goals.create",
        { goalId: "g", title: "G", prompt: "P", execution: outside.execution },
        f.principal,
        f.authorized,
        "g",
      ),
  ).rejects.toThrow("model pool");
  await expect(
    f.service().call(
      "automations.create",
      {
        automationId: "a",
        name: "A",
        prompt: "P",
        scheduleKind: "daily",
        execution: outside.execution,
      },
      f.principal,
      f.authorized,
      "a",
    ),
  ).rejects.toThrow("model pool");
  expect(f.approve).not.toHaveBeenCalled();
  expect(f.tasks.save).not.toHaveBeenCalled();
  expect(f.goals.create).not.toHaveBeenCalled();
  expect(f.automations.save).not.toHaveBeenCalled();
});
it("applies the pool row settings to an accepted explicit model", async () => {
  const f = fixture();
  await f.service().call(
    "tasks.create",
    {
      ...input,
      execution: {
        harness: "codex",
        model: "gpt",
        runtimeMode: "auto",
        modelSettings: { effort: "low" },
      },
    },
    f.principal,
    f.authorized,
    "explicit",
  );
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "codex",
      model: "gpt",
      modelSettings: { effort: "high" },
      runtimeMode: "supervised",
    }),
  );
});
it("resolves poolRowId and defaults to the first worker row when omitted", async () => {
  const f = fixture();
  await f
    .service()
    .call(
      "tasks.create",
      { ...input, taskId: "by-id", execution: { poolRowId: "row-2" } },
      f.principal,
      f.authorized,
      "by-id",
    );
  expect(f.tasks.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ harness: "claude", model: "sonnet" }),
  );
  await f
    .service()
    .call(
      "tasks.create",
      { ...input, taskId: "default", execution: {} },
      f.principal,
      f.authorized,
      "default",
    );
  expect(f.tasks.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ harness: "codex", model: "gpt" }),
  );
  await expect(
    f
      .service()
      .call(
        "tasks.create",
        { ...input, taskId: "bad", execution: { poolRowId: "nope" } },
        f.principal,
        f.authorized,
        "bad",
      ),
  ).rejects.toThrow("model pool");
});

it("reviews task deletion, transfer, queue pause, review recheck and reorder like other work writes", async () => {
  const f = fixture();
  f.records = [
    { id: "a", projectId: "p", status: "queued", updatedAt: 3, title: "A" },
    { id: "b", projectId: "p", status: "todo", updatedAt: 4, title: "B" },
    { id: "other", projectId: "q", status: "todo", updatedAt: 1, title: "Other" },
  ];
  const extra = f.tasks as Record<string, unknown>;
  extra.delete = vi.fn(async () => undefined);
  extra.transfer = vi.fn(async () => ({ id: "a", projectId: "q" }));
  extra.recheckReview = vi.fn(async () => ({ id: "a" }));
  extra.reorder = vi.fn(async () => []);
  extra.move = vi.fn(async () => ({ id: "a", status: "todo" }));
  const run = (action: string, body: Record<string, unknown>, id: string) =>
    f.service().call(action, body, f.principal, f.authorized, id);
  await run("tasks.delete", { taskId: "b", expectedUpdatedAt: 4 }, "r1");
  expect(extra.delete).toHaveBeenCalledWith("b", false, 4);
  await run("tasks.transfer", { taskId: "a", targetProjectId: "q", expectedUpdatedAt: 3 }, "r2");
  expect(extra.transfer).toHaveBeenCalledWith("a", "q", 3);
  await run("tasks.queue.pause", { taskId: "a", expectedUpdatedAt: 3 }, "r3");
  expect(extra.move).toHaveBeenCalledWith("a", "todo");
  await run("tasks.review.recheck", { taskId: "a" }, "r4");
  expect(extra.recheckReview).toHaveBeenCalledWith("a");
  await run(
    "tasks.reorder",
    {
      order: [
        { taskId: "b", expectedUpdatedAt: 4 },
        { taskId: "a", expectedUpdatedAt: 3 },
      ],
    },
    "r5",
  );
  expect(extra.reorder).toHaveBeenCalledWith(["b", "a"]);
  expect(f.approve).toHaveBeenCalledTimes(5);
  await expect(
    run("tasks.delete", { taskId: "other", expectedUpdatedAt: 1 }, "r6"),
  ).rejects.toThrow(/not wholly in this project/);
  await expect(run("tasks.delete", { taskId: "b", expectedUpdatedAt: 9 }, "r7")).rejects.toThrow(
    /changed/,
  );
  await expect(
    run("tasks.reorder", { order: [{ taskId: "other", expectedUpdatedAt: 1 }] }, "r8"),
  ).rejects.toThrow(/not wholly in this project/);
  expect(extra.delete).toHaveBeenCalledTimes(1);
});

it("denies task deletion when the owner approval is not granted", async () => {
  const f = fixture();
  f.records = [{ id: "b", projectId: "p", status: "todo", updatedAt: 4 }];
  const extra = f.tasks as Record<string, unknown>;
  extra.delete = vi.fn();
  f.approve.mockResolvedValueOnce({ approved: false } as never);
  await expect(
    f
      .service()
      .call("tasks.delete", { taskId: "b", expectedUpdatedAt: 4 }, f.principal, f.authorized, "r1"),
  ).rejects.toThrow(/approval/);
  expect(extra.delete).not.toHaveBeenCalled();
});
it("tracks only top-level work the thread started, best effort and without extra authority", async () => {
  const f = fixture();
  const track = vi.fn(async () => undefined);
  const tools = f.service(track);
  await tools.call("tasks.create", input, f.principal, f.authorized, "track-1");
  expect(track).toHaveBeenCalledWith({
    kind: "task",
    id: "task",
    projectId: "p",
    threadId: "thread",
    title: "Task",
  });
  await tools.call(
    "goals.create",
    { title: "Goal", prompt: "Do", execution: input.execution, goalId: "goal" },
    f.principal,
    f.authorized,
    "g-1",
  );
  expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "goal", id: "goal" }));
  // A goal-owned task and a failing tracker never affect the approved work.
  track.mockClear();
  f.records = [{ id: "owned", projectId: "p", goalId: "g", title: "Owned", updatedAt: 1 }];
  await tools.call("tasks.start", { taskId: "owned" }, f.principal, f.authorized, "start-1");
  expect(track).not.toHaveBeenCalled();
  f.records = [{ id: "own", projectId: "p", title: "Own", updatedAt: 1 }];
  track.mockRejectedValueOnce(new Error("tracker down"));
  await expect(
    tools.call("tasks.start", { taskId: "own" }, f.principal, f.authorized, "start-2"),
  ).resolves.toBeDefined();
  expect(track).toHaveBeenCalledWith(expect.objectContaining({ id: "own", title: "Own" }));
});

it("tasks.create preserves the selected non-default provider account", async () => {
  const f = fixture({ rows: [poolRow({ providerAccountId: "work" })] });
  await f
    .service()
    .call(
      "tasks.create",
      { ...input, execution: { poolRowId: "row-1" } },
      f.principal,
      f.authorized,
      "account-request",
    );
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({ providerAccountId: "work", model: "gpt" }),
  );
});
