import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks/service";
import { createAutomationTask } from "../../automations/task-execution";
import { HostAutomations, type AutomationWorkspaceServices } from "../../automations/automations";
import * as dto from "../../../src/shared/model/host-contracts/automations";
import { createHostAutomationsService } from "./service";

const cleanups: Array<() => Promise<void>> = [];

it("fails closed when proposal support is unavailable or an owner supplies extra authority", async () => {
  const f = await fixture();
  const input = {
    operationId: "proposal",
    request: "Review daily at 09:00",
    projectId: "project",
    currentExecution: { harness: "codex", model: "model", modelSettings: {} },
  };
  await expect(f.service.propose(input, f.context)).rejects.toThrow("unavailable");
  await expect(
    f.service.propose({ ...input, confirmationRequired: false }, f.context),
  ).rejects.toThrow();
  expect(await f.automations.list()).toEqual([]);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture(workspaces?: AutomationWorkspaceServices) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-automation-domain-"));
  cleanups.push(async () => {
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    expect(root).toContain("bycoda-automation-domain-");
    await rm(root, { recursive: true, force: true });
  });
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  const finishes: Array<() => void> = [];
  const provider = {
    send: vi.fn(() => new Promise<void>((done) => finishes.push(done))),
    cancel: vi.fn(async () => {
      finishes.at(-1)?.();
    }),
    stop: vi.fn(async () => {
      finishes.at(-1)?.();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  cleanups.push(async () => {
    for (const finish of finishes) finish();
    await engine.close();
  });
  const project = await store.addProject(root, "Fixture");
  const clock = { now: new Date(2026, 9, 5, 8, 0).getTime() };
  const tasks = new HostTasks(store, engine, () => clock.now);
  await tasks.ready;
  cleanups.push(() => tasks.close());
  const automations = new HostAutomations(store, engine, () => clock.now, workspaces);
  automations.bindTasks(tasks);
  cleanups.push(() => automations.close());
  await automations.ready;
  const context = { authorized: vi.fn(async () => true) };
  const service = createHostAutomationsService({ automations });
  const input = {
    id: "daily",
    name: "Daily",
    prompt: "Keep this exact prompt",
    projectId: project.id,
    harness: "claude",
    model: "fixture:model",
    modelSettings: { custom: "unchanged" },
    runtimeMode: "auto",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    maxRunMinutes: 10,
    maxRunsPerDay: 2,
    enabled: true,
    isolate: false,
  };
  return { root, store, engine, provider, finishes, clock, tasks, automations, context, service, input };
}

it("keeps the owner clock, local timezone, defaults, CAS configuration and concrete rows", async () => {
  const f = await fixture();
  const schedule = { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 };
  const preview = dto.AutomationsPreviewResultSchema.parse(
    await f.service.preview({ schedule }, f.context),
  );
  expect(preview).toEqual(f.automations.preview(schedule));
  const saved = dto.HostAutomationSchema.parse(
    await f.service.save({ automation: f.input }, f.context),
  );
  expect(saved.nextRunAt).toBe(preview.nextRunAt);
  expect(saved.modelSettings).toEqual(f.input.modelSettings);
  expect(await f.service.list({}, f.context)).toEqual([saved]);
  const updated = await f.service.save(
    { automation: { ...saved, prompt: "New", expectedConfiguration: saved } },
    f.context,
  );
  expect(updated.updatedAt).toBeGreaterThan(saved.updatedAt);
  await expect(
    f.service.save({ automation: { ...saved, expectedConfiguration: saved } }, f.context),
  ).rejects.toThrow("Configuration changed");
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(await f.service.delete({ automationId: saved.id }, f.context)).toEqual({ deleted: true });
});

it("keeps strict finite WS inputs and exact tolerant V1 nested input and ID coercion", async () => {
  const f = await fixture();
  await expect(f.service.list({ future: true }, f.context)).rejects.toThrow();
  await expect(
    f.service.save({ automation: { ...f.input, nestedUnknown: { retained: true } } }, f.context),
  ).rejects.toThrow();
  const raw = { ...f.input, nestedUnknown: { retained: true }, enabled: 0 };
  const save = vi.spyOn(f.automations, "save");
  await f.service.save({ automation: raw, outerFuture: true }, f.context, { legacy: true });
  expect(save).toHaveBeenLastCalledWith(raw);
  expect((await f.automations.list())[0].enabled).toBe(true);
  const runs = vi.spyOn(f.automations, "runs");
  expect(await f.service.runs({}, f.context, { legacy: true })).toEqual([]);
  expect(runs).toHaveBeenLastCalledWith("");
  await expect(
    f.service.save({ automation: { ...f.input, time: "99:99" } }, f.context),
  ).rejects.toThrow("time");
});

it("rechecks request authority after actual queued SQL admission", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const blocker = f.store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const saving = Promise.withResolvers<void>(),
    original = f.automations.save.bind(f.automations);
  vi.spyOn(f.automations, "save").mockImplementation((raw) => {
    const pending = original(raw);
    saving.resolve();
    return pending;
  });
  const pending = f.service.save({ automation: f.input }, f.context);
  const denied = expect(pending).rejects.toThrow("revoked");
  await saving.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await blocker;
  await denied;
  expect(await f.automations.list()).toEqual([]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("rechecks the concrete save after a wait inside the already-owned SQL scope", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.store.project.bind(f.store);
  vi.spyOn(f.store, "project").mockImplementation(async (id) => {
    const result = await original(id);
    entered.resolve();
    await release.promise;
    return result;
  });
  const pending = f.service.save({ automation: f.input }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(await f.automations.list()).toEqual([]);
});

it("rejects revoked authority at canonical Task admission without an orphan Task link", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = f.tasks.save.bind(f.tasks);
  vi.spyOn(f.tasks, "save").mockImplementation(async (input) => {
    entered.resolve();
    await release.promise;
    return original(input);
  });
  const pending = f.service.runNow({ automationId: f.input.id }, f.context);
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(await f.tasks.list()).toEqual([]);
  const history = await f.automations.runs(f.input.id);
  expect(history.every((run) => !run.taskId)).toBe(true);
  expect(await f.store.db.prepare("SELECT task_id FROM automation_tasks").all()).toEqual([]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("acknowledges one linked queued Task without creating a session or launching a provider", async () => {
  const f = await fixture();
  const definition = await f.service.save({ automation: f.input }, f.context);
  const run = dto.HostAutomationRunSchema.parse(await f.service.runNow({ automationId: definition.id }, f.context));
  expect(run).toMatchObject({ status: "pending", trigger: "manual" });
  expect(run.taskId).toBeTruthy();
  expect(run.sessionId).toBeUndefined();
  expect(run.runId).toBeUndefined();
  expect(await f.tasks.get(run.taskId!)).toMatchObject({
    status: "queued", source: "automation", automationId: definition.id, automationRunId: run.id,
    prompt: definition.prompt, modelSettings: definition.modelSettings,
  });
  expect(await f.store.db.prepare("SELECT task_id FROM automation_tasks WHERE run_id=?").get(run.id))
    .toMatchObject({ task_id: run.taskId });
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("retains the accepted link after a lost authorized reply and replays that occurrence without duplication", async () => {
  const f = await fixture();
  const definition = await f.service.save({ automation: f.input }, f.context);
  const original = f.automations.runNow.bind(f.automations);
  vi.spyOn(f.automations, "runNow").mockImplementation(async (...args) => {
    const accepted = await original(...args);
    f.context.authorized.mockResolvedValue(false);
    return accepted;
  });
  await expect(f.service.runNow({ automationId: definition.id }, f.context)).rejects.toThrow("revoked");
  const [run] = await f.automations.runs(definition.id);
  expect(run.taskId).toBeTruthy();
  const originalTask = await f.tasks.get(run.taskId!);
  const replayed = await createAutomationTask(f.store, f.tasks, definition, run);
  expect(replayed.taskId).toBe(run.taskId);
  expect(await f.tasks.get(run.taskId!)).toEqual(originalTask);
  expect(await f.tasks.list()).toHaveLength(1);
  expect(await f.automations.runs(definition.id)).toHaveLength(1);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("rolls back the Task and mapping together when Task persistence fails", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  vi.spyOn(f.tasks, "save").mockRejectedValue(new Error("Task storage failed"));
  const result = await f.service.runNow({ automationId: f.input.id }, f.context);
  expect(result).toMatchObject({ status: "failed", error: "Task storage failed" });
  expect(result.taskId).toBeUndefined();
  expect(await f.tasks.list()).toEqual([]);
  expect(await f.store.db.prepare("SELECT task_id FROM automation_tasks").all()).toEqual([]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("runs accepted persisted schedules using Host clock and original configuration after creator revocation", async () => {
  const f = await fixture();
  const saved = await f.service.save({ automation: f.input }, f.context);
  f.context.authorized.mockResolvedValue(false);
  f.clock.now = saved.nextRunAt;
  await f.automations.tick();
  const [run] = await f.automations.runs(f.input.id);
  expect(run).toMatchObject({ status: "pending", trigger: "scheduled", scheduledFor: saved.nextRunAt });
  expect(run.taskId).toBeTruthy();
  expect(await f.tasks.get(run.taskId!)).toMatchObject({
    status: "queued", prompt: f.input.prompt, harness: f.input.harness,
    model: f.input.model, modelSettings: f.input.modelSettings,
  });
  await f.automations.tick();
  expect(await f.automations.runs(f.input.id)).toHaveLength(1);
  expect(await f.tasks.list()).toHaveLength(1);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("does not cancel accepted Task admission when its response waiter aborts", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = f.tasks.save.bind(f.tasks);
  vi.spyOn(f.tasks, "save").mockImplementation(async (input) => {
    entered.resolve();
    await release.promise;
    return original(input);
  });
  const controller = new AbortController();
  const context = { ...f.context, signal: controller.signal };
  const pending = f.service.runNow({ automationId: f.input.id }, context);
  await entered.promise;
  controller.abort();
  release.resolve();
  const run = await pending;
  expect(run).toMatchObject({ status: "pending", trigger: "manual" });
  expect((await f.tasks.get(run.taskId!))?.status).toBe("queued");
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  await expect(f.service.runNow({ automationId: f.input.id }, context)).rejects.toThrow("cancelled");
  expect(await f.automations.runs(f.input.id)).toHaveLength(1);
});

it("skips a second manual occurrence while its canonical Task is still queued", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const first = await f.service.runNow({ automationId: f.input.id }, f.context);
  const second = await f.service.runNow({ automationId: f.input.id }, f.context);
  expect(first.status).toBe("pending");
  expect(second.status).toBe("skipped");
  expect(second.taskId).toBeUndefined();
  expect(await f.tasks.list()).toHaveLength(1);
  expect(f.provider.send).not.toHaveBeenCalled();
});
it("retries only the exact owned activity for a retained legacy failed run", async () => {
  const runId = "legacy-run";
  const workspace = { id: "owned-workspace", owner: { kind: "automationRun", id: runId }, directoryState: "present" };
  let activity: { id: string; workspaceId: string; ownerId: string; kind: string } | undefined = {
    id: "owned-activity", workspaceId: workspace.id, ownerId: "other-run", kind: "provider",
  };
  const stop = vi.fn(async (_id: string) => { activity = undefined; });
  const finish = vi.fn();
  const services = {
    environmentId: "fixture",
    registry: { get: async () => workspace, finish },
    activity: { list: async () => activity ? [activity] : [], stop },
  } as unknown as AutomationWorkspaceServices;
  const f = await fixture(services);
  await f.service.save({ automation: f.input }, f.context);
  const legacy = { id: runId, automationId: f.input.id, createdAt: 1, scheduledFor: 1,
    startedAt: 1, status: "failed", trigger: "manual", cleanupPending: true,
    workspaceId: workspace.id, activityId: "owned-activity" };
  await f.store.db.prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
    .run(legacy.id, legacy.automationId, legacy.createdAt, JSON.stringify(legacy));
  await expect(f.automations.delete(f.input.id)).rejects.toThrow("cleanup");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await f.automations.tick();
    expect(stop).not.toHaveBeenCalled();
    activity!.ownerId = runId;
    stop.mockRejectedValueOnce(new Error("Temporary reservation storage failure"));
    await f.automations.tick();
    expect((await f.automations.runs(f.input.id))[0].cleanupPending).toBe(true);
    await f.automations.tick();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenLastCalledWith("owned-activity");
    expect((await f.automations.runs(f.input.id))[0].cleanupPending).toBeUndefined();
    expect((await f.automations.runs(f.input.id))[0].status).toBe("failed");
    await f.automations.tick();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(finish).not.toHaveBeenCalled();
    expect(f.provider.send).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

it("retains failed legacy cleanup history when old completed history is pruned", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  await f.store.db.scope(async () => {
    for (let index = 0; index < 105; index++) {
      const run = { id: `old-${index}`, automationId: f.input.id, createdAt: index,
        scheduledFor: index, startedAt: index, status: "failed", trigger: "manual",
        ...(index === 0 ? { cleanupPending: true, workspaceId: "retained", activityId: "retained" } : {}) };
      await f.store.db.prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
        .run(run.id, run.automationId, run.createdAt, JSON.stringify(run));
    }
  });
  const first = await f.service.runNow({ automationId: f.input.id }, f.context);
  expect(first.status).toBe("pending");
  const second = await f.service.runNow({ automationId: f.input.id }, f.context);
  expect(second.status).toBe("skipped");
  const history = await f.automations.runs(f.input.id);
  expect(history.some((run) => run.id === "old-0" && run.cleanupPending)).toBe(true);
  expect(history.some((run) => run.id === "old-1")).toBe(false);
  expect(f.provider.send).not.toHaveBeenCalled();
});
