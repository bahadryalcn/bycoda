import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { defaultCrewPolicy, type CrewDefinition } from "../src/features/crews/model/crew";

const stores: HostStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
});
function setup(costLimit?: number) {
  const store = new HostStore(":memory:");
  stores.push(store);
  const project = store.addProject("/crew-fixture", "Crew fixture");
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
  service.save(definition);
  const principal = { projectId: project.id, sessionId: "lead-session" };
  const start = () =>
    service.startRun(project.id, "crew", "Build it", "run", "supervised", principal);
  const assign = (id = "assignment") =>
    service.assign(
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
  it("forwards owner member directives and requires reconciliation before acceptance", async () => {
    const f = setup();
    await f.start();
    await f.assign();
    const task = f.rows[0]!;
    task.sessionId = "member";
    task.status = "review";
    task.verification = { review: { verdict: "pass", note: "Pass", sessionId: "reviewer" } };
    f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    f.service.ownerDirective({
      type: "send",
      commandId: "owner-change",
      sessionId: "member",
      text: "Use the revised API contract",
    });
    expect(f.service.list(f.project.id).runs[0]!.messages).toHaveLength(1);
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
    const f = setup();
    const definition = f.service.list(f.project.id).definitions[0]!;
    expect(() =>
      f.service.save(
        { ...definition, policy: { ...definition.policy, delegateApprovals: true } },
        definition.updatedAt,
        f.principal,
      ),
    ).toThrow("Only the owner");
    await f.start();
    await expect(
      f.service.call("crews.respond", { runId: "run" }, f.project.id, f.principal),
    ).rejects.toThrow("not granted");
  });
  it("serializes overlapping writes while allowing disjoint assignments", async () => {
    const f = setup();
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
    expect(canStart(second)).toBe(false);
    expect(canStart({ ...second, crewScopes: ["src/ui"] })).toBe(true);
  });
  it("holds ordinary direct work behind crew leases but allows isolated work", async () => {
    const f = setup();
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
    expect(canStart(ordinary)).toBe(false);
    first.status = "verifying";
    expect(canStart(ordinary)).toBe(false);
    expect(canStart({ ...ordinary, isolate: true })).toBe(true);
    first.status = "review";
    expect(canStart(ordinary)).toBe(true);
    first.status = "running";
    first.crewRunId = undefined;
    expect(canStart(ordinary)).toBe(true);
  });
  it("delivers large request batches in full and retries only the pending batch", async () => {
    const f = setup();
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
    expect(f.service.list(f.project.id).runs[0]!.notifications).toEqual({
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
    expect(f.service.list(f.project.id).runs[0]!.notifications).toEqual({
      "request:large-0": "sent",
      "request:large-1": "sent",
      "request:large-2": "sent",
    });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
    for (const [command] of f.engine.command.mock.calls)
      expect((command as unknown as { text: string }).text.length).toBeLessThanOrEqual(20000);
  });
  it("keeps immutable definition snapshots and rejects foreign/global agent writes", async () => {
    const f = setup();
    await f.start();
    const original = f.service.list(f.project.id).definitions[0]!;
    f.service.save({ ...original, name: "Changed" }, original.updatedAt);
    expect(f.service.list(f.project.id).runs[0]!.definition.name).toBe("Crew");
    expect(() =>
      f.service.save(
        { ...f.definition, id: "global", projectId: undefined },
        undefined,
        f.principal,
      ),
    ).toThrow("project");
    await expect(
      f.service.call("crews.assign", { runId: "run" }, f.project.id, {
        ...f.principal,
        sessionId: "foreign",
      }),
    ).rejects.toThrow("coordinator");
  });
  it("deduplicates concurrent requests and uses an independent selected reviewer", async () => {
    const f = setup();
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
    const f = setup(3);
    await f.start();
    const results = await Promise.allSettled([f.assign("first"), f.assign("second")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.service.list(f.project.id).runs[0]!.assignments[0]!.estimatedCost).toBe(2);
  });
  it("requires independent review before acceptance and resolves member requests", async () => {
    const f = setup();
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
    const f = setup();
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
      String(f.store.db.prepare("SELECT value FROM metadata WHERE key='crews.v1'").get()!.value),
    ).runs[0].pendingDelivery;
    expect(pending.commandId).toBeTruthy();
    await f.service.tick();
    expect(f.engine.command.mock.calls.at(-1)?.[0]).toMatchObject({ commandId: pending.commandId });
    const calls = f.engine.command.mock.calls.length;
    await f.service.tick();
    expect(f.engine.command).toHaveBeenCalledTimes(calls);
  });
  it("holds paused work in the existing scheduler and rejects forged tool evidence", async () => {
    const f = setup();
    await f.start();
    await f.assign();
    await f.service.call("crews.pause", { runId: "run" }, f.project.id, f.principal);
    expect((f.tasks as unknown as HostTasks).crewCanStart!(f.rows[0]!)).toBe(false);
    await expect(f.assign("new")).rejects.toThrow("not active");
    const d = f.service.list(f.project.id).definitions[0]!;
    d.agents[1]!.candidates[0]!.capabilities["image-generation"] = {
      state: "available",
      observedAt: 1000,
      source: "host probe",
    };
    const saved = f.service.save(d, d.updatedAt);
    expect(saved.agents[1]!.candidates[0]!.capabilities["image-generation"]?.state).toBe("unknown");
  });
});

describe("crew deletion", () => {
  it("lets only the owner delete a crew without active work and keeps run snapshots", async () => {
    const f = setup();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.start();
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Stop");
    await f.service.call("crews.stop", { runId: "run" }, f.project.id);
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    const view = f.service.list(f.project.id);
    expect(view.definitions).toEqual([]);
    expect(view.runs[0]!.definition.name).toBe("Crew");
  });

  it("refuses a crew that open tasks still use", async () => {
    const f = setup();
    f.rows.push({ id: "task", crewDefinitionId: "crew", status: "todo" } as never);
    await expect(
      f.service.call("crews.delete", { definitionId: "crew" }, f.project.id),
    ).rejects.toThrow("Tasks");
  });

  it("does not recreate a deleted crew from a stale editor", async () => {
    const f = setup();
    const saved = f.service.list(f.project.id).definitions[0]!;
    await f.service.call("crews.delete", { definitionId: "crew" }, f.project.id);
    expect(() => f.service.save(saved, saved.updatedAt)).toThrow("deleted");
  });

  it("lets only the owner remove a library agent", async () => {
    const f = setup();
    await f.service.call(
      "crews.agent.save",
      { agent: { ...f.definition.agents[1]!, id: "saved", projectId: f.project.id } },
      f.project.id,
    );
    await expect(
      f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id, f.principal),
    ).rejects.toThrow("owner");
    await f.service.call("crews.agent.delete", { agentId: "saved" }, f.project.id);
    expect(f.service.list(f.project.id).agents).toEqual([]);
  });
});
