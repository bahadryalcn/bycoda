import type { TaskContext } from "./context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingDraft,
} from "../../src/shared/model/host-contracts/model-routing";
import { selectModelRouting, type ModelRoutingResolveInput } from "../model-routing/selector";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { HostTasks } from "./tasks";
import { HostGoals } from "../goals/goals";
import { HostStewards } from "../stewards/stewards";
import { ConversationStewardTools } from "../conversation/conversation-steward-tools";
import type { HostProvider } from "../providers/providers";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import { routingRun } from "./model-routing";
import { createWork } from "./work-request";

const routing = vi.hoisted(() => ({ resolve: vi.fn(), get: vi.fn() }));
vi.mock("../model-routing/runtime", () => ({ hostModelRoutingService: () => routing }));

const cleanups: (() => Promise<void>)[] = [];
let state: ModelRoutingDraft;
let eligible = true;
/** Remaining quota per entry id; an entry not listed follows `eligible`. */
let left: Record<string, number> = {};
beforeEach(() => {
  state = structuredClone(EMPTY_MODEL_ROUTING);
  eligible = true;
  left = {};
  routing.get.mockReset().mockImplementation(async () => structuredClone(state));
  routing.resolve.mockReset().mockImplementation(async (input: ModelRoutingResolveInput) =>
    selectModelRouting(state, input, {
      available: () => true,
      signedIn: () => true,
      accountKind: () => undefined,
      quota: (entry) => ({ leftPercent: left[entry.id] ?? (eligible ? 100 : 0), resetsAt: 2000 }),
    }),
  );
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

function order() {
  state.entries = [
    {
      id: "entry",
      harness: "claude",
      providerAccountId: "work",
      model: "claude:routed",
      modelSettings: { effort: "high" },
      unknownLimit: "use",
      minRemainingPercent: 10,
    },
  ];
  state.delegation.global = { crossSubagents: "auto" };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-routing-e-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Routing fixture");
  let now = 1000;
  const turns: { input: SendTurnInput; finish(): void }[] = [];
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((finish) => turns.push({ input, finish }))),
    cancel: vi.fn(async () => {
      for (const turn of turns) turn.finish();
    }),
    stop: vi.fn(async () => {
      for (const turn of turns) turn.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  const tasks = new HostTasks(store, engine, () => now);
  const goals = new HostGoals(store, engine, tasks, () => now);
  const stewards = new HostStewards(store, engine, tasks, () => now);
  await Promise.all([tasks.ready, goals.ready, stewards.ready]);
  const input = (extra: Record<string, unknown> = {}) => ({
    id: "item",
    title: "Routing work",
    prompt: "Inspect routing",
    projectId: project.id,
    harness: "claude",
    model: "claude:stored",
    providerAccountId: "personal",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    isolate: false,
    review: false,
    ...extra,
  });
  const tick = async () => {
    now++;
    await tasks.tick();
    await tasks.idle();
  };
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await stewards.close();
    await engine.close();
    await tasks.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    project,
    engine,
    tasks,
    goals,
    stewards,
    input,
    tick,
    turns,
    setNow: (value: number) => {
      now = value;
    },
  };
}

it("resolves and persists worker target before creating its session, then freezes it", async () => {
  order();
  const f = await fixture();
  await f.tasks.save(f.input({ modelChoice: { kind: "default" } }));
  const original = f.engine.command.bind(f.engine);
  vi.spyOn(f.engine, "command").mockImplementation(async (command) => {
    if ((command as { type: string }).type === "create")
      expect(await f.tasks.get("item")).toMatchObject({
        model: "claude:routed",
        providerAccountId: "work",
        modelSettings: { crossSubagents: "auto" },
      });
    return original(command);
  });
  await f.tick();
  const task = (await f.tasks.get("item"))!;
  expect(task.status).toBe("running");
  expect((await f.store.session(task.sessionId!)).session.model).toBe("claude:routed");
  const calls = routing.resolve.mock.calls.length;
  state.entries[0].model = "claude:changed";
  await f.tick();
  expect(routing.resolve).toHaveBeenCalledTimes(calls);
  expect((await f.tasks.get("item"))!.model).toBe("claude:routed");
});

it.each([undefined, { kind: "fixed" }, { kind: "default" }])(
  "keeps stored model with empty routing for choice %j",
  async (modelChoice) => {
    const f = await fixture();
    await f.tasks.save(f.input({ modelChoice }));
    await f.tick();
    expect((await f.tasks.get("item"))!.model).toBe("claude:stored");
    expect((await f.tasks.get("item"))!.status).toBe("running");
  },
);

it("holds exhausted routing without session or permanent failure, then retries reset", async () => {
  order();
  eligible = false;
  const f = await fixture();
  await f.tasks.save(f.input({ modelChoice: { kind: "order" } }));
  await f.tick();
  expect(await f.tasks.get("item")).toMatchObject({
    status: "queued",
    model: "claude:stored",
    error: expect.stringContaining("no eligible entry"),
  });
  expect(await f.store.sessions()).toHaveLength(0);
  const calls = routing.resolve.mock.calls.length;
  await f.tick();
  expect(routing.resolve).toHaveBeenCalledTimes(calls);
  eligible = true;
  f.setNow(2000);
  await f.tick();
  expect(await f.tasks.get("item")).toMatchObject({ status: "running", model: "claude:routed" });
  expect(routingRun((await f.tasks.get("item"))!).modelRoutingWait).toBeUndefined();
});

it.each([
  { choice: undefined, explicit: false, expected: "claude:stored" },
  { choice: { kind: "fixed" }, explicit: false, expected: "claude:stored" },
  { choice: { kind: "pool", poolId: "workers" }, explicit: false, expected: "claude:reviewer" },
  { choice: { kind: "default" }, explicit: true, expected: "claude:explicit" },
])("resolves reviewer rule: %j", async ({ choice, explicit, expected }) => {
  order();
  state.roles["task.reviewer"] = {
    kind: "fixed",
    target: { harness: "claude", model: "claude:reviewer", modelSettings: {} },
  };
  const f = await fixture();
  await f.tasks.save(
    f.input({
      modelChoice: choice,
      review: true,
      status: "todo",
      ...(explicit
        ? {
            reviewerConfig: {
              harness: "claude",
              model: "claude:explicit",
              modelSettings: {},
              instructions: "Review",
            },
          }
        : {}),
    }),
  );
  const task = (await f.tasks.get("item"))!;
  await (f.tasks as unknown as TaskContext).write({ ...task, status: "verifying" });
  const { verify } = await import("./verification");
  await verify(f.tasks as unknown as TaskContext, (await f.tasks.get("item"))!);
  await f.tasks.idle();
  const reviewed = (await f.tasks.get("item"))!;
  expect(reviewed.reviewer?.sessionId).toBeTruthy();
  expect(routingRun(reviewed).reviewerTarget).toMatchObject({
    model: expected,
    modelSettings: { crossSubagents: "auto" },
  });
  expect((await f.store.session(reviewed.reviewer!.sessionId!)).session.model).toBe(expected);
  expect(reviewed.model).toBe("claude:stored");
});

it("routes goal planner and final review separately and copies goal choice into tasks", async () => {
  order();
  state.roles["goal.planner"] = {
    kind: "fixed",
    target: { harness: "claude", model: "claude:planner", modelSettings: {} },
  };
  state.roles["goal.finalReview"] = {
    kind: "fixed",
    target: { harness: "claude", model: "claude:final", modelSettings: {} },
  };
  const f = await fixture();
  const goal = await f.goals.create({
    ...f.input(),
    projectIds: [f.project.id],
    leadProjectId: f.project.id,
    modelChoice: { kind: "default" },
    finalReview: true,
    manualStart: true,
  });
  expect((await f.store.session(goal.plannerSessionId!)).session.model).toBe("claude:planner");
  expect(routingRun(goal).plannerTarget?.model).toBe("claude:planner");
  const internal = f.goals as unknown as {
    start(goal: unknown, now: number): Promise<unknown>;
    finalReviewOwnsSession(goal: unknown): Promise<boolean>;
    finalWorkspaceFingerprint(): Promise<string>;
  };
  await internal.start(
    {
      ...goal,
      plan: {
        tasks: [
          {
            key: "one",
            title: "Child",
            prompt: "Work",
            project: f.project.cwd,
            projectId: f.project.id,
            dependsOn: [],
          },
          {
            key: "two",
            title: "Second",
            prompt: "Work",
            project: f.project.cwd,
            projectId: f.project.id,
            dependsOn: [],
          },
        ],
      },
    },
    1001,
  );
  const child = (await f.tasks.list())[0];
  expect(routingRun(child).modelChoice).toEqual({ kind: "default" });
  expect(child.model).toBe("claude:stored");
  for (const task of await f.tasks.list())
    await (f.tasks as unknown as TaskContext).write({ ...task, status: "done" });
  vi.spyOn(internal, "finalWorkspaceFingerprint").mockResolvedValue("snapshot");
  await f.tick();
  const final = (await f.goals.list())[0];
  expect({ status: final.status, error: final.error, final: final.finalAcceptance }).toMatchObject({
    status: "running",
    final: { status: "running" },
  });
  expect(routingRun(final).finalReviewTarget?.model).toBe("claude:final");
  expect(await internal.finalReviewOwnsSession(final)).toBe(true);
  expect((await f.store.session(final.finalAcceptance!.sessionId!)).session.model).toBe(
    "claude:final",
  );
});

it("keeps explicit goal planner fixed and layers delegation", async () => {
  order();
  const f = await fixture();
  const goal = await f.goals.create({
    ...f.input(),
    projectIds: [f.project.id],
    leadProjectId: f.project.id,
    modelChoice: { kind: "default" },
    plannerExecution: { harness: "claude", model: "claude:explicit", modelSettings: {} },
  });
  expect(routingRun(goal).plannerTarget).toMatchObject({
    model: "claude:explicit",
    modelSettings: { crossSubagents: "auto" },
  });
});

it("routes steward account and copies choice and account into proposals", async () => {
  order();
  const f = await fixture();
  await f.stewards.save({
    ...f.input(),
    scheduleKind: "daily",
    time: "09:00",
    modelChoice: { kind: "default" },
  });
  await f.stewards.runNow("item");
  const steward = (await f.stewards.list())[0];
  expect(steward).toMatchObject({ model: "claude:routed", providerAccountId: "work" });
  expect((await f.store.session(steward.run!.sessionId!)).session.providerAccountId).toBe("work");
  const internal = f.stewards as unknown as {
    propose(steward: unknown, reply: string): Promise<number>;
  };
  // Proposal parsing and saving run through the production method.
  await internal.propose(
    steward,
    '```json\n{"proposals":[{"title":"Next task","description":"Do the work"}]}\n```',
  );
  expect((await f.tasks.list())[0]).toMatchObject({
    modelChoice: { kind: "default" },
    providerAccountId: "work",
  });
});

it("holds goal planning and steward runs until routing becomes eligible", async () => {
  order();
  eligible = false;
  const f = await fixture();
  const goal = await f.goals.create({
    ...f.input(),
    projectIds: [f.project.id],
    leadProjectId: f.project.id,
    modelChoice: { kind: "default" },
  });
  expect(goal).toMatchObject({
    status: "planning",
    error: expect.stringContaining("no eligible entry"),
  });
  expect(goal.plannerSessionId).toBeUndefined();
  await f.stewards.save({
    ...f.input({ id: "steward" }),
    scheduleKind: "daily",
    time: "09:00",
    modelChoice: { kind: "default" },
  });
  await f.stewards.runNow("steward");
  expect((await f.stewards.list())[0]).toMatchObject({ lastRunStatus: "skipped", nextRunAt: 2000 });
  expect(await f.store.sessions()).toHaveLength(0);
  eligible = true;
  f.setNow(2000);
  await f.tick();
  await f.stewards.tick();
  expect((await f.goals.list())[0].plannerSessionId).toBeTruthy();
  expect((await f.stewards.list())[0].run?.sessionId).toBeTruthy();
});

it("preserves caller account when conversation tool creates a fixed steward", async () => {
  const f = await fixture();
  const caller = await f.tasks.save(f.input());
  await f.tick();
  const task = (await f.tasks.get(caller.id))!;
  const session = (await f.store.session(task.sessionId!)).session;
  const tools = new ConversationStewardTools(f.store, f.stewards, f.tasks);
  await tools.call(
    "stewards.create",
    { stewardId: "from-chat", scheduleKind: "daily" },
    { kind: "session", provider: "claude", projectId: f.project.id, sessionId: task.sessionId! },
    session,
    () => true,
  );
  const steward = (await f.stewards.list())[0];
  expect(steward).toMatchObject({ providerAccountId: "personal", model: "claude:stored" });
  await f.stewards.runNow(steward.id);
  const started = (await f.stewards.list())[0];
  expect((await f.store.session(started.run!.sessionId!)).session.providerAccountId).toBe(
    "personal",
  );
});

const ENTRIES = [
  {
    id: "first",
    harness: "claude" as const,
    providerAccountId: "work",
    model: "claude:first",
    modelSettings: { effort: "high" },
    unknownLimit: "use" as const,
    minRemainingPercent: 10,
  },
  {
    id: "second",
    harness: "claude" as const,
    providerAccountId: "personal",
    model: "claude:second",
    modelSettings: { effort: "low" },
    unknownLimit: "use" as const,
    minRemainingPercent: 10,
  },
];

describe("who runs the work and with which helpers", () => {
  it("gives a fixed and an order-following task the same helper choice", async () => {
    state.entries = structuredClone(ENTRIES);
    state.delegation.global = { crossSubagents: "auto" };
    const f = await fixture();
    await f.tasks.save(
      f.input({ id: "fixed", modelChoice: { kind: "fixed" }, helpers: { mode: "off" } }),
    );
    await f.tasks.save(
      f.input({ id: "ordered", modelChoice: { kind: "default" }, helpers: { mode: "off" } }),
    );
    await f.tick();
    await f.tick();
    const fixed = (await f.tasks.get("fixed"))!;
    const ordered = (await f.tasks.get("ordered"))!;
    expect(fixed.model).toBe("claude:stored");
    expect(ordered.model).toBe("claude:first");
    // The order-following task must not lose its own "off" to the resolved target's settings.
    expect(fixed.modelSettings.crossSubagents).toBe("[]");
    expect(ordered.modelSettings.crossSubagents).toBe("[]");
    expect(fixed.resolved?.helpers).toMatchObject({
      mode: "off",
      subagents: "off",
      source: "task",
    });
    expect(ordered.resolved?.helpers).toEqual(fixed.resolved?.helpers);
    expect((await f.store.session(ordered.sessionId!)).session.modelSettings.crossSubagents).toBe(
      "[]",
    );
  });

  it("records how the model was chosen, including the entry skipped for quota", async () => {
    state.entries = structuredClone(ENTRIES);
    left = { first: 3, second: 80 };
    const f = await fixture();
    await f.tasks.save(f.input({ modelChoice: { kind: "default" } }));
    await f.tick();
    const task = (await f.tasks.get("item"))!;
    expect(task.model).toBe("claude:second");
    expect(task.resolved).toMatchObject({
      executor: { kind: "agent" },
      role: "task.worker",
      routingSource: { kind: "order", entryId: "second" },
      skipped: [{ entryId: "first", reason: "belowLimit" }],
      target: { harness: "claude", model: "claude:second", providerAccountId: "personal" },
      helpers: { mode: "settings", subagents: "auto", source: "default" },
    });
    expect(task.resolved!.target!.modelSettings).toEqual({ effort: "low" });
  });

  it("does not change a running session when Settings change afterwards", async () => {
    state.entries = structuredClone(ENTRIES);
    state.delegation.global = { crossSubagents: "auto", crossSubagentMaxEffort: "high" };
    const f = await fixture();
    await f.tasks.save(f.input({ modelChoice: { kind: "default" } }));
    await f.tick();
    const before = (await f.tasks.get("item"))!;
    state.delegation.global = { crossSubagents: "[]" };
    state.entries[0].model = "claude:renamed";
    await f.tick();
    const after = (await f.tasks.get("item"))!;
    expect(after.resolved).toEqual(before.resolved);
    expect(after.modelSettings).toEqual(before.modelSettings);
    expect((await f.store.session(after.sessionId!)).session.modelSettings).toMatchObject({
      crossSubagents: "auto",
      crossSubagentMaxEffort: "high",
    });
  });

  it("applies the task's list and effort cap inside Settings' limits", async () => {
    const allowed = { harness: "codex", model: "gpt-6.1" };
    state.entries = structuredClone(ENTRIES);
    state.delegation.accounts["claude\nwork"] = {
      crossSubagents: JSON.stringify([allowed]),
      crossSubagentMaxEffort: "medium",
    };
    const f = await fixture();
    await f.tasks.save(
      f.input({
        modelChoice: { kind: "default" },
        helpers: {
          mode: "use",
          models: [allowed, { harness: "claude", model: "claude:other" }],
          maxEffort: "high",
        },
      }),
    );
    await f.tick();
    const task = (await f.tasks.get("item"))!;
    expect(JSON.parse(task.modelSettings.crossSubagents)).toEqual([allowed]);
    expect(task.modelSettings.crossSubagentMaxEffort).toBe("medium");
    expect(task.resolved?.helpers.limited).toMatch(/outside the allowed list/);
  });

  it("keeps a fixed model even when routing would pick another and never falls back", async () => {
    state.entries = structuredClone(ENTRIES);
    const f = await fixture();
    await f.tasks.save(f.input({ modelChoice: { kind: "fixed" } }));
    await f.tick();
    const task = (await f.tasks.get("item"))!;
    expect(task.model).toBe("claude:stored");
    expect(task.resolved?.routingSource).toEqual({ kind: "fixed" });
    expect(task.resolved?.skipped).toEqual([]);
  });

  it.each([
    { source: { kind: "session", sessionId: "s" } },
    { source: { kind: "voice" } },
    { source: { kind: "room", sessionId: "t" } },
    { source: { kind: "board" } },
  ] as const)("resolves equivalent $source.kind work the same way", async ({ source }) => {
    state.entries = structuredClone(ENTRIES);
    const f = await fixture();
    await createWork(
      { store: f.store, tasks: f.tasks },
      {
        id: "item",
        projectId: f.project.id,
        request: "Inspect routing",
        title: "Routing work",
        source,
        execution: {
          harness: "claude",
          model: "claude:stored",
          modelSettings: {},
          runtimeMode: "auto",
        },
        options: { status: "queued", isolate: false },
      },
      { requestId: "item" },
    );
    await f.tick();
    const { at: _at, ...resolved } = (await f.tasks.get("item"))!.resolved!;
    expect(resolved).toEqual({
      executor: { kind: "agent" },
      helpers: { mode: "settings", source: "default", subagents: "auto" },
      role: "task.worker",
      routingSource: { entryId: "first", kind: "order" },
      skipped: [],
      target: {
        harness: "claude",
        model: "claude:first",
        modelSettings: { effort: "high" },
        providerAccountId: "work",
      },
    });
  });

  it("settles auto to a crew when the decision gate is confident and records why", async () => {
    state.entries = structuredClone(ENTRIES);
    const f = await fixture();
    const start = vi.fn(async () => ({
      sessionId: "coordinator",
      harness: "claude" as const,
      model: "claude:coordinator",
      modelSettings: {},
    }));
    f.tasks.crewRunner = {
      validate: async () => {},
      choices: async () => [{ id: "web", name: "Web crew", summary: "Lead (coordinator)" }],
      start,
      state: async () => ({ status: "active" as const }),
      stop: async () => {},
    };
    f.tasks.executorDecisions = {
      decide: async () => ({
        answers: { executor: { value: "web", confidence: 0.9, sourceId: "s", model: "m" } },
        sourceChain: [],
        durationMs: 1,
      }),
    };
    await f.tasks.save(f.input({ executor: { kind: "auto" }, modelChoice: { kind: "default" } }));
    await f.tick();
    expect(start).toHaveBeenCalledOnce();
    const task = (await f.tasks.get("item"))!;
    expect(task.executor).toEqual({ kind: "auto" });
    expect(task.resolved).toMatchObject({
      executor: { kind: "crew", crewDefinitionId: "web" },
      routingSource: { kind: "crew" },
      helpers: { mode: "settings", subagents: "auto" },
      reason: expect.stringContaining("Chose crew Web crew"),
    });
    expect(task.crewExecutionId).toBeTruthy();
    // No worker session: the crew chose its own members' models.
    expect(await f.store.sessions()).toHaveLength(0);
  });

  it("runs one agent when auto finds no crew that fits", async () => {
    state.entries = structuredClone(ENTRIES);
    const f = await fixture();
    f.tasks.crewRunner = {
      validate: async () => {},
      choices: async () => [],
      start: vi.fn(),
      state: async () => ({ status: "active" as const }),
      stop: async () => {},
    };
    await f.tasks.save(f.input({ executor: { kind: "auto" }, modelChoice: { kind: "default" } }));
    await f.tick();
    const task = (await f.tasks.get("item"))!;
    expect(task.status).toBe("running");
    expect(task.resolved).toMatchObject({
      executor: { kind: "agent" },
      reason: "No crew is available in this project.",
      routingSource: { kind: "order", entryId: "first" },
    });
    expect(f.tasks.crewRunner.start).not.toHaveBeenCalled();
  });

  it("uses the automation role for work an automation created", async () => {
    state.entries = structuredClone(ENTRIES);
    state.roles.automation = {
      kind: "fixed",
      target: { harness: "claude", model: "claude:automation", modelSettings: {} },
    };
    const f = await fixture();
    await createWork(
      { store: f.store, tasks: f.tasks },
      {
        id: "item",
        projectId: f.project.id,
        request: "Nightly check",
        title: "Nightly",
        source: { kind: "automation", automationRunId: "run" },
        execution: {
          harness: "claude",
          model: "claude:stored",
          modelSettings: {},
          runtimeMode: "auto",
        },
        options: { status: "queued", isolate: false, source: "automation" },
      },
      { requestId: "run" },
    );
    await f.tick();
    const task = (await f.tasks.get("item"))!;
    expect(task.model).toBe("claude:automation");
    expect(task.resolved).toMatchObject({ role: "automation", routingSource: { kind: "fixed" } });
  });
});
