import { forEachAsync } from "./async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { defaultCrewPolicy, type CrewDefinition } from "../src/features/crews/model/crew";
const stores: HostStore[] = [];
afterEach(async () => {
  await await forEachAsync(await stores.splice(0), async (store) => await store.close());
});
async function setup(costLimit?: number) {
  const store = new HostStore(":memory:");
  await stores.push(store);
  const project = await store.addProject("/crew-fixture", "Crew fixture");
  const session = {
    session: { runtimeMode: "supervised", harness: "codex", model: "codex:fixture", blocks: [] },
    projectId: project.id,
    status: "idle",
  };
  vi.spyOn(store, "session").mockImplementation(() => session as ReturnType<HostStore["session"]>);
  const rows: HostTask[] = [];
  const tasks = {
    list: () => rows,
    tick: vi.fn(),
    save: vi.fn((task) => {
      rows.push({ ...task, status: "queued", updatedAt: 1 });
      return task;
    }),
    acceptCrewTask: vi.fn((id) => {
      const task = rows.find((t) => t.id === id)!;
      task.status = "done";
      return task;
    }),
  };
  const engine = { command: vi.fn(() => ({ sessionId: "coordinator" })), updateSession: vi.fn() };
  const models = async () => ({
    models: {
      codex: [{ id: "codex:fixture", harness: "codex" as const, name: "Fixture" }],
      claude: [{ id: "claude:fixture", harness: "claude" as const, name: "Review fixture" }],
    },
    errors: {},
  });
  const service = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    models,
    () => 1000,
  );
  const makeAgent = (id: string, role: "coordinator" | "specialist" | "reviewer") => ({
    id,
    name: id,
    role,
    instructions: "",
    selection: "fixed" as const,
    candidates: [
      {
        id,
        harness: role === "reviewer" ? ("claude" as const) : ("codex" as const),
        model: role === "reviewer" ? "claude:fixture" : "codex:fixture",
        modelSettings: {},
        capabilities: {},
        cost: 1,
      },
    ],
  });
  const definition: CrewDefinition = {
    id: "crew",
    name: "Crew",
    projectId: project.id,
    agents: [
      makeAgent("lead", "coordinator"),
      makeAgent("worker", "specialist"),
      makeAgent("reviewer", "reviewer"),
    ],
    policy: { ...defaultCrewPolicy, maxEstimatedCost: costLimit },
    updatedAt: 0,
  };
  await service.save(definition);
  const principal = { projectId: project.id, sessionId: "lead-session" };
  const start = async () =>
    await service.startRun(project.id, "crew", "Build it", "run", "supervised", principal);
  const assign = async (id = "assignment") =>
    await service.assign(
      project.id,
      {
        runId: "run",
        requestId: id,
        memberId: "worker",
        title: "Feature",
        prompt: "Implement feature",
      },
      principal,
    );
  return {
    store,
    service,
    tasks,
    rows,
    engine,
    project,
    principal,
    start,
    assign,
    definition,
    models,
  };
}
describe("host crews", () => {
  it("keeps bounded previous conversation identities while redacting attempt prose", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    f.rows[0].attemptHistory = Array.from({ length: 25 }, (_, index) => ({
      attempt: index,
      at: index * 100,
      workerSessionId: `worker-${index}`,
      reviewerSessionId: `reviewer-${index}`,
      verdict: "pass" as const,
      workerSummary: "private worker prose",
      note: "private review prose",
      findings: ["private finding"],
      workspaceFingerprint: "private fingerprint",
    }));
    const task = (await f.service.list(f.project.id)).runs[0].tasks[0];
    expect(task.attemptHistory).toHaveLength(20);
    expect(task.attemptHistory?.at(-1)).toMatchObject({
      attempt: 24, at: 2400, workerSessionId: "worker-24", reviewerSessionId: "reviewer-24",
      verdict: "pass", workerSummary: "", note: "", findings: [],
    });
    expect(JSON.stringify(task)).not.toContain("private");
    expect(f.rows[0].attemptHistory[24].workerSummary).toBe("private worker prose");
  });
  it("replays an assignment after pause without creating duplicate work", async () => {
    const f = await setup();
    await f.start();
    const assignment = await f.assign();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    expect(await f.assign()).toEqual(assignment);
    expect(f.rows).toHaveLength(1);
    await expect(f.assign("another")).rejects.toThrow("not active");
  });
  it("rejects actions authenticated for a different project", async () => {
    const f = await setup();
    await f.start();
    await expect(f.service.call("crews.stop", { runId: "run" }, f.project.id,
      { ...f.principal, projectId: "foreign" })).rejects.toThrow("another project");
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("keeps finished work immutable to new requests while replaying an existing request", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.request", { runId: "run", requestId: "existing", text: "Question" }, f.project.id);
    await f.service.call("crews.resolve", { runId: "run", requestId: "existing" }, f.project.id);
    await f.service.call("crews.finish", { runId: "run" }, f.project.id);
    await expect(f.service.call("crews.request", { runId: "run", requestId: "late", text: "New question" }, f.project.id))
      .rejects.toThrow("finished");
    expect(await f.service.call("crews.request", { runId: "run", requestId: "existing", text: "Question" }, f.project.id))
      .toMatchObject({ id: "existing" });
  });
  it("preserves concurrent requests and treats a repeated request ID as one request", async () => {
    const f = await setup();
    await f.start();
    await Promise.all(Array.from({ length: 8 }, (_, index) => f.service.call(
      "crews.request", { runId: "run", requestId: `request-${index}`, text: `Question ${index}` },
      f.project.id, f.principal,
    )));
    await Promise.all([0, 1].map(() => f.service.call(
      "crews.request", { runId: "run", requestId: "same", text: "Question" },
      f.project.id, f.principal,
    )));
    expect((await f.service.list(f.project.id)).runs[0].messages).toHaveLength(9);
  });
  it("does not turn a transient coordinator read failure into a missing-session pause", async () => {
    const f = await setup();
    await f.start();
    vi.mocked(f.store.session).mockRejectedValueOnce(new Error("Database temporarily unavailable"));
    await expect(f.service.tick()).rejects.toThrow("Database temporarily unavailable");
    const run = (await f.service.list(f.project.id)).runs[0];
    expect(run.status).toBe("active");
    expect(run.error).toBeUndefined();
  });
  it.each(["idle", "interrupted"] as const)("resumes %s planning with one durable continuation without repeating it", async (status) => {
    const f = await setup();
    await f.start();
    const coordinator = await f.store.session("lead-session");
    vi.mocked(f.store.session).mockResolvedValue({ ...coordinator, status });
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    f.engine.command.mockClear();
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledWith(expect.objectContaining({
      type: "send", sessionId: "lead-session", text: expect.stringContaining("Resume crew work"),
    }));
    expect(f.engine.command).toHaveBeenCalledTimes(1);
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(1);
  });
  it("resumes an uncertain pending delivery with its original receipt identity", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.request", { runId: "run", requestId: "first", text: "Need help" }, f.project.id);
    f.engine.command.mockImplementationOnce(() => { throw new Error("Unknown delivery"); });
    await expect(f.service.tick()).rejects.toThrow("Unknown delivery");
    const original = f.engine.command.mock.calls.at(-1)?.[0];
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toEqual(original);
  });
  it("retains Stop work when the initial coordinator send completes late", async () => {
    const f = await setup();
    let release!: () => void;
    let started!: () => void;
    const sent = new Promise<void>((resolve) => { release = resolve; });
    const sending = new Promise<void>((resolve) => { started = resolve; });
    f.engine.command.mockImplementation(async (input) => {
      if (input.type === "send") {
        started();
        await sent;
      }
      return { sessionId: "coordinator" };
    });
    const starting = f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    await sending;
    await f.service.call("crews.stop", { runId: "launch-run" }, f.project.id);
    vi.mocked(f.store.session).mockResolvedValue({
      status: "running", runId: "coordinator-run",
    } as Awaited<ReturnType<HostStore["session"]>>);
    release();
    await starting;
    expect((await f.service.list(f.project.id)).runs[0]).toMatchObject({
      status: "paused", coordinatorSessionId: "coordinator",
    });
    expect(f.engine.command).toHaveBeenCalledWith(expect.objectContaining({
      type: "cancel", sessionId: "coordinator", runId: "coordinator-run",
    }));
  });
  it("does not send an initial coordinator prompt if paused while preparing the session", async () => {
    const f = await setup();
    let release!: () => void;
    let started!: () => void;
    const prepared = new Promise<void>((resolve) => { release = resolve; });
    const preparing = new Promise<void>((resolve) => { started = resolve; });
    f.engine.updateSession.mockImplementationOnce(async () => { started(); await prepared; });
    const starting = f.service.startRun(f.project.id, "crew", "Start", "launch-run", "supervised");
    await preparing;
    await f.service.call("crews.stop", { runId: "launch-run" }, f.project.id);
    release();
    await starting;
    expect(f.engine.command.mock.calls.some(([command]) => command.type === "send")).toBe(false);
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
    await f.service.call("crews.resume", { runId: "launch-run" }, f.project.id);
    expect(f.engine.command.mock.calls.some(([command]) => command.type === "send")).toBe(true);
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("preserves independent crew saves across awaited actor reads", async () => {
    const f = await setup();
    await Promise.all([
      f.service.save({ ...f.definition, id: "first", name: "First" }),
      f.service.save({ ...f.definition, id: "second", name: "Second" }),
    ]);
    expect((await f.service.list(f.project.id)).definitions.map((item) => item.id).sort()).toEqual([
      "crew",
      "first",
      "second",
    ]);
  });
  it("forwards owner member directives and requires reconciliation before acceptance", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const task = f.rows[0]!;
    task.sessionId = "member";
    task.status = "review";
    task.verification = { review: { verdict: "pass", note: "Pass", sessionId: "reviewer" } };
    await f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    await f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    expect((await f.service.list(f.project.id)).runs[0]!.messages).toHaveLength(1);
    await expect(
      f.service.call("crews.accept", { runId: "run", taskId: task.id }, f.project.id, f.principal),
    ).rejects.toThrow("directives");
    await f.service.call(
      "crews.resolve",
      { runId: "run", requestId: "owner:owner-change" },
      f.project.id,
      f.principal,
    );
    await f.service.call(
      "crews.accept",
      { runId: "run", taskId: task.id },
      f.project.id,
      f.principal,
    );
  });
  it("does not let a coordinator grant itself approval authority", async () => {
    const f = await setup();
    const definition = (await f.service.list(f.project.id)).definitions[0]!;
    await expect(
      (async () =>
        await f.service.save(
          { ...definition, policy: { ...definition.policy, delegateApprovals: true } },
          definition.updatedAt,
          f.principal,
        ))(),
    ).rejects.toThrow("Only the owner");
    await f.start();
    await expect(
      f.service.call("crews.respond", { runId: "run" }, f.project.id, f.principal),
    ).rejects.toThrow("not granted");
  });
  it("serializes overlapping writes while allowing disjoint assignments", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const first = f.rows[0]!;
    first.status = "running";
    first.crewScopes = ["src/backend"];
    const second = {
      ...first,
      id: "second",
      status: "queued" as const,
      crewScopes: ["src/backend/api.ts"],
    };
    const canStart = (f.tasks as unknown as HostTasks).crewCanStart!;
    expect(await canStart(second)).toBe(false);
    expect(await canStart({ ...second, crewScopes: ["src/ui"] })).toBe(true);
  });
  it("holds ordinary direct work behind crew leases but allows isolated work", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const first = f.rows[0]!;
    first.status = "running";
    first.crewScopes = ["src/backend"];
    const ordinary = {
      ...first,
      id: "ordinary",
      crewRunId: undefined,
      crewScopes: undefined,
      status: "queued" as const,
    };
    const canStart = (f.tasks as unknown as HostTasks).crewCanStart!;
    expect(await canStart(ordinary)).toBe(false);
    first.status = "verifying";
    expect(await canStart(ordinary)).toBe(false);
    expect(await canStart({ ...ordinary, isolate: true })).toBe(true);
    first.status = "review";
    expect(await canStart(ordinary)).toBe(true);
    first.status = "running";
    first.crewRunId = undefined;
    expect(await canStart(ordinary)).toBe(true);
  });
  it("delivers large request batches in full and retries only the pending batch", async () => {
    const f = await setup();
    await f.start();
    const texts = [0, 1, 2].map((i) => `request-body-${i} ${"x".repeat(11000)} end-${i}`);
    for (const [i, text] of texts.entries())
      await f.service.call(
        "crews.request",
        {
          runId: "run",
          requestId: `large-${i}`,
          text,
        },
        f.project.id,
        f.principal,
      );
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[0]!),
    });
    expect((await f.service.list(f.project.id)).runs[0]!.notifications).toEqual({
      "request:large-0": "sent",
    });
    f.engine.command.mockImplementationOnce(() => {
      throw new Error("delivery uncertain");
    });
    await expect(f.service.tick()).rejects.toThrow("delivery uncertain");
    const failed = f.engine.command.mock.calls.at(-1)?.[0];
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toEqual(failed);
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[1]!),
    });
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({
      text: expect.stringContaining(texts[2]!),
    });
    expect((await f.service.list(f.project.id)).runs[0]!.notifications).toEqual({
      "request:large-0": "sent",
      "request:large-1": "sent",
      "request:large-2": "sent",
    });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    for (const [command] of f.engine.command.mock.calls)
      expect(
        (
          command as unknown as {
            text: string;
          }
        ).text.length,
      ).toBeLessThanOrEqual(20000);
  });
  it("keeps immutable definition snapshots and rejects foreign/global agent writes", async () => {
    const f = await setup();
    await f.start();
    const original = (await f.service.list(f.project.id)).definitions[0]!;
    await f.service.save({ ...original, name: "Changed" }, original.updatedAt);
    expect((await f.service.list(f.project.id)).runs[0]!.definition.name).toBe("Crew");
    await expect(
      (async () =>
        await f.service.save(
          { ...f.definition, id: "global", projectId: undefined },
          undefined,
          f.principal,
        ))(),
    ).rejects.toThrow("project");
    await expect(
      f.service.call("crews.assign", { runId: "run" }, f.project.id, {
        ...f.principal,
        sessionId: "foreign",
      }),
    ).rejects.toThrow("coordinator");
  });
  it("deduplicates concurrent requests and uses an independent selected reviewer", async () => {
    const f = await setup();
    await f.start();
    const [a, b] = await Promise.all([f.assign(), f.assign()]);
    expect(a.taskId).toBe(b.taskId);
    expect(f.tasks.save).toHaveBeenCalledTimes(1);
    expect(f.rows[0]!.reviewerConfig?.harness).toBe("claude");
    expect(f.rows[0]!.autoMerge).toBe(false);
    expect(f.rows[0]!.isolate).toBe(false);
    await expect(
      f.service.assign(
        f.project.id,
        {
          runId: "run",
          requestId: "assignment",
          memberId: "worker",
          title: "Different",
          prompt: "Different",
        },
        f.principal,
      ),
    ).rejects.toThrow("different input");
  });
  it("reserves reviewer cost and does not overspend on parallel submissions", async () => {
    const f = await setup(3);
    await f.start();
    const results = await Promise.allSettled([f.assign("first"), f.assign("second")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.service.list(f.project.id)).runs[0]!.assignments[0]!.estimatedCost).toBe(2);
  });
  it("requires independent review before acceptance and resolves member requests", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const task = f.rows[0]!;
    task.status = "review";
    await expect(
      f.service.call("crews.accept", { runId: "run", taskId: task.id }, f.project.id, f.principal),
    ).rejects.toThrow("Independent review");
    task.verification = {
      review: { verdict: "pass", note: "Checked", sessionId: "review-session" },
    };
    await f.service.call(
      "crews.accept",
      { runId: "run", taskId: task.id },
      f.project.id,
      f.principal,
    );
    task.sessionId = "worker-session";
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "image", text: "Need an image specialist" },
      f.project.id,
      { ...f.principal, sessionId: "worker-session" },
    );
    await expect(
      f.service.call("crews.finish", { runId: "run" }, f.project.id, f.principal),
    ).rejects.toThrow("resolve");
    await f.service.call(
      "crews.resolve",
      { runId: "run", requestId: "image" },
      f.project.id,
      f.principal,
    );
    await f.service.call("crews.finish", { runId: "run" }, f.project.id, f.principal);
  });
  it("reuses a durable event delivery ID across an uncertain send", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "resource", text: "Need help" },
      f.project.id,
      f.principal,
    );
    f.engine.command.mockImplementationOnce(() => {
      throw new Error("transport interrupted");
    });
    await expect(f.service.tick()).rejects.toThrow("transport interrupted");
    const pending = JSON.parse(
      String(
        (await f.store.db.prepare("SELECT value FROM metadata WHERE key='crews.v1'").get())!.value,
      ),
    ).runs[0].pendingDelivery;
    expect(pending.commandId).toBeTruthy();
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({ commandId: pending.commandId });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
  });
  it("preserves Stop work and new requests when an in-flight delivery settles", async () => {
    const f = await setup();
    await f.start();
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "first", text: "Need help" },
      f.project.id,
      f.principal,
    );
    let release!: () => void;
    let started!: () => void;
    const delivered = new Promise<void>((resolve) => { release = resolve; });
    const sending = new Promise<void>((resolve) => { started = resolve; });
    f.engine.command.mockImplementationOnce(async () => {
      started();
      await delivered;
      return { sessionId: "coordinator" };
    });
    const tick = f.service.tick();
    await sending;
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    await f.service.call(
      "crews.request",
      { runId: "run", requestId: "second", text: "New request" },
      f.project.id,
      f.principal,
    );
    release();
    await tick;
    const run = (await f.service.list(f.project.id)).runs[0]!;
    expect(run.status).toBe("paused");
    expect(run.messages.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(run.notifications).toEqual({ "request:first": "sent" });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
  });
  it("holds paused work in the existing scheduler and rejects forged tool evidence", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id, f.principal);
    expect(await (f.tasks as unknown as HostTasks).crewCanStart!(f.rows[0]!)).toBe(false);
    await expect(f.assign("new")).rejects.toThrow("not active");
    const d = (await f.service.list(f.project.id)).definitions[0]!;
    d.agents[1]!.candidates[0]!.capabilities["image-generation"] = {
      state: "available",
      observedAt: 1000,
      source: "host probe",
    };
    const saved = await f.service.save(d, d.updatedAt);
    expect(saved.agents[1]!.candidates[0]!.capabilities["image-generation"]?.state).toBe("unknown");
  });
});
describe("crew deletion", () => {
  it("lets only the owner delete a crew without active work and keeps run snapshots", async () => {
    const f = await setup();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.start();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Stop");
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    const view = await f.service.list(f.project.id);
    expect(view.definitions).toEqual([]);
    expect(view.runs[0]!.definition.name).toBe("Crew");
  });
  it("refuses a crew that open tasks still use", async () => {
    const f = await setup();
    f.rows.push({ id: "task", crewDefinitionId: "crew", status: "todo" } as never);
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Tasks");
  });
  it("does not recreate a deleted crew from a stale editor", async () => {
    const f = await setup();
    const saved = (await f.service.list(f.project.id)).definitions[0]!;
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    await expect((async () => await f.service.save(saved, saved.updatedAt))()).rejects.toThrow(
      "deleted",
    );
  });
  it("lets only the owner remove a library agent", async () => {
    const f = await setup();
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "saved", projectId: f.project.id } },
      f.project.id,
    );
    await expect(
      f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id);
    expect((await f.service.list(f.project.id)).agents).toEqual([]);
  });
  it("lists a short work title without exposing the launch prompt", async () => {
    const f = await setup();
    await f.service.startRun(
      f.project.id,
      "crew",
      "Mobile sign-in\nUse the design system",
      "run",
      "supervised",
    );
    const [run] = (await f.service.list(f.project.id)).runs;
    expect(run).toMatchObject({ title: "Mobile sign-in", launch: undefined });
  });
  it("keeps library groups and shares host-wide profiles with other projects", async () => {
    const f = await setup();
    const other = await f.store.addProject("/crew-fixture-mobile", "Mobile fixture");
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "ui", groups: ["UI", "UI", "Mobile"] } },
      f.project.id,
    );
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "local", projectId: f.project.id } },
      f.project.id,
    );
    const shared = (await f.service.list(other.id)).agents;
    expect(shared.map((agent) => agent.id)).toEqual(["ui"]);
    expect(shared[0]!.groups).toEqual(["UI", "Mobile"]);
    // A crew member remembers the profile it came from; the library never edits it.
    const member = { ...shared[0]!, id: "ui-copy", source: { id: "ui", updatedAt: 1000 } };
    const saved = await f.service.save({
      ...f.definition,
      id: "mobile",
      projectId: other.id,
      agents: [...f.definition.agents, member],
    });
    expect(saved.agents.find((agent) => agent.id === "ui-copy")).toMatchObject({
      groups: ["UI", "Mobile"],
      source: { id: "ui", updatedAt: 1000 },
    });
  });
  it("discovers library groups with bounded summaries and keeps foreign projects hidden", async () => {
    const f = await setup();
    const other = await f.store.addProject("/foreign-crew", "Foreign");
    for (const [id, projectId] of [
      ["shared", undefined],
      ["local", f.project.id],
      ["foreign", other.id],
    ] as const)
      await f.service.call(
        "crews.agent.save",
        {
          agent: {
            ...f.definition.agents[1]!,
            id,
            projectId,
            groups: ["Mobile"],
            instructions: "Private instructions",
          },
        },
        f.project.id,
      );
    const call = async (action: string, input = {}) =>
      await f.service.call(action, input, f.project.id, f.principal);
    const first = await call("crews.agents.list", {
      group: "Mobile",
      role: "specialist",
      limit: 1,
    });
    expect(first).toMatchObject({
      total: 2,
      offset: 0,
      nextOffset: 1,
      items: [{ id: "shared", candidateCount: 1 }],
    });
    expect(JSON.stringify(first)).not.toContain("instructions");
    expect(await call("crews.agents.list", { scope: "project", search: "LOCAL" })).toMatchObject({
      total: 1,
      items: [{ id: "local" }],
    });
    expect(await call("crews.agent.get", { agentId: "shared" })).toMatchObject({
      instructions: "",
    });
    await expect(call("crews.agent.get", { agentId: "foreign" })).rejects.toThrow("not available");
    await expect(call("crews.agents.list", { limit: 101 })).rejects.toThrow("bounded");
    await expect(call("crews.agents.list", { offset: -1 })).rejects.toThrow("bounded");
  });
  it("discovers definitions and run summaries without exposing prompts or snapshots", async () => {
    const f = await setup();
    const other = await f.store.addProject("/foreign-definition", "Foreign");
    await f.service.save({ ...f.definition, id: "global", projectId: undefined });
    await f.service.save({ ...f.definition, id: "foreign", projectId: other.id });
    const call = async (action: string, input = {}) =>
      await f.service.call(action, input, f.project.id, f.principal);
    expect(await call("crews.definitions.list", { scope: "global" })).toMatchObject({
      total: 1,
      items: [{ id: "global", memberCount: 3 }],
    });
    expect(await call("crews.definition.get", { definitionId: "crew" })).toMatchObject({
      agents: [{ instructions: "" }, { instructions: "" }, { instructions: "" }],
    });
    await expect(call("crews.definition.get", { definitionId: "foreign" })).rejects.toThrow(
      "not available",
    );
    await f.start();
    const runs = await call("crews.runs.list", {
      definitionId: "crew",
      status: "active",
      search: "Build",
    });
    expect(runs).toMatchObject({
      total: 1,
      items: [{ id: "run", definitionId: "crew", taskCount: 0 }],
    });
    expect(JSON.stringify(runs)).not.toContain("launch");
    expect(JSON.stringify(runs)).not.toContain("instructions");
    expect(await call("crews.runs.list", { status: "finished" })).toMatchObject({
      total: 0,
      items: [],
    });
  });
});
describe("crew work deletion", () => {
  it("stops queued retries without trying to discard their retained work", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    f.rows[0].sessionId = "earlier-worker";
    f.rows[0].startedAt = 10;
    const cancel = vi.fn(async (id: string) => { f.rows.find((task) => task.id === id)!.status = "blocked"; });
    const move = vi.fn();
    Object.assign(f.tasks, { cancel, move });
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    expect(cancel).toHaveBeenCalledWith(f.rows[0].id, "Stopped by you.");
    expect(move).not.toHaveBeenCalled();
    expect(f.rows[0]).toMatchObject({ status: "blocked", sessionId: "earlier-worker" });
  });
  it("refuses deleting a revision that resumed during conversation checks", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    const run = (await f.service.list(f.project.id)).runs[0];
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const checking = new Promise<void>((resolve) => { started = resolve; });
    const original = await f.store.session("lead-session");
    vi.mocked(f.store.session).mockImplementationOnce(async () => { started(); await held; return original; });
    const deleting = f.service.call("crews.deleteRun", { runId: "run", expectedUpdatedAt: run.updatedAt }, f.project.id);
    const failed = expect(deleting).rejects.toThrow("changed");
    await checking;
    await f.service.call("crews.resume", { runId: "run" }, f.project.id);
    release();
    await failed;
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("active");
  });
  it("still stops peers and the coordinator when one assignment cannot stop", async () => {
    const f = await setup();
    await f.start();
    await f.assign("first");
    await f.assign("second");
    f.rows[0].status = "running";
    f.rows[1].status = "running";
    const move = vi.fn(async (id: string, status: HostTask["status"]) => {
      if (id === f.rows[0].id) throw new Error("Provider unavailable");
      const task = f.rows.find((task) => task.id === id)!;
      task.status = status;
      return task;
    });
    Object.assign(f.tasks, { move });
    vi.mocked(f.store.session).mockResolvedValue({
      status: "running",
      runId: "lead-run",
    } as Awaited<ReturnType<HostStore["session"]>>);
    f.engine.command.mockClear();

    await expect(
      f.service.call("crews.stop", { runId: "run" }, f.project.id),
    ).rejects.toThrow("some conversations could not be stopped");

    expect(move).toHaveBeenCalledWith(f.rows[1].id, "blocked");
    expect(f.engine.command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel", sessionId: "lead-session", runId: "lead-run" }),
    );
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
  });
  it("stop removes queued assignments and cancels running ones", async () => {
    const f = await setup();
    await f.start();
    await f.assign("first");
    await f.assign("second");
    f.rows[1].status = "running";
    const move = vi.fn(async (id: string, status: HostTask["status"]) => {
      const task = f.rows.find((task) => task.id === id)!;
      task.status = status;
      return task;
    });
    Object.assign(f.tasks, { move });
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    expect(move).toHaveBeenCalledWith(f.rows[0].id, "todo");
    expect(move).toHaveBeenCalledWith(f.rows[1].id, "blocked");
    expect((await f.service.list(f.project.id)).runs[0].status).toBe("paused");
  });
  it("requires owner, current revision and stopped work while preserving crew and tasks", async () => {
    const f = await setup();
    await f.start();
    await f.assign();
    const input = async () => ({
      runId: "run",
      expectedUpdatedAt: (await f.service.list(f.project.id)).runs[0].updatedAt,
    });
    await expect(
      f.service.call("crews.deleteRun", await input(), f.project.id, f.principal),
    ).rejects.toThrow("Only the owner");
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).rejects.toThrow(
      "Stop work",
    );
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    await expect(
      f.service.call(
        "crews.deleteRun",
        { ...(await input()), expectedUpdatedAt: -1 },
        f.project.id,
      ),
    ).rejects.toThrow("changed");
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).rejects.toThrow(
      "pending assignments",
    );
    f.rows[0].status = "blocked";
    await expect(f.service.call("crews.deleteRun", await input(), "wrong-project")).rejects.toThrow(
      "does not belong",
    );
    await expect(f.service.call("crews.deleteRun", await input(), f.project.id)).resolves.toEqual({
      deleted: true,
    });
    expect((await f.service.list(f.project.id)).runs).toHaveLength(0);
    expect((await f.service.list(f.project.id)).definitions.some((d) => d.id === "crew")).toBe(
      true,
    );
    expect(f.rows).toHaveLength(1);
  });
  it("rejects live conversations and source-task references", async () => {
    const f = await setup();
    await f.start();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id);
    const input = {
      runId: "run",
      expectedUpdatedAt: (await f.service.list(f.project.id)).runs[0].updatedAt,
    };
    vi.mocked(f.store.session).mockReturnValue({ status: "running" } as ReturnType<
      HostStore["session"]
    >);
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "running conversations",
    );
    vi.mocked(f.store.session).mockImplementation(() => {
      throw new Error("Database read failed");
    });
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "Database read failed",
    );
    vi.mocked(f.store.session).mockReturnValue({ status: "idle" } as ReturnType<
      HostStore["session"]
    >);
    f.rows.push({ id: "source", crewExecutionId: "run", status: "done" } as HostTask);
    await expect(f.service.call("crews.deleteRun", input, f.project.id)).rejects.toThrow(
      "task still owns",
    );
  });
});
