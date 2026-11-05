import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks/tasks";
import { HostStewards, type StewardWorkspaceServices } from "../../stewards/stewards";
import * as dto from "../../../src/shared/model/host-contracts/stewards";
import { createHostStewardsService } from "./service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture(workspaces?: StewardWorkspaceServices) {
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
  const stewards = new HostStewards(store, engine, tasks, undefined, workspaces);
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
  const running = {
    ...updated,
    nextRunAt: 0,
    lastRunStatus: "running",
    run: {
      startedAt: 1,
      sessionId: "not-a-live-session",
      runId: "retained-turn",
    },
  };
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

it("retains confirmed create identity and honest failed preparation when revoked before send, then permits system cleanup", async () => {
  const f = await fixture();
  await f.service.save({ steward: f.input }, f.context);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const result = await original(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  const pending = f.service.runNow({ stewardId: f.input.id }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  const [failed] = await f.stewards.list();
  dto.HostStewardSchema.parse(failed);
  expect(failed).toMatchObject({
    lastRunStatus: "failed",
    run: { error: expect.stringContaining("revoked") },
  });
  expect(failed.run?.sessionId).toBeTruthy();
  expect(failed.run?.runId).toBeUndefined();
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  await f.store.db.outsideScope(() => f.stewards.tick());
  expect((await f.stewards.list())[0]).toMatchObject({
    lastRunStatus: "failed",
    lastSessionId: failed.run!.sessionId,
  });
  expect((await f.stewards.list())[0].run).toBeUndefined();
});

it("keeps actual accepted send IDs and concurrent config without Stop after creator revocation", async () => {
  const f = await fixture();
  const saved = await f.service.save({ steward: f.input }, f.context);
  const original = f.engine.command.bind(f.engine);
  let receipt: { sessionId: string; runId?: string } | undefined;
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    const result = await original(command);
    if ((command as { type?: string }).type === "send") {
      receipt = { sessionId: result.sessionId, runId: result.runId };
      await f.store.db.outsideScope(() =>
        f.stewards.save({
          ...saved,
          focus: "Concurrent edit",
          expectedConfiguration: saved,
        }),
      );
      f.context.authorized.mockResolvedValue(false);
    }
    return result;
  });
  await expect(f.service.runNow({ stewardId: saved.id }, f.context)).rejects.toThrow("revoked");
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), {
    timeout: 5000,
  });
  const [current] = await f.stewards.list();
  dto.HostStewardSchema.parse(current);
  expect(current).toMatchObject({
    focus: "Concurrent edit",
    lastRunStatus: "running",
    run: receipt,
  });
  expect(current.run?.runId).toBeTruthy();
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.provider.stop).not.toHaveBeenCalled();
  await f.store.db.outsideScope(() => f.stewards.tick());
  expect((await f.stewards.list())[0].run?.runId).toBe(receipt!.runId);
});

it("does not resurrect a Steward deleted during denied preparation", async () => {
  const f = await fixture();
  await f.service.save({ steward: f.input }, f.context);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const result = await original(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  const pending = f.service.runNow({ stewardId: f.input.id }, f.context),
    denied = expect(pending).rejects.toThrow();
  await entered.promise;
  await f.stewards.delete(f.input.id);
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(await f.stewards.list()).toEqual([]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("checks authority after policy wait before any managed workspace effect", async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const prepare = vi.fn(),
    start = vi.fn();
  const workspaces = {
    environmentId: "fixture",
    registry: { prepare },
    activity: { start },
    policy: {
      resolve: async () => {
        entered.resolve();
        await release.promise;
        return { policy: { defaultMode: "worktree" } };
      },
    },
  } as unknown as StewardWorkspaceServices;
  const f = await fixture(workspaces);
  await f.service.save({ steward: { ...f.input, isolate: undefined } }, f.context);
  const pending = f.service.runNow({ stewardId: f.input.id }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(prepare).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect((await f.stewards.list())[0]).toMatchObject({
    lastRunStatus: "failed",
    run: { error: expect.stringContaining("revoked") },
  });
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

it("keeps a real accepted run after the response waiter disappears without rebinding its grant lifetime", async () => {
  const f = await fixture();
  await f.service.save({ steward: f.input }, f.context);
  const controller = new AbortController(),
    original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    const result = await original(command);
    if ((command as { type?: string }).type === "send") controller.abort();
    return result;
  });
  const current = dto.HostStewardSchema.parse(
    await f.service.runNow({ stewardId: f.input.id }, { ...f.context, signal: controller.signal }),
  );
  expect(controller.signal.aborted).toBe(true);
  expect(current.lastRunStatus).toBe("running");
  expect(current.run?.runId).toBeTruthy();
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), {
    timeout: 5000,
  });
  expect(f.provider.cancel).not.toHaveBeenCalled();
  expect(f.provider.stop).not.toHaveBeenCalled();
});

it("retains only confirmed workspace/activity for system compensation after before-send revocation", async () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let workspace: Record<string, unknown>;
  const start = vi.fn(async (request) => {
    f.context.authorized.mockResolvedValue(false);
    return { id: "owned-activity", ...request };
  });
  const stop = vi.fn(async () => {}),
    close = vi.fn(async () => ({ ...workspace, revision: 2 })),
    apply = vi.fn(async () => {});
  const workspaces = {
    environmentId: "fixture",
    registry: {
      prepare: vi.fn(async (request) => ({
        workspace: (workspace = {
          id: "owned-workspace",
          projectId: request.projectId,
          owner: request.owner,
          directoryState: "present",
          path: f.root,
          branchRef: "steward/owned",
          revision: 1,
        }),
      })),
      get: vi.fn(async () => workspace),
      close,
    },
    activity: { start, stop },
    removal: {
      plan: vi.fn(async () => ({ blockers: [], dirty: false, token: "plan" })),
      apply,
    },
  } as unknown as StewardWorkspaceServices;
  f = await fixture(workspaces);
  await f.service.save({ steward: { ...f.input, isolate: true } }, f.context);
  await expect(f.service.runNow({ stewardId: f.input.id }, f.context)).rejects.toThrow("revoked");
  expect((await f.stewards.list())[0]).toMatchObject({
    lastRunStatus: "failed",
    run: { workspaceId: "owned-workspace", activityId: "owned-activity" },
  });
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  await f.store.db.outsideScope(() => f.stewards.tick());
  expect(stop).toHaveBeenCalledExactlyOnceWith("owned-activity");
  expect(close).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "owned-workspace" }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "owned-workspace" }), {
    kind: "retentionScheduler",
  });
  expect((await f.stewards.list())[0].run).toBeUndefined();
});

it("does not release an activity or workspace when cleanup resolves an unrelated workspace", async () => {
  const stop = vi.fn(),
    close = vi.fn(),
    apply = vi.fn();
  const workspaces = {
    environmentId: "fixture",
    registry: {
      get: vi.fn(async () => ({
        id: "foreign",
        projectId: "foreign-project",
        owner: { kind: "stewardRun", id: "foreign-owner" },
      })),
      close,
    },
    activity: { stop },
    removal: { apply },
  } as unknown as StewardWorkspaceServices;
  const f = await fixture(workspaces);
  const saved = await f.service.save({ steward: f.input }, f.context);
  await f.store.db.prepare("UPDATE stewards SET value=? WHERE id=?").run(
    JSON.stringify({
      ...saved,
      run: {
        startedAt: 1,
        workspaceId: "owned",
        activityId: "retained-activity",
        error: "Denied preparation",
      },
    }),
    saved.id,
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  await f.stewards.tick();
  expect(stop).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  expect((await f.stewards.list())[0].run?.activityId).toBe("retained-activity");
});
