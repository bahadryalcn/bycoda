import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostAutomations, type AutomationWorkspaceServices } from "../../automations/automations";
import * as dto from "../../../src/shared/model/host-contracts/automations";
import { createHostAutomationsService } from "./service";

const cleanups: Array<() => Promise<void>> = [];
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
  const automations = new HostAutomations(store, engine, () => clock.now, workspaces);
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
  return { root, store, engine, provider, finishes, clock, automations, context, service, input };
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

it("denies manual send after preparation, retains confirmed create identity and preserves concurrent configuration", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const result = await original(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  const pending = f.service.runNow({ automationId: f.input.id }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  const newer = await f.automations.save({ ...f.input, name: "Concurrent config" });
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  const [run] = await f.automations.runs(f.input.id);
  dto.HostAutomationRunSchema.parse(run);
  expect(run).toMatchObject({ status: "failed", trigger: "manual" });
  expect(run.sessionId).toBeTruthy();
  expect(run.runId).toBeUndefined();
  expect(await f.automations.list()).toEqual([newer]);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("checks live authority after policy preparation before any managed workspace effect", async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const prepare = vi.fn(),
    activity = vi.fn();
  const workspaces = {
    environmentId: "fixture",
    registry: { prepare },
    activity: { start: activity },
    policy: {
      resolve: async () => {
        entered.resolve();
        await release.promise;
        return { policy: { defaultMode: "worktree" } };
      },
    },
  } as unknown as AutomationWorkspaceServices;
  const f = await fixture(workspaces);
  await f.service.save({ automation: { ...f.input, isolate: undefined } }, f.context);
  const pending = f.service.runNow({ automationId: f.input.id }, f.context),
    denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  expect(prepare).not.toHaveBeenCalled();
  expect(activity).not.toHaveBeenCalled();
  expect((await f.automations.runs(f.input.id))[0]).toMatchObject({ status: "failed" });
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("keeps a confirmed send receipt running after creator revocation and settles through autonomous owner", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    const receipt = await original(command);
    if ((command as { type: string }).type === "send")
      f.context.authorized.mockResolvedValue(false);
    return receipt;
  });
  await expect(f.service.runNow({ automationId: f.input.id }, f.context)).rejects.toThrow(
    "revoked",
  );
  const [run] = await f.automations.runs(f.input.id);
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), { timeout: 5000 });
  expect(run.status).toBe("running");
  expect(run.sessionId).toBeTruthy();
  expect(run.runId).toBeTruthy();
  f.finishes[0]();
  await vi.waitFor(
    async () => expect((await f.store.session(run.sessionId!)).status).toBe("idle"),
    { timeout: 5000 },
  );
  await f.automations.tick();
  expect((await f.automations.runs(f.input.id))[0].status).toBe("succeeded");
});

it("does not assume a running admission without the original send receipt", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    if ((command as { type: string }).type === "send") throw new Error("Not admitted");
    return original(command);
  });
  const run = await f.service.runNow({ automationId: f.input.id }, f.context);
  expect(run).toMatchObject({ status: "failed", error: "Not admitted" });
  expect(run.sessionId).toBeTruthy();
  expect(run.runId).toBeUndefined();
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("runs accepted persisted schedules on the Host clock independently of the creator grant", async () => {
  const f = await fixture();
  const saved = await f.service.save({ automation: f.input }, f.context);
  f.context.authorized.mockResolvedValue(false);
  f.clock.now = saved.nextRunAt;
  await f.automations.tick();
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), { timeout: 5000 });
  const [run] = await f.automations.runs(f.input.id);
  expect(run).toMatchObject({
    status: "running",
    trigger: "scheduled",
    scheduledFor: saved.nextRunAt,
  });
  await expect(f.automations.delete(f.input.id)).rejects.toThrow("still running");
  await f.automations.tick();
  expect(f.provider.send).toHaveBeenCalledOnce();
});

it("treats waiter cancellation after admission as wait-only and never as a provider stop", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const result = await original(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  const controller = new AbortController();
  const context = { ...f.context, signal: controller.signal };
  const pending = f.service.runNow({ automationId: f.input.id }, context);
  await entered.promise;
  controller.abort();
  release.resolve();
  const run = await pending;
  expect(run.status).toBe("running");
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), { timeout: 5000 });
  expect(f.provider.cancel).not.toHaveBeenCalled();
  const count = (await f.automations.runs(f.input.id)).length;
  await expect(f.service.runNow({ automationId: f.input.id }, context)).rejects.toThrow(
    "cancelled",
  );
  expect(await f.automations.runs(f.input.id)).toHaveLength(count);
});

it("retains failed reservation cleanup across ownership mismatch and release failure, then retries only the owned metadata stop", async () => {
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let workspace: {
    id: string;
    owner: { kind: string; id: string };
    projectId: string;
    directoryState: string;
  };
  let activity: { id: string; workspaceId: string; ownerId: string; kind: string } | undefined;
  const stop = vi.fn(async (_id: string) => {
    activity = undefined;
  });
  const prepare = vi.fn(
    async (request: { owner: { kind: string; id: string }; projectId: string }) => {
      workspace = {
        id: "owned-workspace",
        owner: request.owner,
        projectId: request.projectId,
        directoryState: "present",
      };
      return { workspace };
    },
  );
  const finish = vi.fn();
  const services = {
    environmentId: "fixture",
    registry: { prepare, get: async () => workspace, finish },
    activity: {
      start: async (request: { workspaceId: string; ownerId: string; kind: string }) => {
        activity = { ...request, id: "owned-activity" };
        entered.resolve();
        await release.promise;
        return activity;
      },
      list: async () => (activity ? [activity] : []),
      stop,
    },
  } as unknown as AutomationWorkspaceServices;
  const f = await fixture(services);
  await f.service.save({ automation: { ...f.input, isolate: true } }, f.context);
  const pending = f.service.runNow({ automationId: f.input.id }, f.context);
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.context.authorized.mockResolvedValue(false);
  release.resolve();
  await denied;
  const [run] = await f.automations.runs(f.input.id);
  dto.HostAutomationRunSchema.parse(run);
  expect(run).toMatchObject({
    status: "failed",
    cleanupPending: true,
    workspaceId: "owned-workspace",
    activityId: "owned-activity",
  });
  await expect(f.automations.delete(f.input.id)).rejects.toThrow("cleanup");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    activity!.ownerId = "other-run";
    await f.automations.tick();
    expect(stop).not.toHaveBeenCalled();
    activity!.ownerId = run.id;
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
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledOnce();
  } finally {
    error.mockRestore();
  }
});

it("retains failed cleanup history when ordinary old completed history is pruned", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  await f.store.db.scope(async () => {
    for (let index = 0; index < 105; index++) {
      const run = {
        id: `old-${index}`,
        automationId: f.input.id,
        createdAt: index,
        scheduledFor: index,
        startedAt: index,
        status: "failed",
        trigger: "manual",
        ...(index === 0
          ? { cleanupPending: true, workspaceId: "retained", activityId: "retained" }
          : {}),
      };
      await f.store.db
        .prepare("INSERT INTO automation_runs VALUES (?, ?, ?, ?)")
        .run(run.id, run.automationId, run.createdAt, JSON.stringify(run));
    }
  });
  const original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    if ((command as { type: string }).type === "send") throw new Error("Not admitted");
    return original(command);
  });
  await f.service.runNow({ automationId: f.input.id }, f.context);
  const history = await f.automations.runs(f.input.id);
  expect(history.some((run) => run.id === "old-0" && run.cleanupPending)).toBe(true);
  expect(history.some((run) => run.id === "old-1")).toBe(false);
  expect(f.provider.send).not.toHaveBeenCalled();
});

it("settles a pending busy manual attempt when its grant changes after history admission", async () => {
  const f = await fixture();
  await f.service.save({ automation: f.input }, f.context);
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const result = await original(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  const first = f.service.runNow({ automationId: f.input.id }, f.context);
  await entered.promise;
  // Real authorization consults the actual admitted history. The new row is
  // permitted; the immediate busy finish sees the subsequently revoked grant.
  const secondContext = {
    authorized: async () => (await f.automations.runs(f.input.id)).length < 2,
  };
  try {
    await expect(f.service.runNow({ automationId: f.input.id }, secondContext)).rejects.toThrow(
      "revoked",
    );
    const history = await f.automations.runs(f.input.id);
    expect(history.filter((run) => run.status === "pending")).toHaveLength(1);
    expect(history.filter((run) => run.status === "failed")).toHaveLength(1);
    expect(history.find((run) => run.status === "failed")?.sessionId).toBeUndefined();
    expect(f.provider.send).not.toHaveBeenCalled();
  } finally {
    release.resolve();
  }
  expect((await first).status).toBe("running");
  await vi.waitFor(() => expect(f.provider.send).toHaveBeenCalledOnce(), { timeout: 5000 });
});
