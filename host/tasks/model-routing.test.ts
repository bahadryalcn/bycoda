import type { TaskContext } from "./context";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

const routing = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../model-routing/runtime", () => ({ hostModelRoutingService: () => routing }));

const cleanups: (() => Promise<void>)[] = [];
let state: ModelRoutingDraft;
let eligible = true;
beforeEach(() => {
  state = structuredClone(EMPTY_MODEL_ROUTING);
  eligible = true;
  routing.resolve.mockReset().mockImplementation(async (input: ModelRoutingResolveInput) =>
    selectModelRouting(state, input, {
      available: () => true,
      signedIn: () => true,
      quota: () => ({ leftPercent: eligible ? 100 : 0, resetsAt: 2000 }),
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
  state.delegation.global = { crossSubagents: "true" };
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
        modelSettings: { crossSubagents: "true" },
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
    modelSettings: { crossSubagents: "true" },
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
    startFinalReview(goal: unknown, now: number): Promise<void>;
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
  const current = (await f.goals.list())[0];
  await internal.startFinalReview(current, 1002);
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
    modelSettings: { crossSubagents: "true" },
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
