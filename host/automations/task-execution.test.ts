import { WorkStorage } from "../work/storage";
import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostTasks } from "../tasks/service";
import { HostAutomations } from "./automations";
import { createAutomationTask, automationTaskProjection } from "./task-execution";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("creates one canonical Task per occurrence and replays without editing owner changes", async () => {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine);
  automations.bindTasks(tasks);
  const definition = await automations.save({
    id: "audit",
    name: "Audit",
    projectId: f.project.id,
    prompt: "Inspect source",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    isolate: false,
    enabled: false,
  });
  const run = await automations.runNow(definition.id);
  expect(run.status).toBe("pending");
  expect(run.taskId).toBeTruthy();
  expect(f.turns).toHaveLength(0);
  const task = (await tasks.get(run.taskId!))!;
  expect(task).toMatchObject({ prompt: definition.prompt, status: "queued", review: false });
  await tasks.save({ ...task, title: "Owner title" });
  const replayed = await createAutomationTask(f.store, tasks, definition, run);
  expect(replayed.taskId).toBe(run.taskId);
  expect((await tasks.get(run.taskId!))?.title).toBe("Owner title");
  expect(
    await f.store.db.prepare("SELECT task_id FROM automation_tasks WHERE run_id=?").get(run.id),
  ).toMatchObject({ task_id: run.taskId });
  await f.store.db
    .prepare("UPDATE tasks SET value=json_set(value,'$.status','done') WHERE id=?")
    .run(run.taskId!);
  await automations.tick();
  expect((await automations.runs(definition.id))[0]).toMatchObject({
    taskId: run.taskId,
    status: "succeeded",
  });
  await automations.close();
});

it("rolls back occurrence link when Task persistence fails", async () => {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine);
  automations.bindTasks(tasks);
  const definition = await automations.save({
    id: "audit",
    name: "Audit",
    projectId: f.project.id,
    prompt: "Inspect source",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    isolate: false,
    enabled: false,
  });
  const run = {
    id: "occurrence",
    automationId: definition.id,
    trigger: "manual" as const,
    scheduledFor: 1,
    createdAt: 1,
    status: "pending" as const,
  };
  await f.store.db
    .prepare("INSERT INTO automation_runs(id,automation_id,created_at,value) VALUES(?,?,?,?)")
    .run(run.id, definition.id, 1, JSON.stringify(run));
  const failing = {
    ready: tasks.ready,
    get: tasks.get.bind(tasks),
    save: async () => {
      throw new Error("Storage failed");
    },
  } as unknown as HostTasks;
  await expect(createAutomationTask(f.store, failing, definition, run)).rejects.toThrow(
    "Storage failed",
  );
  expect(
    await f.store.db.prepare("SELECT task_id FROM automation_tasks WHERE run_id=?").get(run.id),
  ).toBeUndefined();
  expect((await automations.runs(definition.id))[0].taskId).toBeUndefined();
  await automations.close();
});

async function pendingTodo() {
  const f = await setup();
  const tasks = new HostTasks(f.store, f.engine);
  const automations = new HostAutomations(f.store, f.engine);
  automations.bindTasks(tasks);
  const definition = await automations.save({
    id: "audit",
    name: "Audit",
    projectId: f.project.id,
    prompt: "Inspect source",
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    isolate: false,
    enabled: false,
  });
  const run = await automations.runNow(definition.id);
  const task = await tasks.move(run.taskId!, "todo");
  return { ...f, tasks, automations, definition, run, task };
}

it("Stop cancels an unstarted to-do occurrence without changing or resuming its retained Task", async () => {
  const f = await pendingTodo();
  const before = await f.tasks.get(f.task.id);
  const stopped = await f.automations.stopRun(f.definition.id, f.run.id);
  expect(stopped.run).toMatchObject({
    status: "cancelled",
    taskId: f.task.id,
    cancellationRequested: true,
  });
  expect(await f.tasks.get(f.task.id)).toEqual(before);
  await f.automations.tick();
  await f.tasks.tick();
  expect((await f.automations.runs(f.definition.id))[0].status).toBe("cancelled");
  expect((await f.tasks.get(f.task.id))?.status).toBe("todo");
  expect(f.turns).toHaveLength(0);
  await f.automations.close();
});

it("Stop cancels a queued Task occurrence without dispatch or automatic revival", async () => {
  const f = await pendingTodo();
  await f.tasks.move(f.task.id, "queued");
  const stopped = await f.automations.stopRun(f.definition.id, f.run.id);
  expect(stopped.run).toMatchObject({ status: "cancelled", cancellationRequested: true });
  expect((await f.tasks.get(f.task.id))?.status).toBe("blocked");
  await f.tasks.tick();
  await f.tasks.idle();
  await f.automations.tick();
  expect(f.turns).toHaveLength(0);
  expect((await f.automations.runs(f.definition.id))[0].status).toBe("cancelled");
  await f.automations.close();
});

it("projects question state only while the canonical Task is running", async () => {
  const f = await pendingTodo();
  const running = { ...f.task, status: "running" as const };
  expect(automationTaskProjection(f.run, running, true).needsInput).toBe(true);
  expect(automationTaskProjection(f.run, running, false).needsInput).toBeUndefined();
  expect(
    automationTaskProjection(f.run, { ...running, status: "done" }, true).needsInput,
  ).toBeUndefined();
  await f.automations.close();
});

it("Stop retains cancellation intent while unknown Task Work retirement remains held", async () => {
  const f = await pendingTodo();
  const storage = new WorkStorage(f.store, Date.now);
  const work = await storage.submit({
    source: { kind: "task.worker", id: f.task.id, occurrence: "unknown-run" },
    projectId: f.task.projectId,
    payload: {},
  });
  await storage.save({ ...work, state: "unknown", reserved: true, dispatchStarted: true });
  try {
    await expect(f.automations.stopRun(f.definition.id, f.run.id)).rejects.toThrow(
      "not proven stopped",
    );
    expect((await f.automations.runs(f.definition.id))[0]).toMatchObject({
      status: "pending",
      cancellationRequested: true,
    });
    expect((await f.tasks.get(f.task.id))?.status).toBe("todo");
  } finally {
    await storage.save({
      ...work,
      state: "completed",
      reserved: false,
      dispatchStarted: true,
      outcome: { status: "cancelled" },
    });
  }
  await f.automations.tick();
  expect((await f.automations.runs(f.definition.id))[0].status).toBe("cancelled");
  expect(f.turns).toHaveLength(0);
  await f.automations.close();
});

it("Stop rejects a foreign Task link before mutating either Task", async () => {
  const f = await pendingTodo();
  const foreign = await f.tasks.save({
    ...f.task,
    id: "foreign",
    source: "manual",
    automationId: undefined,
    automationRunId: undefined,
    status: "todo",
  });
  await f.store.db
    .prepare("UPDATE automation_runs SET value=json_set(value,'$.taskId',?) WHERE id=?")
    .run(foreign.id, f.run.id);
  await expect(f.automations.stopRun(f.definition.id, f.run.id)).rejects.toThrow(
    "ownership does not match",
  );
  expect(await f.tasks.get(foreign.id)).toEqual(foreign);
  expect((await f.tasks.get(f.task.id))?.status).toBe("todo");
  expect((await f.automations.runs(f.definition.id))[0].cancellationRequested).toBeUndefined();
  await f.automations.close();
});
