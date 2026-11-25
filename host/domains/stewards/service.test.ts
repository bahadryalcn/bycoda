import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks/tasks";
import { HostStewards } from "../../stewards/stewards";
import * as dto from "../../../src/shared/model/host-contracts/stewards";
import { createHostStewardsService } from "./service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-steward-domain-"));
  cleanups.push(async () => {
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()));
    expect(root).toContain("bycoda-steward-domain-");
    await rm(root, { recursive: true, force: true });
  });
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close());
  const turns: Array<{ sessionId: string; finish(): void }> = [];
  const provider = {
    send: vi.fn(
      (input) => new Promise<void>((finish) => turns.push({ sessionId: input.sessionId, finish })),
    ),
    cancel: vi.fn(async (sessionId: string) => {
      turns.find((turn) => turn.sessionId === sessionId)?.finish();
    }),
    stop: vi.fn(async (sessionId: string) => {
      turns.find((turn) => turn.sessionId === sessionId)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await engine.close();
  });
  const tasks = new HostTasks(store, engine);
  cleanups.push(() => tasks.close());
  const stewards = new HostStewards(store, engine, tasks);
  cleanups.push(() => stewards.close());
  await stewards.ready;
  const project = await store.addProject(root, "Fixture");
  const input = {
    id: "steward",
    projectId: project.id,
    enabled: false,
    harness: "codex" as const,
    model: "codex:test",
    modelSettings: { option: "retained" },
    runtimeMode: "auto" as const,
    focus: "Focus",
    scheduleKind: "daily" as const,
    minute: 0,
    time: "09:00",
    dayOfWeek: 0,
    maxProposals: 5,
    maxOpen: 10,
    autoStart: false,
    isolate: false,
  };
  const context = {
    authorized: vi.fn(async () => true),
    principalId: "fixture-device",
  };
  const service = createHostStewardsService({ stewards });
  const task = (id: string, extra = {}) =>
    tasks.save({
      id,
      title: id,
      prompt: "Proposal",
      projectId: project.id,
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
      status: "todo",
      source: "steward",
      stewardId: input.id,
      ...extra,
    });
  return {
    root,
    store,
    engine,
    tasks,
    stewards,
    provider,
    turns,
    project,
    input,
    context,
    service,
    task,
  };
}

it("shares owner defaults, full saved configuration/CAS, five results and pure list behavior", async () => {
  const f = await fixture();
  const saved = dto.HostStewardSchema.parse(await f.service.save({ steward: f.input }, f.context));
  const updated = await f.service.save(
    { steward: { ...saved, focus: "Changed", expectedConfiguration: saved } },
    f.context,
  );
  dto.HostStewardSchema.parse(updated);
  await expect(
    f.service.save({ steward: { ...saved, expectedConfiguration: saved } }, f.context),
  ).rejects.toThrow("Configuration changed");
  const running = { ...updated, nextRunAt: 0, lastRunStatus: "running" };
  await f.store.db
    .prepare("UPDATE stewards SET value=? WHERE id=?")
    .run(JSON.stringify(running), saved.id);
  const version = f.store.db.dataMutationVersion;
  expect(await f.service.list({}, f.context)).toEqual([running]);
  expect(f.store.db.dataMutationVersion).toBe(version);
  expect(f.provider.send).not.toHaveBeenCalled();
  await f.store.db
    .prepare("UPDATE stewards SET value=? WHERE id=?")
    .run(JSON.stringify(updated), saved.id);
  await f.task("proposal");
  expect(await f.service.decline({ taskId: "proposal" }, f.context)).toEqual({
    declined: true,
  });
  expect((await f.stewards.list())[0].declined).toEqual(["proposal"]);
  expect(await f.service.delete({ stewardId: saved.id }, f.context)).toEqual({
    deleted: true,
  });
});

it("keeps strict WS closed while preserving complete tolerant V1 input and exact ID coercion", async () => {
  const f = await fixture();
  await expect(f.service.list({ extra: true }, f.context)).rejects.toThrow();
  const raw = {
    ...f.input,
    focus: null,
    modelSettings: null,
    future: { retained: true },
  };
  await expect(f.service.save({ steward: raw }, f.context)).rejects.toThrow();
  const save = vi.spyOn(f.stewards, "save");
  await f.service.save({ steward: raw, outerFuture: true }, f.context, {
    legacy: true,
  });
  expect(save).toHaveBeenLastCalledWith(raw);
  expect((await f.stewards.list())[0]).toMatchObject({
    focus: "",
    modelSettings: {},
  });
  const remove = vi.spyOn(f.stewards, "delete");
  await f.service.delete({}, f.context, { legacy: true });
  expect(remove).toHaveBeenLastCalledWith("");
  await f.service.delete({ stewardId: 42 }, f.context, { legacy: true });
  expect(remove).toHaveBeenLastCalledWith("42");
  const decline = vi.spyOn(f.stewards, "decline");
  await expect(f.service.decline({ taskId: false }, f.context, { legacy: true })).rejects.toThrow(
    "Task not found",
  );
  expect(decline).toHaveBeenLastCalledWith("false");
});

it("publishes only committed actual Steward removals and preserves proposal tasks", async () => {
  const f = await fixture();
  const saved = await f.service.save({ steward: f.input }, f.context);
  await f.task("kept-proposal");
  const deleted = vi.fn();
  f.stewards.onDelete = deleted;
  await f.service.delete({ stewardId: "absent" }, f.context);
  expect(deleted).not.toHaveBeenCalled();
  await expect(
    f.store.transaction(async () => {
      await f.stewards.delete(saved.id);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(deleted).not.toHaveBeenCalled();
  expect(await f.stewards.list()).toHaveLength(1);
  await f.service.delete({ stewardId: saved.id }, f.context);
  expect(deleted).toHaveBeenCalledExactlyOnceWith({
    id: saved.id,
    projectId: f.project.id,
  });
  expect((await f.tasks.list()).map((task) => task.id)).toEqual(["kept-proposal"]);
});

it("does not remember a declined title when a task dependency blocks deletion", async () => {
  const f = await fixture();
  await f.service.save({ steward: f.input }, f.context);
  await f.task("proposal");
  await f.task("dependent", { dependsOn: ["proposal"] });
  await expect(f.service.decline({ taskId: "proposal" }, f.context)).rejects.toThrow("depend");
  expect((await f.stewards.list())[0].declined).toEqual([]);
  expect((await f.tasks.list()).map((task) => task.id).sort()).toEqual(["dependent", "proposal"]);
});

it("rechecks a save after FIFO SQL admission rather than trusting its earlier grant", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const blocker = f.store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const saving = Promise.withResolvers<void>();
  const original = f.stewards.save.bind(f.stewards);
  vi.spyOn(f.stewards, "save").mockImplementation((raw) => {
    const result = original(raw);
    saving.resolve();
    return result;
  });
  const pending = f.service.save({ steward: f.input }, f.context);
  const denied = expect(pending).rejects.toThrow("revoked");
  await saving.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await blocker;
  await denied;
  expect(await f.stewards.list()).toEqual([]);
});

it("rechecks the concrete write after a wait inside an already-owned save scope", async () => {
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
  const pending = f.service.save({ steward: f.input }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(await f.stewards.list()).toEqual([]);
});

it("does not disclose a captured list after its query waiter is cancelled", async () => {
  const f = await fixture();
  await f.service.save({ steward: f.input }, f.context);
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.stewards.list.bind(f.stewards);
  vi.spyOn(f.stewards, "list").mockImplementationOnce(async () => {
    const result = await original();
    entered.resolve();
    await release.promise;
    return result;
  });
  const pending = f.service.list({}, { ...f.context, signal: controller.signal }),
    cancelled = expect(pending).rejects.toThrow("cancelled");
  await entered.promise;
  controller.abort();
  release.resolve();
  await cancelled;
  expect(f.provider.send).not.toHaveBeenCalled();
});
