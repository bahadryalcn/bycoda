import { wireCrewSourceTasks, wireCrewWorkEngine } from "./crew-source-task.fixture";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { HostCrews, CrewRoutingWait } from "./crews";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { HostModelCatalog } from "../../src/features/connections/model/protocol";
import {
  defaultCrewPolicy,
  type CrewCandidate,
  type CrewDefinition,
} from "../../src/features/crews/model/crew";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingEntry,
} from "../../src/shared/model/host-contracts/model-routing";
import { createModelRoutingService } from "../model-routing/service";
import { hostModelRoutingService } from "../model-routing/runtime";
import { readCrewRun } from "./crew-scheduler-projection";
import { saveModelRouting, readModelRouting } from "../model-routing/storage";
vi.mock("../model-routing/runtime", () => ({ hostModelRoutingService: vi.fn() }));
const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
const candidate = (model: string, harness: "codex" | "claude" = "codex"): CrewCandidate => ({
  id: model,
  model,
  harness,
  modelSettings: {},
  capabilities: {},
});
const entry = (model: string, harness: "codex" | "claude" = "codex"): ModelRoutingEntry => ({
  id: model,
  model,
  harness,
  modelSettings: {},
  unknownLimit: "use",
});
async function setup(entries: ModelRoutingEntry[]) {
  const store = new HostStore(":memory:");
  stores.push(store);
  await store.ready;
  const project = await store.addProject("/crew-routing", "Crew routing");
  const models: HostModelCatalog = {
    models: {
      codex: ["fallback", "worker", "vision"].map((id) => ({ id, harness: "codex", name: id })),
      claude: [{ id: "review", harness: "claude", name: "Review" }],
    },
    errors: {},
  } as HostModelCatalog;
  const tasks = { list: vi.fn(async () => []), save: vi.fn(async (task) => task), tick: vi.fn() };
  const session = {
    revision: 1,
    updatedAt: 1000,
    projectId: project.id,
    status: "idle",
    runId: undefined as string | undefined,
    session: {
      id: "lead-session",
      harness: "codex",
      model: "fallback",
      modelSettings: {},
      runtimeMode: "supervised",
      title: "Lead",
      blocks: [],
    },
  };
  vi.spyOn(store, "session").mockResolvedValue(
    session as Awaited<ReturnType<HostStore["session"]>>,
  );
  const engine = {
    command: vi.fn(async (raw: unknown) => {
      const command = raw as { type: string; commandId: string };
      if (command.type === "send") session.runId = `${command.commandId}-run`;
      return { commandId: command.commandId, sessionId: "lead-session", revision: 1 };
    }),
    updateSession: vi.fn(),
  };
  wireCrewWorkEngine(store, engine as unknown as HostEngine);
  let left = 100;
  let now = 1000;
  const routing = createModelRoutingService({
    store,
    accounts: async () => ({}),
    catalog: async () => models,
    signals: async () => ({
      available: () => true,
      signedIn: () => true,
      quota: () => ({ leftPercent: left, resetsAt: 5000 }),
    }),
  });
  vi.mocked(hostModelRoutingService).mockReturnValue(routing);
  const crews = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    async () => models,
    () => now,
    async (target) => target.model === "vision",
  );
  wireCrewSourceTasks(crews, tasks as unknown as HostTasks, store);
  await crews.ready;
  const current = await readModelRouting(store);
  await saveModelRouting(
    store,
    {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      entries,
      delegation: { global: { crossAdvisor: "codex:advisor" }, providers: {}, accounts: {} },
    },
    current.version,
    1,
  );
  const definition: CrewDefinition = {
    id: "crew",
    name: "Team",
    projectId: project.id,
    updatedAt: 0,
    policy: defaultCrewPolicy,
    agents: [
      {
        id: "lead",
        name: "Lead",
        role: "coordinator",
        instructions: "",
        selection: "fixed",
        candidates: [candidate("fallback")],
      },
      {
        id: "worker",
        name: "Worker",
        role: "specialist",
        instructions: "",
        selection: "automatic",
        modelChoice: { kind: "order" },
        candidates: [candidate("fallback")],
      },
      {
        id: "reviewer",
        name: "Reviewer",
        role: "reviewer",
        instructions: "",
        selection: "fixed",
        candidates: [candidate("review", "claude")],
      },
    ],
  };
  await crews.save(definition);
  vi.spyOn(store, "session").mockResolvedValue({
    projectId: project.id,
    status: "idle",
    session: { harness: "codex", model: "fallback", runtimeMode: "supervised", blocks: [] },
  } as never);
  const principal = { projectId: project.id, sessionId: "lead-session" };
  const start = () => crews.startRun(project.id, "crew", "Work", "run", "supervised", principal);
  const assign = (required: string[] = []) =>
    crews.assign(
      project.id,
      {
        runId: "run",
        requestId: "assignment",
        memberId: "worker",
        title: "Build",
        prompt: "Build it",
        required,
      },
      principal,
    );
  return {
    store,
    project,
    crews,
    routing,
    tasks,
    engine,
    definition,
    start,
    assign,
    setLeft: (value: number) => {
      left = value;
    },
    setNow: (value: number) => {
      now = value;
    },
  };
}
it("resolves automatic members through routing with capability predicate and preserves account/delegation", async () => {
  const f = await setup([entry("worker"), { ...entry("vision"), providerAccountId: "account" }]);
  await f.start();
  const assignment = await f.assign(["vision"]);
  expect(assignment.candidate.model).toBe("vision");
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "vision",
      providerAccountId: "account",
      modelSettings: expect.objectContaining({ crossAdvisor: "codex:advisor" }),
    }),
  );
  expect(
    (
      await f.routing.resolve({
        role: "crew.member",
        choice: { kind: "order" },
        eligible: (target) => target.model === "vision",
      })
    ).skipped,
  ).toEqual([{ entryId: "worker", reason: "missingCapability" }]);
});
it("retries worker selection when its first pick conflicts with fixed reviewer", async () => {
  const f = await setup([entry("review", "claude"), entry("worker")]);
  await f.start();
  expect((await f.assign()).candidate.model).toBe("worker");
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "worker",
      reviewerConfig: expect.objectContaining({ model: "review" }),
    }),
  );
});
it("keeps fixed candidate identity and model despite routing priority", async () => {
  const f = await setup([entry("vision")]);
  const run = await f.start();
  expect(run.coordinatorCandidate).toMatchObject({
    id: "fallback",
    model: "fallback",
    modelSettings: { crossAdvisor: "codex:advisor" },
  });
});
it("holds exhausted coordinator without session creation and retries with same request identity", async () => {
  const f = await setup([{ ...entry("worker"), minRemainingPercent: 50 }]);
  f.setLeft(10);
  const saved = await f.crews.save(
    {
      ...f.definition,
      agents: f.definition.agents.map((agent) =>
        agent.id === "lead"
          ? { ...agent, selection: "automatic", modelChoice: { kind: "order" } }
          : agent,
      ),
    },
    1000,
  );
  expect(saved.agents[0]!.selection).toBe("automatic");
  const start = () => f.crews.startRun(f.project.id, "crew", "Work", "waiting", "supervised");
  const held = await start();
  expect(held.routingWait).toEqual({ nextResetAt: 5000 });
  expect(held.status).toBe("active");
  expect(held.coordinatorSessionId).toBeUndefined();
  await start();
  await f.crews.tick();
  expect(f.engine.command).not.toHaveBeenCalled();
  await expect(
    f.routing.resolve({ role: "crew.member", choice: { kind: "order" } }),
  ).resolves.toMatchObject({ ok: false, reason: "noEligibleEntry" });
  f.setLeft(100);
  f.setNow(5000);
  await f.crews.tick();
  const resumed = await readCrewRun(f.store, "waiting");
  expect(resumed!.routingWait).toBeUndefined();
  expect(resumed!.coordinatorCandidate!.model).toBe("worker");
  expect(resumed!.coordinatorSessionId).toBe("lead-session");
});
it("does not create assignments when all routing entries are ineligible", async () => {
  const f = await setup([{ ...entry("worker"), minRemainingPercent: 50 }]);
  await f.start();
  f.setLeft(10);
  await expect(f.assign()).rejects.toBeInstanceOf(CrewRoutingWait);
  expect(f.tasks.save).toHaveBeenCalledTimes(1); // Canonical source task, not an assignment.
  await expect(f.assign()).rejects.toBeInstanceOf(CrewRoutingWait);
  expect(
    (await readCrewRun(f.store, "run"))!.messages.filter(
      (message) => message.id === "routing:assignment",
    ),
  ).toHaveLength(1);
  await expect(
    f.crews.assign(
      f.project.id,
      {
        runId: "run",
        requestId: "assignment",
        memberId: "worker",
        title: "Changed",
        prompt: "Changed",
      },
      { projectId: f.project.id, sessionId: "lead-session" },
    ),
  ).rejects.toThrow("different input");
  f.setLeft(100);
  f.setNow(5000);
  await f.crews.tick();
  await f.crews.tick();
  expect(f.engine.command).toHaveBeenCalledTimes(1);
  expect((await f.assign()).candidate.model).toBe("worker");
  expect(
    (await readCrewRun(f.store, "run"))!.messages.find(
      (message) => message.id === "routing:assignment",
    )!.resolvedAt,
  ).toBe(5000);
});

it("keeps equal fixed worker and reviewer models usable as separate sessions", async () => {
  const f = await setup([entry("vision")]);
  await f.crews.save(
    {
      ...f.definition,
      agents: f.definition.agents.map((agent) => ({
        ...agent,
        selection: "fixed",
        candidates: [candidate("fallback")],
      })),
    },
    1000,
  );
  await f.start();
  expect((await f.assign()).candidate.model).toBe("fallback");
  expect(f.tasks.save).toHaveBeenCalledWith(
    expect.objectContaining({ reviewerConfig: expect.objectContaining({ model: "fallback" }) }),
  );
});

it("does not start a held task-owned coordinator after its task is no longer queued or running", async () => {
  const f = await setup([{ ...entry("worker"), minRemainingPercent: 50 }]);
  f.setLeft(10);
  await f.crews.save(
    {
      ...f.definition,
      agents: f.definition.agents.map((agent) =>
        agent.id === "lead"
          ? { ...agent, selection: "automatic", modelChoice: { kind: "order" } }
          : agent,
      ),
    },
    1000,
  );
  await f.crews.startRun(
    f.project.id,
    "crew",
    "Work",
    "task-waiting",
    "supervised",
    undefined,
    false,
    "task",
  );
  f.setNow(5000);
  f.setLeft(100);
  await f.crews.tick();
  expect(f.engine.command).not.toHaveBeenCalled();
  expect((await readCrewRun(f.store, "task-waiting"))!.routingWait).toBeDefined();
});

it("keeps stored fallback and applies delegation when routing is not configured", async () => {
  const f = await setup([]);
  await f.start();
  expect((await f.assign()).candidate).toMatchObject({
    model: "fallback",
    modelSettings: { crossAdvisor: "codex:advisor" },
  });
});

it("keeps an explicit stored model fixed when the item has no routing choice", async () => {
  const f = await setup([entry("worker")]);
  const current = (await f.crews.list(f.project.id)).definitions.find(
    (item) => item.id === "crew",
  )!;
  const definition = {
    ...current,
    agents: current.agents.map((agent) => {
      const { modelChoice: _choice, ...explicit } = agent;
      return explicit;
    }),
  };
  await f.crews.save(definition, current.updatedAt);
  await f.start();
  expect((await f.assign()).candidate.model).toBe("fallback");
});
