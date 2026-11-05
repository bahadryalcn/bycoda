import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostCrews, type CrewSessionPorts } from "./crews";
import type { HostEngine } from "../engine";
import type { HostTasks } from "../tasks/tasks";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { defaultCrewPolicy, type CrewDefinition } from "../../src/features/crews/model/crew";

type Snapshot = Awaited<ReturnType<HostStore["session"]>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const store = new HostStore(":memory:");
  const project = await store.addProject("/crew-native-fixture", "Native Crew");
  const snapshot = (id: string, status = "idle"): Snapshot =>
    ({
      projectId: project.id,
      status,
      runId: status === "running" ? `${id}-turn` : undefined,
      session: {
        id,
        runtimeMode: "auto-accept-edits",
        harness: "codex",
        model: "codex:fixture",
        modelSettings: {},
        blocks: [],
      },
    }) as Snapshot;
  const native = snapshot("native-lead");
  const hosted = new Map<string, Snapshot>();
  vi.spyOn(store, "session").mockImplementation(async (id) => {
    const value = hosted.get(id);
    if (!value) throw new Error("Session not found on this machine");
    return structuredClone(value);
  });
  const rows: HostTask[] = [];
  const tasks = {
    ready: Promise.resolve(),
    admissionClosed: false,
    list: vi.fn(async () => rows),
    tick: vi.fn(async () => undefined),
    save: vi.fn(async (value: HostTask) => {
      rows.push({ ...value, status: "queued", updatedAt: 1 });
      return value;
    }),
    move: vi.fn(async (id: string, status: HostTask["status"]) => {
      const row = rows.find((task) => task.id === id)!;
      row.status = status;
      return row;
    }),
    cancel: vi.fn(async () => undefined),
  };
  const engine = {
    command: vi.fn(async (raw: unknown) => {
      const input = raw as Record<string, string>;
      const id = input.type === "create" ? "host-lead" : input.sessionId;
      if (input.type === "create") hosted.set(id, snapshot(id));
      if (input.type === "send") hosted.get(id)!.status = "running";
      return { commandId: input.commandId, sessionId: id, revision: 1 };
    }),
    updateSession: vi.fn(async () => undefined),
  };
  const session = vi.fn(async (id: string) => {
    const ownsScope = (store.db as unknown as { ownsScope: boolean | (() => boolean) }).ownsScope;
    if (typeof ownsScope === "function" ? ownsScope.call(store.db) : ownsScope)
      throw new Error("Native metadata read held Host SQL ownership");
    const value = id === native.session.id ? native : await store.session(id);
    const { blocks: _blocks, ...metadata } = value.session;
    return { ...structuredClone(value), session: metadata };
  });
  const command = vi.fn(
    async (raw: unknown, context: Parameters<CrewSessionPorts["command"]>[1]) => {
      if (!(await context.authorized())) throw new Error("Crew command authority revoked");
      const input = raw as Record<string, string>;
      if (input.sessionId !== native.session.id) return engine.command(raw);
      if (input.type === "cancel") native.status = "idle";
      return { commandId: input.commandId, sessionId: native.session.id, revision: 1 };
    },
  );
  let now = 1000;
  const models = vi.fn(async () => ({
    models: { codex: [{ id: "codex:fixture", harness: "codex" as const, name: "Fixture" }] },
    errors: {},
  }));
  const crews = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    models,
    () => now++,
    undefined,
    { session, command },
  );
  cleanups.push(async () => {
    await crews.close();
    await store.close();
  });
  const agent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
    id,
    role,
    name: id,
    instructions: "",
    selection: "fixed" as const,
    candidates: [
      {
        id,
        harness: "codex" as const,
        model: "codex:fixture",
        modelSettings: {},
        capabilities: {},
      },
    ],
  });
  const definition: CrewDefinition = {
    id: "native-crew",
    projectId: project.id,
    name: "Native Crew",
    updatedAt: 0,
    policy: { ...defaultCrewPolicy },
    agents: [
      agent("lead", "coordinator"),
      agent("worker", "specialist"),
      agent("reviewer", "reviewer"),
    ],
  };
  const saved = await crews.save(definition);
  const principal = { sessionId: native.session.id, projectId: project.id };
  const call = (action: string, input: Record<string, unknown> = {}) =>
    crews.call(action, input, project.id, principal);
  const start = (newConversation = false) =>
    call("crews.start", {
      definitionId: saved.id,
      prompt: "Build native feature",
      requestId: "native-run",
      newConversation,
    });
  const assign = () =>
    call("crews.assign", {
      runId: "native-run",
      requestId: "native-assignment",
      memberId: "worker",
      title: "Native feature",
      prompt: "Implement native feature",
      files: ["src/native.ts"],
    });
  return {
    store,
    project,
    native,
    hosted,
    crews,
    engine,
    session,
    command,
    models,
    tasks,
    rows,
    saved,
    call,
    start,
    assign,
  };
}

it("attaches a desktop-only coding coordinator and inherits its runtime mode for assignments", async () => {
  const f = await fixture();
  await expect(f.store.session(f.native.session.id)).rejects.toThrow(
    "Session not found on this machine",
  );
  expect(await f.start()).toMatchObject({ coordinatorSessionId: "native-lead", status: "active" });
  await f.assign();
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]).toMatchObject({
    runtimeMode: "auto-accept-edits",
    crewRunId: "native-run",
    status: "queued",
  });
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("starts a separate Host coordinator for a desktop-only caller without requiring a Host caller row", async () => {
  const f = await fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = (await f.start(true)) as { error?: string };
    expect(result).toMatchObject({
      coordinatorSessionId: "host-lead",
      requestedBySessionId: "native-lead",
      status: "active",
    });
    expect(result.error).toBeUndefined();
  }
  const creates = f.engine.command.mock.calls
    .map(([raw]) => raw as Record<string, unknown>)
    .filter((input) => input.type === "create");
  expect(creates).toHaveLength(1);
  expect(creates[0]).toMatchObject({ runtimeMode: "auto-accept-edits" });
  await expect(f.store.session("native-lead")).rejects.toThrow("Session not found on this machine");
});

it("reports live native coordinator status and supports resume and Stop work", async () => {
  const f = await fixture();
  await f.start();
  f.native.status = "running";
  f.native.runId = "native-turn";
  expect((await f.crews.list(f.project.id)).runs[0]).toMatchObject({
    coordinatorStatus: "running",
  });
  await f.call("crews.stop", { runId: "native-run" });
  expect(f.command).toHaveBeenCalledWith(
    expect.objectContaining({ type: "cancel", sessionId: "native-lead", runId: "native-turn" }),
    expect.objectContaining({ principalId: "crew:native-run", authorized: expect.any(Function) }),
  );
  expect(f.engine.command).not.toHaveBeenCalled();
  expect(await f.call("crews.resume", { runId: "native-run" })).toMatchObject({ status: "active" });
  await f.crews.tick();
  expect(f.command).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "send",
      sessionId: "native-lead",
      text: expect.stringContaining("Resume crew work"),
    }),
    expect.objectContaining({ principalId: "crew:native-run", authorized: expect.any(Function) }),
  );
});

it("retries uncertain native notification delivery with its persisted command identity", async () => {
  const f = await fixture();
  await f.start();
  await f.call("crews.request", { runId: "native-run", requestId: "help", text: "Need review" });
  f.command.mockRejectedValueOnce(new Error("Delivery outcome unknown"));
  await expect(f.crews.tick()).rejects.toThrow("Delivery outcome unknown");
  await f.crews.tick();
  const sends = f.command.mock.calls
    .map(([raw]) => raw as Record<string, unknown>)
    .filter((input) => input.type === "send");
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(sends[0]).toMatchObject({
    sessionId: "native-lead",
    text: expect.stringContaining("Need review"),
  });
  await f.crews.tick();
  expect(f.command).toHaveBeenCalledTimes(2);
});

it("rejects foreign native session scope before creating Crew work", async () => {
  const f = await fixture();
  f.native.projectId = "foreign-project";
  await expect(f.start()).rejects.toThrow(/Foreign coordinator|project/i);
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(0);
  expect(f.command).not.toHaveBeenCalled();
});

it("keeps native operations behind the current authorization grant", async () => {
  const f = await fixture();
  await expect(
    f.crews.withAuthorization(
      async () => false,
      () => f.start(),
    ),
  ).rejects.toThrow();
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(0);
  await f.start();
  f.native.status = "running";
  f.native.runId = "native-turn";
  await expect(
    f.crews.withAuthorization(
      async () => false,
      () => f.call("crews.stop", { runId: "native-run" }),
    ),
  ).rejects.toThrow();
  expect(f.command).not.toHaveBeenCalled();
  expect((await f.crews.list(f.project.id)).runs[0]).toMatchObject({ status: "active" });
});

it("refuses a native start when its authority is revoked during metadata preparation", async () => {
  const f = await fixture();
  let authorized = true;
  const resolve = f.session.getMockImplementation()!;
  f.session.mockImplementation(async (id) => {
    const value = await resolve(id);
    authorized = false;
    return value;
  });
  await expect(
    f.crews.withAuthorization(
      async () => authorized,
      () => f.start(),
    ),
  ).rejects.toThrow();
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(0);
  expect(f.command).not.toHaveBeenCalled();
});

it.each(["pause", "coordinator change", "finish"])(
  "rejects delayed notification authority after %s",
  async (change) => {
    const f = await fixture();
    await f.start();
    await f.call("crews.request", {
      runId: "native-run",
      requestId: "pending-help",
      text: "Review native work",
    });
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = f.command.getMockImplementation()!;
    const effects = vi.fn();
    f.command.mockImplementation(async (raw, context) => {
      entered();
      await delayed;
      const value = await execute(raw, context);
      effects();
      return value;
    });
    const pending = f.crews.tick();
    const rejected = expect(pending).rejects.toThrow("Crew command authority revoked");
    await waiting;
    if (change === "pause") await f.call("crews.pause", { runId: "native-run" });
    else if (change === "finish") {
      await f.call("crews.resolve", { runId: "native-run", requestId: "pending-help" });
      await f.call("crews.finish", { runId: "native-run" });
    } else
      await f.store.db
        .prepare(
          "UPDATE metadata SET value=json_set(value,'$.runs[0].coordinatorSessionId',?) WHERE key='crews.v1'",
        )
        .run("replacement-coordinator");
    release();
    await rejected;
    expect(effects).not.toHaveBeenCalled();
    expect(f.engine.command).not.toHaveBeenCalled();
  },
);

it("validates task Crew definitions inside SQL admission without reading native coordinator metadata", async () => {
  const f = await fixture();
  await f.start();
  f.session.mockClear();
  const runner = (f.tasks as unknown as HostTasks).crewRunner!;
  await f.store.db.scope(() =>
    runner.validate({
      projectId: f.project.id,
      crewDefinitionId: f.saved.id,
    } as Parameters<typeof runner.validate>[0]),
  );
  expect(f.session).not.toHaveBeenCalled();
});

it("refuses changed coordinator runtime mode after model discovery before reserving native work", async () => {
  const f = await fixture();
  const discover = f.models.getMockImplementation()!;
  f.models.mockImplementation(async () => {
    const value = await discover();
    f.native.session.runtimeMode = "full-access";
    return value;
  });
  await expect(f.start()).rejects.toThrow("Coordinator changed during model discovery");
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(0);
  expect(f.command).not.toHaveBeenCalled();
  expect(f.engine.command).not.toHaveBeenCalled();
});
