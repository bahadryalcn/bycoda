import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import { ConversationThreadCrewTools } from "../conversation/conversation-thread-crew-tools";
import type { ManagementReceipt } from "../conversation/conversation-management-tools";
import { createHostCrewsService } from "../domains/crews/service";
import { HostDomainAuthorizationError } from "../domains/context";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { CrewDefinition } from "../../src/features/crews/model/crew";
import { defaultCrewPolicy } from "../../src/features/crews/model/crew";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const parent = resolve("temp/test-results/crew-authority");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "owned-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(join(directory, "project"), "Crew authority");
  const sessions = new Map<string, Awaited<ReturnType<HostStore["session"]>>>();
  const session = (id: string, status = "idle") =>
    ({
      projectId: project.id,
      status,
      runId: status === "running" ? `${id}-turn` : undefined,
      session: {
        id,
        runtimeMode: "supervised",
        harness: "codex",
        model: "codex:fixture",
        blocks: [],
      },
    }) as Awaited<ReturnType<HostStore["session"]>>;
  sessions.set("lead-session", session("lead-session"));
  vi.spyOn(store, "session").mockImplementation(async (id) => {
    const value = sessions.get(id);
    if (!value) throw new Error("Session not found on this machine");
    return structuredClone(value);
  });
  const rows: HostTask[] = [];
  const tasks = {
    ready: Promise.resolve(),
    admissionClosed: false,
    list: vi.fn(async () => rows),
    tick: vi.fn(async () => {
      await store.db.checkAuthorization();
    }),
    save: vi.fn(async (value) => {
      rows.push(value);
      return value;
    }),
    move: vi.fn(async (id: string, status: HostTask["status"]) => {
      const task = rows.find((row) => row.id === id)!;
      task.status = status;
      return task;
    }),
    cancel: vi.fn(async () => undefined),
    acceptCrewTask: vi.fn(),
  };
  const engine = {
    command: vi.fn(async (raw: unknown) => {
      const command = raw as Record<string, any>;
      const id = command.type === "create" ? "created-session" : command.sessionId;
      if (command.type === "create") sessions.set(id, session(id));
      if (command.type === "send") sessions.set(id, session(id, "running"));
      return { commandId: command.commandId, sessionId: id, revision: 1 };
    }),
    updateSession: vi.fn(async () => undefined),
  };
  const models = vi.fn(async () => ({
    models: { codex: [{ id: "codex:fixture", harness: "codex" as const, name: "Fixture" }] },
    errors: {},
  }));
  const probe = vi.fn(async (_candidate, _capability, authorize: () => Promise<void>) => {
    await authorize();
    return true;
  });
  let now = 1000;
  const crews = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    models,
    () => now++,
    probe,
  );
  cleanups.push(async () => {
    await crews.close();
    await store.close();
    if (!directory.startsWith(`${parent}\\`) && !directory.startsWith(`${parent}/`))
      throw new Error("Unexpected Crew fixture directory");
    await rm(directory, { recursive: true, force: true });
  });
  const agent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
    id,
    name: id,
    role,
    instructions: `${role} instructions`,
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
    id: "crew",
    name: "Crew",
    projectId: project.id,
    updatedAt: 0,
    policy: { ...defaultCrewPolicy },
    agents: [
      agent("lead", "coordinator"),
      agent("worker", "specialist"),
      agent("reviewer", "reviewer"),
    ],
  };
  const saved = await crews.save(definition);
  const principal = { projectId: project.id, sessionId: "lead-session" };
  let authorized = true;
  const guard = vi.fn(async () => authorized);
  const authorizedCall = (action: string, input: Record<string, unknown>) =>
    crews.withAuthorization(guard, () => crews.call(action, input, project.id));
  const start = () =>
    crews.startRun(project.id, saved.id, "Build it", "run", "supervised", principal);
  return {
    store,
    crews,
    project,
    saved,
    principal,
    start,
    session,
    sessions,
    rows,
    tasks,
    engine,
    models,
    probe,
    guard,
    authorizedCall,
    revoke: () => {
      authorized = false;
    },
  };
}

async function threadFixture() {
  const f = await fixture();
  const receipts = new Map<string, ManagementReceipt>();
  const approve = vi.fn(async (operation: { operationHash: string }) => ({
    approved: true,
    operationHash: operation.operationHash,
  }));
  const facade = () =>
    new ConversationThreadCrewTools(
      f.crews,
      {
        approve,
        receipt: async (key) => receipts.get(key),
        saveReceipt: async (key, value) => {
          receipts.set(key, value);
        },
      },
      async () => ({
        rows: [
          {
            id: "row-1",
            harness: "codex" as const,
            model: "codex:fixture",
            modelSettings: {},
            runtimeMode: "supervised" as const,
            maxRunMinutes: 30,
            roles: ["worker" as const],
            unknownLimit: "use" as const,
          },
        ],
      }),
    );
  const tools = facade();
  const principal = {
    kind: "assistant-thread" as const,
    threadId: "global-room-thread",
    projectId: f.project.id,
    provider: "assistant" as const,
  };
  const read = () => tools.call("crews.list", {}, principal, f.guard);
  const change = async (
    action: string,
    input: Record<string, unknown>,
    operationId = "operation",
  ) => {
    const view = (await read()) as { expectedRevision: string };
    return tools.call(
      action,
      { ...input, operationId, expectedRevision: view.expectedRevision },
      principal,
      f.guard,
    );
  };
  return { ...f, receipts, approve, tools, facade, threadPrincipal: principal, read, change };
}

it("starts a real supervised coordinator from a reviewed Room thread and reconciles restart without replay", async () => {
  const f = await threadFixture();
  const view = (await f.read()) as {
    expectedRevision: string;
    value: { definitions: { items: CrewDefinition[] } };
  };
  expect(view.value.definitions.items[0].agents[0].instructions).toBe("");
  expect(f.engine.command).not.toHaveBeenCalled();
  const input = {
    definitionId: f.saved.id,
    prompt: "Build it",
    requestId: "room-run",
    operationId: "start-operation",
    expectedRevision: view.expectedRevision,
  };
  const result = await f.tools.call("crews.start", input, f.threadPrincipal, f.guard);
  expect(result).toMatchObject({
    state: "completed",
    result: { coordinatorSessionId: "created-session" },
  });
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
    "send",
  ]);
  expect(f.engine.command.mock.calls[0][0]).toMatchObject({ runtimeMode: "supervised" });
  expect(await f.facade().call("crews.start", input, f.threadPrincipal, f.guard)).toMatchObject({
    state: "completed",
  });
  expect(f.engine.command).toHaveBeenCalledTimes(2);
  await expect(
    f.tools.call("crews.start", { ...input, prompt: "Different" }, f.threadPrincipal, f.guard),
  ).rejects.toThrow("reused");
});

it("rejects a Crew edit made while native review is open before creating a coordinator", async () => {
  const f = await threadFixture();
  f.approve.mockImplementation(async (operation) => {
    await f.crews.save({ ...f.saved, name: "Changed" }, f.saved.updatedAt);
    return { approved: true, operationHash: operation.operationHash };
  });
  expect(
    await f.change("crews.start", {
      definitionId: f.saved.id,
      prompt: "Build it",
      requestId: "room-run",
    }),
  ).toMatchObject({ state: "uncertain", error: expect.stringContaining("changed after review") });
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("rechecks Crew revision after model discovery before reserving a run", async () => {
  const f = await threadFixture();
  const discover = f.models.getMockImplementation()!;
  f.models.mockImplementationOnce(async () => {
    await f.crews.save({ ...f.saved, name: "Changed during discovery" }, f.saved.updatedAt);
    return discover();
  });
  expect(
    await f.change("crews.start", {
      definitionId: f.saved.id,
      prompt: "Build it",
      requestId: "room-run",
    }),
  ).toMatchObject({ state: "uncertain" });
  expect(f.engine.command).not.toHaveBeenCalled();
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(0);
});

it("never launches after Room authority is revoked in native review", async () => {
  const f = await threadFixture();
  f.approve.mockImplementation(async (operation) => {
    f.revoke();
    return { approved: true, operationHash: operation.operationHash };
  });
  expect(
    await f.change("crews.start", {
      definitionId: f.saved.id,
      prompt: "Build it",
      requestId: "room-run",
    }),
  ).toMatchObject({ state: "failed" });
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("retains an accepted coordinator identity after a concurrent owner pause without replay", async () => {
  const f = await threadFixture();
  const entered = deferred(),
    release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementation(async (input) => {
    const receipt = await command(input);
    if ((input as { type: string }).type === "send") {
      entered.resolve();
      await release.promise;
    }
    return receipt;
  });
  const pending = f.change("crews.start", {
    definitionId: f.saved.id,
    prompt: "Build it",
    requestId: "room-run",
  });
  await entered.promise;
  await f.crews.call("crews.pause", { runId: "room-run" }, f.project.id);
  await f.crews.save({ ...f.saved, name: "New owner definition" }, f.saved.updatedAt);
  release.resolve();
  await pending;
  const view = await f.crews.list(f.project.id);
  expect(view.definitions[0].name).toBe("New owner definition");
  expect(view.runs[0]).toMatchObject({
    id: "room-run",
    coordinatorSessionId: "created-session",
    status: "paused",
  });
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
    "send",
  ]);
});

it("keeps approval escalation and foreign Crew edits outside reviewed thread management", async () => {
  const f = await threadFixture();
  expect(
    await f.change("crews.save", {
      definitionJson: JSON.stringify({ ...f.saved, projectId: "foreign" }),
      expectedUpdatedAt: f.saved.updatedAt,
    }),
  ).toMatchObject({ state: "uncertain", error: expect.stringContaining("target project") });
  expect(
    await f.change(
      "crews.save",
      {
        definitionJson: JSON.stringify({
          ...f.saved,
          policy: { ...f.saved.policy, delegateApprovals: true },
        }),
        expectedUpdatedAt: f.saved.updatedAt,
      },
      "second-operation",
    ),
  ).toMatchObject({ state: "uncertain", error: expect.stringContaining("Delegated approval") });
  await expect(f.change("crews.respond", { runId: "run" }, "third-operation")).rejects.toThrow(
    "owner workflow",
  );
  expect((await f.crews.list(f.project.id)).definitions[0]).toEqual(f.saved);
});

it("does not confuse a crew directive request ID with operation receipt identity", async () => {
  const f = await threadFixture();
  await f.change(
    "crews.start",
    { definitionId: f.saved.id, prompt: "Build it", requestId: "room-run" },
    "start-operation",
  );
  expect(
    await f.change(
      "crews.request",
      { runId: "room-run", requestId: "directive", text: "Check delivery" },
      "request-operation",
    ),
  ).toMatchObject({ state: "completed" });
  expect(
    await f.change(
      "crews.resolve",
      { runId: "room-run", requestId: "directive" },
      "resolve-operation",
    ),
  ).toMatchObject({ state: "completed" });
  expect(f.receipts.size).toBe(3);
});

it("rejects an already queued metadata request when its grant is revoked", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const blocking = f.store.db.scope(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const pending = f.authorizedCall("crews.agent.save", {
    agent: { ...f.saved.agents[1], projectId: f.project.id },
  });
  const denied = expect(pending).rejects.toThrow("revoked");
  await vi.waitFor(() => expect(f.guard.mock.calls.length).toBeGreaterThanOrEqual(2));
  f.revoke();
  release.resolve();
  await blocking;
  await denied;
  expect((await f.crews.list(f.project.id)).agents).toEqual([]);
  expect(f.engine.command).not.toHaveBeenCalled();
});

it.each(["crews.list", "crews.start"])(
  "rechecks %s after model discovery before durable work",
  async (action) => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    const catalog = await f.models();
    f.models.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return catalog;
    });
    const pending = f.authorizedCall(
      action,
      action === "crews.start"
        ? { definitionId: f.saved.id, prompt: "Start", requestId: "request" }
        : {},
    );
    const denied = expect(pending).rejects.toThrow("revoked");
    await entered.promise;
    f.revoke();
    release.resolve();
    await denied;
    const view = await f.crews.list(f.project.id);
    expect(view.definitions).toEqual([f.saved]);
    expect(view.agents).toEqual([]);
    expect(view.runs).toEqual([]);
    expect(f.engine.command).not.toHaveBeenCalled();
  },
);

it("carries request authority into a deferred probe without granting image generation", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const nativeEffect = vi.fn();
  f.probe.mockImplementationOnce(async (_candidate, _capability, authorize) => {
    entered.resolve();
    await release.promise;
    await authorize();
    nativeEffect();
    return true;
  });
  const pending = f.authorizedCall("crews.inspect", { definitionId: f.saved.id, memberId: "lead" });
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.revoke();
  release.resolve();
  await denied;
  expect(nativeEffect).not.toHaveBeenCalled();
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("retains a confirmed created session but denies update/send after revocation", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementationOnce(async (input) => {
    entered.resolve();
    await release.promise;
    return command(input);
  });
  const pending = f.authorizedCall("crews.start", {
    definitionId: f.saved.id,
    prompt: "Start",
    requestId: "launch",
  });
  await entered.promise;
  f.revoke();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    status: "paused",
    error: "Request authorization was revoked.",
  });
  const [run] = (await f.crews.list(f.project.id)).runs;
  expect(run).toMatchObject({
    id: "launch",
    coordinatorSessionId: "created-session",
    status: "paused",
  });
  expect(f.engine.updateSession).not.toHaveBeenCalled();
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
  ]);
});

it("retains the accepted send independently of a revoked waiter and concurrent definition edits", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementation(async (input) => {
    const receipt = await command(input);
    if ((input as { type: string }).type === "send") {
      entered.resolve();
      await release.promise;
    }
    return receipt;
  });
  const pending = f.authorizedCall("crews.start", {
    definitionId: f.saved.id,
    prompt: "Start",
    requestId: "launch",
  });
  await entered.promise;
  const edited = await f.crews.save({ ...f.saved, name: "New configuration" }, f.saved.updatedAt);
  f.revoke();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    status: "active",
    coordinatorSessionId: "created-session",
    error: undefined,
  });
  const view = await f.crews.list(f.project.id);
  expect(view.definitions).toEqual([edited]);
  expect(view.runs[0].definition.name).toBe("Crew");
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
    "send",
  ]);
});

it("requires a live grant again after session preparation and never assumes a send receipt", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  f.engine.updateSession.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
  });
  const pending = f.authorizedCall("crews.start", {
    definitionId: f.saved.id,
    prompt: "Start",
    requestId: "launch",
  });
  await entered.promise;
  f.revoke();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    status: "paused",
    error: "Request authorization was revoked.",
  });
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
  ]);
  expect((await f.crews.list(f.project.id)).runs[0]).toMatchObject({
    coordinatorSessionId: "created-session",
    status: "paused",
  });
});

it("keeps a concurrent Stop paused when an accepted send settles after caller revocation", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementation(async (input) => {
    const receipt = await command(input);
    if ((input as { type: string }).type === "send") {
      entered.resolve();
      await release.promise;
    }
    return receipt;
  });
  const pending = f.authorizedCall("crews.start", {
    definitionId: f.saved.id,
    prompt: "Start",
    requestId: "launch",
  });
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  await f.crews.call("crews.stop", { runId: "launch" }, f.project.id);
  f.revoke();
  release.resolve();
  await denied;
  expect((await f.crews.list(f.project.id)).runs[0]).toMatchObject({
    status: "paused",
    coordinatorSessionId: "created-session",
  });
  expect(
    f.engine.command.mock.calls.filter(([input]) => (input as { type: string }).type === "cancel"),
  ).toHaveLength(1);
});

it("schedules committed assignment children outside their creator's request grant", async () => {
  const f = await fixture();
  await f.start();
  const ticked = deferred();
  const release = deferred();
  f.tasks.tick.mockImplementationOnce(async () => {
    await release.promise;
    await f.store.db.checkAuthorization();
    ticked.resolve();
  });
  await f.authorizedCall("crews.assign", {
    runId: "run",
    requestId: "assignment",
    memberId: "worker",
    title: "Work",
    prompt: "Implement",
  });
  f.revoke();
  release.resolve();
  await ticked.promise;
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]).toMatchObject({ crewRunId: "run", status: "queued" });
});

it("tries every child and the coordinator, then reports partial Stop failure", async () => {
  const f = await fixture();
  await f.start();
  for (const [id, status] of [
    ["first", "queued"],
    ["second", "running"],
    ["third", "verifying"],
  ] as const)
    f.rows.push({ id, status, crewRunId: "run", projectId: f.project.id } as HostTask);
  f.tasks.move.mockRejectedValueOnce(new Error("First cancellation failed"));
  f.sessions.set("lead-session", f.session("lead-session", "running"));
  await expect(f.authorizedCall("crews.stop", { runId: "run" })).rejects.toThrow(
    "some conversations could not be stopped",
  );
  expect(f.tasks.move.mock.calls.map(([id]) => id)).toEqual(["first", "second", "third"]);
  expect(f.engine.command).toHaveBeenCalledWith(
    expect.objectContaining({ type: "cancel", sessionId: "lead-session" }),
  );
  expect((await f.crews.list(f.project.id)).runs[0].status).toBe("paused");
});

it("does not bypass a grant revoked during the first child cancellation or claim full Stop success", async () => {
  const f = await fixture();
  await f.start();
  for (const id of ["first", "second", "third"])
    f.rows.push({ id, status: "running", crewRunId: "run", projectId: f.project.id } as HostTask);
  f.sessions.set("lead-session", f.session("lead-session", "running"));
  f.tasks.move.mockImplementationOnce(async (id, status) => {
    f.revoke();
    return { id, status } as HostTask;
  });
  await expect(f.authorizedCall("crews.stop", { runId: "run" })).rejects.toThrow(
    "some conversations could not be stopped",
  );
  expect(f.tasks.move).toHaveBeenCalledExactlyOnceWith("first", "blocked");
  expect(f.engine.command).not.toHaveBeenCalled();
  expect((await f.crews.list(f.project.id)).runs[0].status).toBe("paused");
});

it("denies the actual definition deletion after awaited task checks and emits no callback", async () => {
  const f = await fixture();
  const entered = deferred();
  const release = deferred();
  f.tasks.list.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return [];
  });
  const deleted = (f.crews.onDefinitionDeleted = vi.fn());
  const pending = f.authorizedCall("crews.delete", {
    definitionId: f.saved.id,
    expectedUpdatedAt: f.saved.updatedAt,
  });
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  f.revoke();
  release.resolve();
  await denied;
  expect(deleted).not.toHaveBeenCalled();
  expect((await f.crews.list(f.project.id)).definitions).toEqual([f.saved]);
});

it("keeps a paused run's definition snapshot and conversations after saved-definition deletion", async () => {
  const f = await fixture();
  await f.start();
  await f.crews.call("crews.pause", { runId: "run" }, f.project.id);
  await f.authorizedCall("crews.delete", {
    definitionId: f.saved.id,
    expectedUpdatedAt: f.saved.updatedAt,
  });
  const view = await f.crews.list(f.project.id);
  expect(view.definitions).toEqual([]);
  expect(view.runs[0]).toMatchObject({
    status: "paused",
    definition: { id: f.saved.id, name: f.saved.name },
  });
  expect(f.sessions.has("lead-session")).toBe(true);
});

it.each(["definition-global", "definition-project", "agent-global", "agent-project", "run"])(
  "publishes only the committed actual %s removal and preserves rollback/absence",
  async (kind) => {
    const f = await fixture();
    const onDefinition = (f.crews.onDefinitionDeleted = vi.fn());
    const onAgent = (f.crews.onAgentDeleted = vi.fn());
    const onRun = (f.crews.onRunDeleted = vi.fn());
    const scoped = kind.endsWith("project");
    let action: string;
    let input: Record<string, unknown>;
    let callback: ReturnType<typeof vi.fn>;
    let change: Record<string, unknown>;
    if (kind.startsWith("definition")) {
      const saved = scoped
        ? f.saved
        : await f.crews.save({ ...f.saved, id: "global", projectId: undefined });
      action = "crews.delete";
      input = { definitionId: saved.id, expectedUpdatedAt: saved.updatedAt };
      callback = onDefinition;
      change = { definitionId: saved.id, ...(scoped ? { projectId: f.project.id } : {}) };
    } else if (kind.startsWith("agent")) {
      const saved = (await f.crews.call(
        "crews.agent.save",
        { agent: { ...f.saved.agents[1], ...(scoped ? { projectId: f.project.id } : {}) } },
        f.project.id,
      )) as { id: string };
      action = "crews.agent.delete";
      input = { agentId: saved.id };
      callback = onAgent;
      change = { agentId: saved.id, ...(scoped ? { projectId: f.project.id } : {}) };
    } else {
      await f.start();
      await f.crews.call("crews.pause", { runId: "run" }, f.project.id);
      const run = (await f.crews.list(f.project.id)).runs[0];
      action = "crews.deleteRun";
      input = { runId: run.id, expectedUpdatedAt: run.updatedAt };
      callback = onRun;
      change = { runId: run.id, projectId: f.project.id };
    }
    await expect(
      f.store.transaction(async () => {
        await f.authorizedCall(action, input);
        expect(callback).not.toHaveBeenCalled();
        throw new Error("Force rollback");
      }),
    ).rejects.toThrow("Force rollback");
    expect(callback).not.toHaveBeenCalled();
    await expect(f.authorizedCall(action, input)).resolves.toEqual({ deleted: true });
    expect(callback).toHaveBeenCalledExactlyOnceWith(change);
    await expect(f.authorizedCall(action, input)).rejects.toThrow();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(
      [onDefinition, onAgent, onRun].reduce((count, fn) => count + fn.mock.calls.length, 0),
    ).toBe(1);
  },
);

it("rechecks a run's required revision after awaited conversation checks without cascading deletion", async () => {
  const f = await fixture();
  await f.start();
  await f.crews.call("crews.pause", { runId: "run" }, f.project.id);
  const run = (await f.crews.list(f.project.id)).runs[0];
  const entered = deferred();
  const release = deferred();
  const lookup = vi.mocked(f.store.session).getMockImplementation()!;
  vi.mocked(f.store.session).mockImplementationOnce(async (id) => {
    entered.resolve();
    await release.promise;
    return lookup(id);
  });
  const deleted = (f.crews.onRunDeleted = vi.fn());
  const pending = f.authorizedCall("crews.deleteRun", {
    runId: "run",
    expectedUpdatedAt: run.updatedAt,
  });
  const denied = expect(pending).rejects.toThrow("changed");
  await entered.promise;
  await f.crews.call("crews.pause", { runId: "run" }, f.project.id);
  release.resolve();
  await denied;
  expect(deleted).not.toHaveBeenCalled();
  expect((await f.crews.list(f.project.id)).runs).toHaveLength(1);
  expect(f.sessions.has("lead-session")).toBe(true);
  expect(f.engine.command).not.toHaveBeenCalled();
});

it("does not accept principal authority from the request payload", async () => {
  const f = await fixture();
  await f.start();
  await expect(
    f.crews.call(
      "crews.delete",
      { definitionId: f.saved.id, principal: undefined },
      f.project.id,
      f.principal,
    ),
  ).rejects.toThrow("Only the owner");
  await expect(
    f.crews.call("crews.pause", { runId: "run", principal: f.principal }, f.project.id, {
      projectId: f.project.id,
      sessionId: "foreign",
    }),
  ).rejects.toThrow("not a member");
  expect((await f.crews.list(f.project.id)).runs[0].status).toBe("active");
});

it("retains a confirmed create through the paired service after caller revocation", async () => {
  const f = await fixture();
  const service = createHostCrewsService({ crews: f.crews });
  const entered = deferred();
  const release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementationOnce(async (input) => {
    entered.resolve();
    await release.promise;
    return command(input);
  });
  const pending = service.call(
    "crews.start",
    {
      projectId: f.project.id,
      definitionId: f.saved.id,
      prompt: "Start",
      requestId: "paired-create",
    },
    { authorized: f.guard },
  );
  const denied = expect(pending).rejects.toBeInstanceOf(HostDomainAuthorizationError);
  await entered.promise;
  f.revoke();
  release.resolve();
  await denied;

  const [run] = (await f.crews.list(f.project.id)).runs;
  expect(run).toMatchObject({
    id: "paired-create",
    coordinatorSessionId: "created-session",
    status: "paused",
    error: "Request authorization was revoked.",
  });
  expect(f.sessions.get("created-session")).toMatchObject({ status: "idle" });
  await f.crews.tick();
  expect(f.engine.updateSession).not.toHaveBeenCalled();
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
  ]);
});

it("preserves accepted turn identity and a concurrent pause through the paired service after revocation", async () => {
  const f = await fixture();
  const service = createHostCrewsService({ crews: f.crews });
  const entered = deferred();
  const release = deferred();
  const command = f.engine.command.getMockImplementation()!;
  f.engine.command.mockImplementation(async (input) => {
    const receipt = await command(input);
    if ((input as { type: string }).type === "send") {
      entered.resolve();
      await release.promise;
    }
    return receipt;
  });
  const pending = service.call(
    "crews.start",
    {
      projectId: f.project.id,
      definitionId: f.saved.id,
      prompt: "Start",
      requestId: "paired-send",
    },
    { authorized: f.guard },
  );
  const denied = expect(pending).rejects.toThrow("revoked");
  await entered.promise;
  const acceptedSession = structuredClone(f.sessions.get("created-session"));
  const edited = await f.crews.save(
    { ...f.saved, name: "Concurrent owner edit" },
    f.saved.updatedAt,
  );
  await service.call(
    "crews.pause",
    { projectId: f.project.id, runId: "paired-send" },
    { authorized: async () => true },
  );
  f.revoke();
  release.resolve();
  await denied;

  const view = await f.crews.list(f.project.id);
  expect(view.definitions).toEqual([edited]);
  expect(view.runs[0]).toMatchObject({
    id: "paired-send",
    coordinatorSessionId: "created-session",
    status: "paused",
    definition: { name: "Crew" },
  });
  expect(view.runs[0].error).toBeUndefined();
  expect(acceptedSession).toMatchObject({ status: "running", runId: "created-session-turn" });
  expect(f.sessions.get("created-session")).toEqual(acceptedSession);
  await f.crews.tick();
  expect(f.engine.command.mock.calls.map(([input]) => (input as { type: string }).type)).toEqual([
    "create",
    "send",
  ]);
  expect(
    f.engine.command.mock.calls.map(([input]) => (input as { commandId: string }).commandId),
  ).toEqual(["crew-paired-send:create", "crew-paired-send:send"]);
});

it("rejects crew candidates outside the assistant model pool before review", async () => {
  const f = await threadFixture();
  const [agent] = f.saved.agents;
  const outside = {
    ...f.saved,
    agents: [
      { ...agent, candidates: agent.candidates.map((c) => ({ ...c, model: "codex:outside" })) },
    ],
  };
  await expect(
    f.change("crews.save", {
      definitionJson: JSON.stringify(outside),
      expectedUpdatedAt: f.saved.updatedAt,
    }),
  ).rejects.toThrow("not in the assistant's model pool");
  await expect(
    f.change("crews.agent.save", { agentJson: JSON.stringify(outside.agents[0]) }),
  ).rejects.toThrow("model pool");
});
