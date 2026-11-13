import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import type { ServerBindings } from "../server/bindings";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type {
  HostAutomation,
  HostAutomationRun,
} from "../../src/features/automations/model/hostAutomations";
import type { RoomManagementCall } from "../assistant/management/assistant-management-turn";
import { RoomAutomationChildren } from "./room-children";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const parent = { workId: "parent-work", occurrence: "parent-occurrence" };
const call = (action: string): RoomManagementCall => ({
  threadId: "room",
  projectId: "project",
  family: "conversation",
  action,
  input: {},
  requestId: "original-request",
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "room-child-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS room_work_invocations(work_id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS automation_runs(id TEXT PRIMARY KEY,automation_id TEXT,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS task_admission_generation(id TEXT PRIMARY KEY,generation INTEGER NOT NULL);",
  );
  await store.db
    .prepare("INSERT INTO room_work_invocations VALUES(?,?)")
    .run(parent.workId, JSON.stringify({ stopped: false }));
  const readTask = async (id: string) =>
    JSON.parse(
      String((await store.db.prepare("SELECT value FROM tasks WHERE id=?").get(id))!.value),
    ) as HostTask;
  const putTask = async <T extends { id: string }>(task: T, generation = 1) => {
    await store.db
      .prepare("INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value")
      .run(task.id, JSON.stringify(task));
    await store.db
      .prepare(
        "INSERT INTO task_admission_generation VALUES(?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation",
      )
      .run(task.id, generation);
  };
  const move = vi.fn(async (id: string) => {
    const task = await readTask(id);
    await putTask({ ...task, status: "blocked" });
    return task;
  });
  const stopRun = vi.fn(async () => ({}));
  const runs = vi.fn(async (): Promise<HostAutomationRun[]> => []);
  const services = {
    tasks: { move },
    goals: { cancel: vi.fn() },
    automations: { runs, stopRun },
    engine: { command: vi.fn() },
  } as unknown as Pick<
    ServerBindings,
    | "tasks"
    | "goals"
    | "automations"
    | "engine"
    | "terminals"
    | "conversationDesktop"
    | "assistant"
    | "assistantPorts"
  >;
  const children = new RoomAutomationChildren(store, () => services);
  const completed = async (operation: RoomManagementCall, result: unknown) => {
    const key = `voice-work:${createHash("sha256")
      .update(JSON.stringify([operation.threadId, operation.projectId, operation.requestId]))
      .digest("hex")}`;
    await store.db
      .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
      .run(key, JSON.stringify({ status: "completed", result }));
  };
  return { store, children, putTask, readTask, move, runs, stopRun, completed };
}

it("persists exact intent before native dispatch, then fences and stops only its accepted Task epoch", async () => {
  const f = await fixture();
  const operation = call("tasks.create");
  await f.children.withChild(
    operation,
    parent,
    async () => true,
    async () => {
      const intent = await f.store.db
        .prepare("SELECT value FROM metadata WHERE key='room-child:original-request'")
        .get();
      expect(JSON.parse(String(intent!.value))).toMatchObject({
        ...parent,
        state: "pending",
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      const task = {
        id: String(operation.input.taskId),
        projectId: "project",
        createdAt: 1,
        status: "queued",
        workInvocationId: "original-epoch",
      };
      await f.putTask(task);
      await f.completed(operation, task);
      return task;
    },
  );
  const task = await f.readTask(String(operation.input.taskId));
  expect(await f.children.taskAllowed(task)).toBe(true);
  await f.children.stop(parent.occurrence);
  expect(f.move).toHaveBeenCalledWith(task.id, "blocked", undefined, 1);
  expect(await f.children.taskAllowed(task)).toBe(false);
  const dispatch = vi.fn();
  await expect(f.children.withChild(operation, parent, async () => true, dispatch)).rejects.toThrow(
    "original operation",
  );
  expect(dispatch).not.toHaveBeenCalled();
});

it("preserves both dispatch and unproven-receipt errors without reopening the original intent", async () => {
  const f = await fixture();
  const operation = call("tasks.create");
  const original = new Error("Lost dispatch acknowledgement");
  const failure = await f.children
    .withChild(
      operation,
      parent,
      async () => true,
      async () => {
        await f.putTask({
          id: String(operation.input.taskId),
          projectId: "project",
          createdAt: 1,
          status: "queued",
        });
        throw original;
      },
    )
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBe(original);
  expect((failure as AggregateError).errors[1]).toMatchObject({
    message: expect.stringContaining("unproven"),
  });
  expect(await f.children.taskAllowed(await f.readTask(String(operation.input.taskId)))).toBe(
    false,
  );
});

it("Stop before native reply fences a late queued child and cancellation remains bound to its original generation", async () => {
  const f = await fixture();
  const operation = call("tasks.create");
  let dispatch!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = f.children.withChild(
    operation,
    parent,
    async () => true,
    async () => {
      entered();
      await new Promise<void>((resolve) => {
        dispatch = resolve;
      });
      const task = {
        id: String(operation.input.taskId),
        projectId: "project",
        createdAt: 1,
        status: "queued",
        workInvocationId: "epoch",
      };
      await f.putTask(task);
      await f.completed(operation, task);
      return task;
    },
  );
  await started;
  await f.children.stop(parent.occurrence);
  dispatch();
  const task = await pending;
  expect(f.move).toHaveBeenCalledTimes(1);
  await f.putTask({ ...task, status: "running", workInvocationId: "new-owner-epoch" }, 2);
  f.move.mockClear();
  await f.children.stop(parent.occurrence);
  expect(f.move).not.toHaveBeenCalled();
  expect(await f.children.taskAllowed(await f.readTask(task.id))).toBe(true);
});

it("runNow binds one exact automation run while preserving unrelated owner schedules and runs", async () => {
  const f = await fixture();
  const automation = {
    id: "owner-automation",
    projectId: "project",
    createdAt: 1,
  } as HostAutomation;
  await f.store.db
    .prepare("INSERT INTO automations VALUES(?,?)")
    .run(automation.id, JSON.stringify(automation));
  const operation = { ...call("automations.runNow"), input: { automationId: automation.id } };
  const own = {
    id: "owned-run",
    automationId: automation.id,
    status: "running",
  } as HostAutomationRun;
  const foreign = {
    id: "owner-run",
    automationId: automation.id,
    status: "running",
  } as HostAutomationRun;
  await f.children.withChild(
    operation,
    parent,
    async () => true,
    async () => {
      await f.store.db
        .prepare("INSERT INTO automation_runs VALUES(?,?,?)")
        .run(own.id, automation.id, JSON.stringify(own));
      expect(await f.children.automationAllowed(automation, own)).toBe(true);
      await f.completed(operation, own);
      return own;
    },
  );
  f.runs.mockResolvedValue([own, foreign]);
  await f.children.stop(parent.occurrence);
  expect(f.stopRun).toHaveBeenCalledExactlyOnceWith(automation.id, own.id);
  expect(await f.children.automationAllowed(automation, own)).toBe(false);
  expect(await f.children.automationAllowed(automation, foreign)).toBe(true);
  await new RoomAutomationChildren(
    f.store,
    () =>
      ({
        tasks: { move: f.move },
        goals: {},
        automations: { runs: f.runs, stopRun: f.stopRun },
        engine: {},
      }) as unknown as Pick<
        ServerBindings,
        | "tasks"
        | "goals"
        | "automations"
        | "engine"
        | "terminals"
        | "conversationDesktop"
        | "assistant"
        | "assistantPorts"
      >,
  ).recover();
  expect(f.stopRun).toHaveBeenCalledTimes(2);
});
