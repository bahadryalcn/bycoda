import { afterEach, describe, expect, it, vi } from "vitest";

// Each planner and worker turn also captures a real workspace checkpoint.
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostGoals } from "./goals";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MINUTE = 60_000;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();

type PlanTask = {
  key: string;
  project: string;
  title?: string;
  prompt?: string;
  dependsOn?: string[];
};

/** A planner reply ending in the plan. */
const planReply = (tasks: PlanTask[]) =>
  [
    "I read the projects. Here is the plan.",
    "",
    "```json",
    JSON.stringify({
      tasks: tasks.map((task) => ({
        title: `Do ${task.key}`,
        prompt: `Instructions for ${task.key}`,
        dependsOn: [],
        ...task,
      })),
    }),
    "```",
  ].join("\n");

function setup() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-goals-test-")));
  const store = new HostStore(join(directory, "host.db"));
  const addProject = (name: string) => {
    const cwd = join(directory, name);
    mkdirSync(cwd);
    // These goals request isolated tasks, which require a real Git root.
    git(cwd, "init", "-q");
    git(cwd, "checkout", "-q", "-b", "main");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.test");
    git(cwd, "config", "core.autocrlf", "false");
    writeFileSync(join(cwd, "file.txt"), "initial\n");
    git(cwd, "add", "file.txt");
    git(cwd, "commit", "-q", "-m", "initial");
    return store.addProject(cwd, name);
  };
  const addRepo = addProject;
  const turns: Array<{
    input: SendTurnInput;
    runId?: string;
    finish: () => void;
    fail: (error: Error) => void;
  }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve, reject) => {
          turns.push({
            input,
            runId: store.session(input.sessionId).runId,
            finish: resolve,
            fail: reject,
          });
        }),
    ),
    cancel: vi.fn(async (sessionId) => {
      turns.findLast((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    stop: vi.fn(async (sessionId) => {
      turns.findLast((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  const clock = { now: new Date("2026-10-05T08:00:00").getTime() };
  const tasks = new HostTasks(store, engine, () => clock.now);
  const goals = new HostGoals(store, engine, tasks, () => clock.now);
  const providersStarted = async () => {
    await vi.waitFor(
      () => {
        for (const value of store.sessions().filter((entry) => entry.status === "running")) {
          expect(turns.findLast((turn) => turn.input.sessionId === value.session.id)?.runId).toBe(
            value.runId,
          );
        }
      },
      { timeout: 10_000 },
    );
  };
  const tick = tasks.tick.bind(tasks);
  vi.spyOn(tasks, "tick").mockImplementation(async () => {
    await tick();
    // Checkpoint capture completes before the provider receives the new turn.
    await providersStarted();
  });
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await tasks.idle();
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const lead = addProject("lead");
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "goal",
    title: "Launch the beta",
    prompt: "Ship the beta across the app and the API",
    projectIds: [lead.id],
    leadProjectId: lead.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    // The reviewer has tests of its own.
    verifyDefaults: { review: false },
    ...overrides,
  });
  const goal = (id = "goal") => goals.list().find((entry) => entry.id === id)!;
  const task = (id: string) => tasks.list().find((entry) => entry.id === id)!;
  /** The goal's tasks by plan key. */
  const planned = (id = "goal") => {
    const current = goal(id);
    return Object.fromEntries(
      current.plan!.tasks.map((entry, index) => [entry.key, task(current.taskIds[index])]),
    );
  };
  const turnOf = (sessionId: string) =>
    turns.findLast((turn) => turn.input.sessionId === sessionId)!;
  const settled = (sessionId: string) =>
    vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 10_000 });
  /** A minute later: settles what finished and starts what can start. */
  const advance = async () => {
    clock.now += MINUTE;
    await tasks.tick();
    await tasks.idle();
    // Verification may have started a reviewer after tick() returned.
    await providersStarted();
  };
  /** Ends a session's turn cleanly, optionally with a reply, and settles it. */
  const finish = async (sessionId: string, reply?: string) => {
    const turn = turnOf(sessionId);
    if (reply !== undefined) {
      turn.input.onEvent({ type: "message.delta", text: reply });
      turn.input.onEvent({ type: "message.completed" });
    }
    turn.finish();
    await settled(sessionId);
    await advance();
  };
  /** Creates a goal and waits for its planner's turn. */
  const create = async (overrides: Record<string, unknown> = {}) => {
    const expected = turns.length + 1;
    const created = goals.create(input(overrides));
    // Real Git checkpoint capture precedes the provider call for repository goals.
    await vi.waitFor(() => expect(turns).toHaveLength(expected), { timeout: 10_000 });
    return created;
  };
  /** Creates a goal whose planner replies with `reply`. */
  const plan = async (reply: string, overrides: Record<string, unknown> = {}) => {
    const created = await create(overrides);
    await finish(created.plannerSessionId!, reply);
    return goal(created.id);
  };
  return {
    store,
    engine,
    provider,
    turns,
    clock,
    tasks,
    goals,
    lead,
    input,
    goal,
    task,
    planned,
    turnOf,
    settled,
    advance,
    finish,
    create,
    plan,
    addProject,
    addRepo,
  };
}

describe("editing goal settings", () => {
  it("reuses the task index across goal polls and refreshes it after task writes", async () => {
    const { store, tasks, goals, input, lead } = setup();
    tasks.save({ ...input(), id: "waiting", projectId: lead.id, status: "todo" });
    store.db.prepare("INSERT INTO goals VALUES (?, ?)").run(
      "goal",
      JSON.stringify({
        ...input(),
        status: "running",
        taskIds: ["waiting"],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const list = vi.spyOn(tasks, "list");
    expect(goals.list()[0].status).toBe("running");
    expect(goals.list()[0].status).toBe("running");
    expect(list).toHaveBeenCalledTimes(1);
    tasks.save({ ...input(), id: "waiting", projectId: lead.id, title: "Changed" });
    // save() independently reads current tasks to validate dependency cycles.
    // Count goal polling itself: one refresh after a write, then shared reads.
    list.mockClear();
    goals.list();
    goals.list();
    expect(list).toHaveBeenCalledTimes(1);
    await tasks.delete("waiting");
    list.mockClear();
    expect(goals.list()[0].status).toBe("blocked");
    goals.list();
    expect(list).toHaveBeenCalledTimes(1);
  });

  function seeded() {
    const env = setup();
    vi.mocked(env.tasks.tick).mockResolvedValue();
    const original = {
      ...env.input(),
      approvePlan: false,
      status: "running",
      taskIds: ["waiting", "reviewed", "active", "stopped", "finished"],
      createdAt: 1,
      updatedAt: 2,
    };
    env.store.db.prepare("INSERT INTO goals VALUES (?, ?)").run("goal", JSON.stringify(original));
    for (const [id, status] of [
      ["waiting", "queued"],
      ["reviewed", "review"],
      ["active", "running"],
      ["stopped", "blocked"],
      ["finished", "done"],
    ]) {
      const saved = env.tasks.save({
        ...env.input(),
        id,
        projectId: env.lead.id,
        goalId: "goal",
        isolate: true,
        review: true,
        maxRunMinutes: 10,
        status: "todo",
      });
      env.store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
        JSON.stringify({
          ...saved,
          status,
          dependsOn: ["reviewed"],
          awaitingOwnerRestart: status === "blocked",
          verification: { review: { verdict: "pass", sessionId: "review-session", note: "" } },
        }),
        id,
      );
    }
    return { ...env, original };
  }
  const settings = {
    autoMerge: true,
    continueUntilDone: true,
    maxRunningTasks: 2,
    maxRunMinutes: 30,
  };

  it("applies settings to unfinished tasks while retaining review, dependencies and owner stops", () => {
    const { goals, tasks, original } = seeded();
    const before = tasks.list();
    const saved = goals.update("goal", settings, original.updatedAt);
    expect(saved).toMatchObject({ ...settings, status: "running", taskIds: original.taskIds });
    for (const id of ["waiting", "reviewed", "active", "stopped"]) {
      const task = tasks.get(id)!;
      const old = before.find((entry) => entry.id === id)!;
      expect(task).toMatchObject({
        autoMerge: true,
        continueUntilDone: true,
        status: old.status,
        dependsOn: old.dependsOn,
        verification: old.verification,
        runtimeMode: old.runtimeMode,
        model: old.model,
        review: true,
      });
      expect(task.maxRunMinutes).toBe(id === "active" ? 10 : 30);
    }
    expect(tasks.get("stopped")?.awaitingOwnerRestart).toBe(true);
    expect(tasks.get("finished")).toEqual(before.find((task) => task.id === "finished"));
    const disabled = goals.update(
      "goal",
      { ...settings, autoMerge: false, continueUntilDone: false, maxRunningTasks: 0 },
      saved.updatedAt,
    );
    expect(disabled.autoMerge).toBeUndefined();
    expect(disabled.maxRunningTasks).toBeUndefined();
    expect(tasks.get("reviewed")?.autoMerge).toBeUndefined();
  });

  it("rejects stale or invalid updates without partially changing tasks", () => {
    const { goals, tasks } = seeded();
    const before = tasks.list();
    expect(() => goals.update("goal", settings, 1)).toThrow("This goal changed");
    expect(() => goals.update("goal", { ...settings, maxRunningTasks: 99 }, 2)).toThrow(
      "Invalid goal concurrency",
    );
    expect(() => goals.update("goal", { ...settings, runtimeMode: "full-access" }, 2)).toThrow(
      "Invalid goal settings",
    );
    expect(tasks.list()).toEqual(before);
  });

  it("preserves individual task settings when the corresponding goal setting is unchanged", () => {
    const { goals, tasks } = seeded();
    goals.update("goal", { ...settings, continueUntilDone: false, maxRunMinutes: 0 }, 2);
    expect(tasks.get("waiting")?.maxRunMinutes).toBe(10);
    expect(tasks.get("stopped")?.awaitingOwnerRestart).toBe(true);
    expect(tasks.get("waiting")?.continueUntilDone).toBeUndefined();
    expect(tasks.get("waiting")?.autoMerge).toBe(true);
  });

  it("rolls back all task updates if one write fails", () => {
    const { goals, tasks, store } = seeded();
    const before = tasks.list();
    store.db.exec(
      "CREATE TRIGGER reject_goal_task BEFORE UPDATE ON tasks WHEN NEW.id = 'reviewed' BEGIN SELECT RAISE(ABORT, 'write rejected'); END",
    );
    expect(() => goals.update("goal", settings, 2)).toThrow("write rejected");
    expect(tasks.list()).toEqual(before);
    expect(goals.list()[0].autoMerge).toBeUndefined();
  });

  it("rejects automatic merge for a shared checkout and edits to finished goals", () => {
    const { goals, store, original } = seeded();
    const replace = (patch: Record<string, unknown>) =>
      store.db
        .prepare("UPDATE goals SET value=? WHERE id='goal'")
        .run(JSON.stringify({ ...original, ...patch }));
    replace({ isolate: false });
    expect(() => goals.update("goal", settings, 2)).toThrow(
      "Automatic merge requires isolated tasks",
    );
    for (const status of ["done", "cancelled"]) {
      replace({ status });
      expect(() => goals.update("goal", settings, 2)).toThrow("Only an active goal");
    }
  });

  it("delivers an already reviewed branch and releases its queued dependency", async () => {
    const { addRepo, plan, finish, planned, goals, goal, tasks } = setup();
    const repo = addRepo("edit-delivery");
    await plan(
      planReply([
        { key: "one", project: repo.cwd },
        { key: "two", project: repo.cwd, dependsOn: ["one"] },
      ]),
      { projectIds: [repo.id], leadProjectId: repo.id },
    );
    const first = planned().one;
    writeFileSync(join(first.worktreeCwd!, "result.txt"), "reviewed result\n");
    await finish(first.sessionId!);
    expect(planned().one.status).toBe("review");
    expect(planned().two.status).toBe("queued");
    goals.update("goal", { ...settings, maxRunMinutes: 0 }, goal().updatedAt);
    await tasks.idle();
    expect(planned().one).toMatchObject({ status: "done", merged: true, autoMerged: true });
    expect(planned().two.status).toBe("running");
    expect(readFileSync(join(repo.cwd, "result.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "reviewed result\n",
    );
  });
});

describe("goal workspace and scheduling choices", () => {
  it("plans in the selected checkout and leaves manually started tasks in todo", async () => {
    const { addRepo, plan, tasks, turns } = setup();
    const repo = addRepo("workspace");
    const checkout = join(repo.cwd, "..", "integration");
    git(repo.cwd, "worktree", "add", "-q", "-b", "goal/settings", checkout, "HEAD");
    const goal = await plan(
      planReply([
        { key: "first", project: repo.cwd },
        { key: "next", project: repo.cwd, dependsOn: ["first"] },
      ]),
      {
        projectIds: [repo.id],
        leadProjectId: repo.id,
        manualStart: true,
        maxRunningTasks: 1,
        workspaces: { [repo.id]: { checkoutCwd: checkout, baseBranch: "goal/settings" } },
      },
    );
    expect(goal).toMatchObject({ status: "running", manualStart: true, maxRunningTasks: 1 });
    expect(turns[0].input.cwd).toBe(checkout);
    expect(turns[0].input.text).toContain(
      `Read workspace from the selected working copy at ${checkout}`,
    );
    expect(tasks.list()).toHaveLength(2);
    expect(tasks.list().every((task) => task.status === "todo")).toBe(true);
    expect(tasks.list()[0].workspace).toMatchObject({ checkoutCwd: checkout });
    await tasks.startTask(goal.taskIds[1]);
    expect(tasks.get(goal.taskIds[1])?.status).toBe("queued");
    await tasks.startTask(goal.taskIds[0]);
    expect(tasks.get(goal.taskIds[0])?.status).toBe("running");
  }, 60_000);

  it("caps one goal without consuming another goal's available capacity", async () => {
    const { lead, addProject, plan, tasks, input } = setup();
    const api = addProject("api");
    const goal = await plan(
      planReply([
        { key: "app", project: lead.cwd },
        { key: "api", project: api.cwd },
      ]),
      {
        projectIds: [lead.id, api.id],
        maxRunningTasks: 1,
      },
    );
    expect(
      tasks.list().filter((task) => task.goalId === goal.id && task.status === "running"),
    ).toHaveLength(1);
    const independent = addProject("independent");
    const spec = input();
    tasks.save({
      id: "independent",
      title: "Other work",
      prompt: "Independent task",
      projectId: independent.id,
      harness: spec.harness,
      model: spec.model,
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      review: false,
    });
    await tasks.tick();
    expect(tasks.get("independent")?.status).toBe("running");
    expect(
      tasks.list().filter((task) => task.goalId === goal.id && task.status === "queued"),
    ).toHaveLength(1);
  });
});

describe("goal planning", () => {
  it("rolls back every queued task when plan approval cannot save the complete batch", async () => {
    const { goals, lead, plan, tasks, goal } = setup();
    await plan(
      planReply([
        { key: "one", project: lead.cwd },
        { key: "two", project: lead.cwd, dependsOn: ["one"] },
      ]),
      { approvePlan: true },
    );
    const save = tasks.save.bind(tasks);
    let count = 0;
    const spy = vi.spyOn(tasks, "save").mockImplementation((input) => {
      if (++count === 2) throw new Error("Task persistence unavailable");
      return save(input);
    });
    try {
      expect(() => goals.approve("goal")).toThrow("Task persistence unavailable");
      expect(tasks.list()).toEqual([]);
      expect(goal()).toMatchObject({ status: "awaiting-approval", taskIds: [] });
    } finally {
      spy.mockRestore();
    }
  });
  it("plans in the lead project and creates the plan's tasks", async () => {
    const { goals, lead, addProject, create, finish, goal, planned, store, turns, turnOf } =
      setup();
    const api = addProject("api");
    const created = await create({
      projectIds: [lead.id, api.id],
      verifyDefaults: {
        review: false,
        verifyCommand: { [api.id]: "npm test" },
      },
    });
    expect(created).toMatchObject({ status: "planning", taskIds: [] });
    expect(goals.list()).toEqual([expect.objectContaining({ id: "goal" })]);
    const planner = store.session(created.plannerSessionId!).session;
    expect(planner).toMatchObject({
      title: "Plan: Launch the beta",
      cwd: lead.cwd,
    });
    const prompt = turns[0].input.text;
    expect(prompt).toContain("Job: Launch the beta");
    expect(prompt).toContain("Ship the beta across the app and the API");
    expect(prompt).toContain(`- lead: ${lead.cwd}`);
    expect(prompt).toContain(`- api: ${api.cwd}`);
    expect(prompt).toContain("Only read");
    expect(prompt).toContain('{"tasks":[{"key":"short-id"');

    await finish(
      created.plannerSessionId!,
      planReply([
        { key: "api", project: api.cwd },
        { key: "app", project: lead.cwd, dependsOn: ["api"] },
      ]),
    );
    expect(goal()).toMatchObject({ status: "running" });
    expect(goal().taskIds).toHaveLength(2);
    expect(goal().plan!.tasks.map((entry) => entry.projectId)).toEqual([api.id, lead.id]);
    const { api: first, app: second } = planned();
    expect(first).toMatchObject({
      title: "Do api",
      prompt: "Instructions for api",
      projectId: api.id,
      goalId: "goal",
      harness: "claude",
      model: "claude:test",
      runtimeMode: "auto",
      isolate: true,
      review: false,
      verifyCommand: "npm test",
      status: "running",
    });
    expect(first.dependsOn).toBeUndefined();
    expect(second).toMatchObject({
      projectId: lead.id,
      dependsOn: [first.id],
      status: "queued",
    });
    expect(second.verifyCommand).toBeUndefined();
    const workerPrompt = turnOf(first.sessionId!).input.text;
    expect(
      JSON.parse(workerPrompt.slice(workerPrompt.indexOf("{"))).task.instructions.objective,
    ).toBe("Instructions for api");
  });

  it("waits for the owner to approve the plan when asked to", async () => {
    const { goals, lead, plan, goal, tasks, turns, advance } = setup();
    const waiting = await plan(planReply([{ key: "one", project: lead.cwd }]), {
      approvePlan: true,
    });
    expect(waiting.status).toBe("awaiting-approval");
    expect(waiting.plan!.tasks).toMatchObject([{ key: "one", title: "Do one" }]);
    expect(tasks.list()).toEqual([]);
    await advance();
    expect(goal().status).toBe("awaiting-approval");

    const approved = goals.approve("goal");
    expect(approved.status).toBe("running");
    expect(approved.taskIds).toHaveLength(1);
    await tasks.tick();
    expect(turns).toHaveLength(2);
    await tasks.idle();
    expect(tasks.list()[0].status).toBe("running");
    expect(() => goals.approve("goal")).toThrow(
      "Only a plan waiting for approval can be approved.",
    );
  });

  it.each([
    ["no plan at all", () => "I could not decide.", "has no ```json block"],
    ["invalid JSON", () => "```json\n{tasks: []}\n```", "The plan is not valid JSON"],
    ["no tasks", () => '```json\n{"tasks":[]}\n```', "The plan has no tasks."],
    [
      "a project not in the goal",
      () => planReply([{ key: "one", project: "/somewhere/else" }]),
      "Task “one” is for “/somewhere/else”, which is not one of this goal’s projects.",
    ],
    [
      "a dependency cycle",
      (cwd: string) =>
        planReply([
          { key: "a", project: cwd, dependsOn: ["b"] },
          { key: "b", project: cwd, dependsOn: ["a"] },
        ]),
      "The plan’s dependencies form a cycle: a → b → a.",
    ],
  ])("blocks a goal whose planner gave %s", async (_, reply, error) => {
    const { lead, plan, tasks } = setup();
    const blocked = await plan(reply(lead.cwd));
    expect(blocked.status).toBe("blocked");
    expect(blocked.planError).toContain(error);
    expect(blocked.taskIds).toEqual([]);
    expect(tasks.list()).toEqual([]);
  });

  it("reads a plan the planner wrote in plan mode or before its last message", async () => {
    const { lead, create, turnOf, settled, advance, goal } = setup();
    const created = await create();
    const turn = turnOf(created.plannerSessionId!);
    turn.input.onEvent({
      type: "plan",
      text: planReply([{ key: "one", project: lead.cwd }]),
    });
    turn.input.onEvent({ type: "message.delta", text: "The plan is ready." });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await settled(created.plannerSessionId!);
    await advance();
    expect(goal()).toMatchObject({ status: "running" });
    expect(goal().plan!.tasks).toMatchObject([{ key: "one" }]);

    const split = await create({ id: "split" });
    const second = turnOf(split.plannerSessionId!);
    second.input.onEvent({
      type: "message.delta",
      text: planReply([{ key: "two", project: lead.cwd }]),
    });
    second.input.onEvent({ type: "message.completed" });
    second.input.onEvent({ type: "message.delta", text: "Done." });
    second.input.onEvent({ type: "message.completed" });
    second.finish();
    await settled(split.plannerSessionId!);
    await advance();
    expect(goal("split").plan!.tasks).toMatchObject([{ key: "two" }]);
  });

  it("blocks a goal whose planner run failed", async () => {
    const { create, turnOf, settled, advance, goal } = setup();
    const created = await create();
    turnOf(created.plannerSessionId!).fail(new Error("Not signed in"));
    await settled(created.plannerSessionId!);
    await advance();
    expect(goal()).toMatchObject({
      status: "blocked",
      planError: "The planner failed: Not signed in",
    });
  });

  it("repairs invalid plans in the existing conversation and inherits continuous execution", async () => {
    const { create, goal, finish, turns, lead, tasks } = setup();
    const created = await create({ continueUntilDone: true });
    await finish(created.plannerSessionId!, "The plan is ready, without JSON.");
    expect(goal()).toMatchObject({
      status: "planning",
      plannerSessionId: created.plannerSessionId,
      plannerRepairAttempts: 1,
    });
    expect(turns.at(-1)!.input.text).toContain("has no ```json block");
    expect(tasks.list()).toEqual([]);
    await finish(created.plannerSessionId!, planReply([{ key: "one", project: lead.cwd }]));
    expect(goal().status).toBe("running");
    expect(tasks.list()[0]).toMatchObject({ continueUntilDone: true, status: "running" });
  });

  it("bounds planner format repairs and resets their budget when the owner replans", async () => {
    const { create, goal, finish, turns, goals } = setup();
    const created = await create({ continueUntilDone: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await finish(created.plannerSessionId!, "No JSON plan.");
      expect(goal()).toMatchObject({ status: "planning", plannerRepairAttempts: attempt });
    }
    await finish(created.plannerSessionId!, "Still no JSON plan.");
    expect(goal().status).toBe("blocked");
    expect(turns).toHaveLength(3);
    const replanned = goals.replan("goal", "Use one concrete task.");
    expect(replanned.plannerRepairAttempts).toBeUndefined();
    expect(replanned.plannerRecoveryPending).toBeUndefined();
  });

  it("resumes only a trusted planner interruption and waits for available daily time", async () => {
    const { create, goal, turns, turnOf, settled, store, tasks, advance, clock } = setup();
    const created = await create({ continueUntilDone: true });
    const sessionId = created.plannerSessionId!;
    turnOf(sessionId).finish();
    await settled(sessionId);
    const session = store.session(sessionId);
    store.save(
      {
        ...session,
        revision: session.revision + 1,
        status: "interrupted",
        session: {
          ...session.session,
          blocks: [
            ...session.session.blocks,
            {
              id: "host-stop",
              role: "system",
              text: "Host restarted. This turn was interrupted; inspect its work before continuing.",
            },
          ],
        },
      },
      { type: "interrupted" },
    );
    tasks.limits.save({ dailyAgentMinutes: 1 });
    tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await advance();
    expect(goal()).toMatchObject({
      status: "planning",
      plannerRecoveryPending: true,
      plannerSessionId: sessionId,
    });
    expect(turns).toHaveLength(1);
    tasks.limits.save({ dailyAgentMinutes: 0 });
    await advance();
    expect(goal()).toMatchObject({ status: "planning", plannerSessionId: sessionId });
    expect(goal().plannerRecoveryPending).toBeUndefined();
    expect(goal().plannerRepairAttempts).toBe(0);
    expect(turns).toHaveLength(2);
    expect(turns.at(-1)!.input.text).toContain("existing read-only planning conversation");
  });

  it("never revives an owner stop or an untrusted interrupted planner", async () => {
    const { create, goal, turnOf, settled, store, advance, turns, engine } = setup();
    const stopped = await create({ continueUntilDone: true });
    engine.command({
      type: "cancel",
      commandId: "stop-planner",
      sessionId: stopped.plannerSessionId!,
      runId: stopped.plannerRunId,
    });
    await settled(stopped.plannerSessionId!);
    await advance();
    expect(goal()).toMatchObject({ status: "blocked", planError: "Stopped by you." });
    const broken = await create({ id: "broken", continueUntilDone: true });
    turnOf(broken.plannerSessionId!).finish();
    await settled(broken.plannerSessionId!);
    const session = store.session(broken.plannerSessionId!);
    store.save(
      {
        ...session,
        revision: session.revision + 1,
        status: "interrupted",
        session: {
          ...session.session,
          blocks: [
            ...session.session.blocks,
            { id: "write-failure", role: "system", text: "Session persistence failed." },
          ],
        },
      },
      { type: "interrupted" },
    );
    await advance();
    expect(goal("broken").status).toBe("blocked");
    expect(turns).toHaveLength(2);
  });

  it("plans again with the owner's feedback", async () => {
    const { goals, lead, plan, goal, turns, finish } = setup();
    const blocked = await plan("No plan, sorry.");
    expect(blocked.status).toBe("blocked");

    const again = goals.replan("goal", "  Split the work by folder.  ");
    expect(again).toMatchObject({
      status: "planning",
      feedback: "Split the work by folder.",
    });
    expect(again.planError).toBeUndefined();
    expect(again.plannerSessionId).not.toBe(blocked.plannerSessionId);
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toContain(
      "The owner's feedback on an earlier plan:\nSplit the work by folder.",
    );
    await finish(again.plannerSessionId!, planReply([{ key: "one", project: lead.cwd }]));
    expect(goal().status).toBe("running");
    expect(() => goals.replan("goal")).toThrow(
      "Only a goal whose plan was not started can be planned again.",
    );
  });

  it("rejects a goal for a project this machine does not have", () => {
    const { goals, input, lead } = setup();
    expect(() => goals.create(input({ projectIds: [lead.id, "missing"] }))).toThrow(
      "Project is not registered on this machine",
    );
    expect(() => goals.create(input({ leadProjectId: "other" }))).toThrow(
      "The lead project must be one of the goal’s projects.",
    );
    expect(goals.list()).toEqual([]);
  });
});

describe("goal tasks", () => {
  it(
    "starts a dependent task once its dependency is merged, from the merged HEAD",
    async () => {
      const { goals, lead, addRepo, plan, planned, tasks, turns, turnOf, finish } = setup();
      const repo = addRepo("repo");
      await plan(
        planReply([
          { key: "a", project: repo.cwd },
          { key: "b", project: repo.cwd, dependsOn: ["a"] },
        ]),
        { projectIds: [lead.id, repo.id] },
      );
      let { a, b } = planned();
      expect(a.status).toBe("running");
      expect(b.status).toBe("queued");
      expect(turns).toHaveLength(2);

      writeFileSync(join(turnOf(a.sessionId!).input.cwd, "from-a.txt"), "A\n");
      await finish(a.sessionId!);
      ({ a, b } = planned());
      expect(a.status).toBe("review");
      // Still waiting: review is not done.
      expect(b.status).toBe("queued");

      await tasks.move(a.id, "done");
      await tasks.tick();
      await vi.waitFor(() => expect(turns).toHaveLength(3));
      ({ b } = planned());
      expect(b.status).toBe("running");
      expect(b.baseCommit).toBe(git(repo.cwd, "rev-parse", "HEAD"));
      expect(existsSync(join(b.worktreeCwd!, "from-a.txt"))).toBe(true);
      expect(goals.list()[0].status).toBe("running");
      // This scenario creates two worktrees and merges a real branch.
    },
    process.platform === "win32" ? 60_000 : 5_000,
  );

  it("keeps dependents queued behind a blocked task and blocks the goal", async () => {
    const { lead, addProject, plan, planned, tasks, turnOf, settled, advance, goal, turns } =
      setup();
    const api = addProject("api");
    await plan(
      planReply([
        { key: "a", project: api.cwd },
        { key: "b", project: lead.cwd, dependsOn: ["a"] },
        { key: "c", project: lead.cwd, dependsOn: ["b"] },
      ]),
      { projectIds: [lead.id, api.id] },
    );
    let { a, b, c } = planned();
    turnOf(a.sessionId!).fail(new Error("Not signed in"));
    await settled(a.sessionId!);
    await advance();
    ({ a, b, c } = planned());
    expect(a.status).toBe("blocked");
    expect(b.status).toBe("queued");
    expect(c.status).toBe("queued");
    expect(goal()).toMatchObject({
      status: "blocked",
      error: "1 of 3 tasks blocked: Do a",
    });

    // Retrying the blocked task takes the goal up again.
    await tasks.move(a.id, "queued");
    expect(goal().status).toBe("running");
    expect(goal().error).toBeUndefined();
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect(planned().a.status).toBe("running");
  });

  it.each([false, true])(
    "recovers legacy review failures only for active goals (cancelled: %s)",
    async (cancelled) => {
      const { lead, plan, planned, finish, store, goals, goal, tasks } = setup();
      await plan(
        planReply([
          { key: "a", project: lead.cwd },
          { key: "b", project: lead.cwd, dependsOn: ["a"] },
        ]),
        { verifyDefaults: { review: true } },
      );
      await finish(planned().a.sessionId!);
      const reviewing = planned().a;
      // Simulate a persisted failure from a host predating automatic correction.
      store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify({ ...reviewing, goalId: undefined, source: undefined }), reviewing.id);
      await finish(reviewing.reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
      const legacy = { ...tasks.get(reviewing.id)!, goalId: "goal" };
      if (cancelled) await goals.cancel("goal");
      store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify(legacy), legacy.id);
      await tasks.tick();
      expect(goal().status).toBe(cancelled ? "cancelled" : "running");
      expect(planned().a.status).toBe(cancelled ? "blocked" : "running");
      if (!cancelled) expect(planned().a.blockedTakeover).toBeDefined();
      expect(planned().b.status).toBe(cancelled ? "blocked" : "queued");
    },
  );

  it("is done once every task is done", async () => {
    const { lead, addProject, plan, planned, tasks, finish, goal, advance } = setup();
    const api = addProject("api");
    await plan(
      planReply([
        { key: "a", project: api.cwd },
        { key: "b", project: lead.cwd },
      ]),
      { projectIds: [lead.id, api.id] },
    );
    let { a, b } = planned();
    await finish(a.sessionId!);
    await finish(b.sessionId!);
    ({ a, b } = planned());
    expect([a.status, b.status]).toEqual(["review", "review"]);
    await tasks.move(a.id, "done");
    await advance();
    expect(goal().status).toBe("running");
    await tasks.move(b.id, "done");
    // Listing brings progress up to date without waiting for a tick.
    expect(goal().status).toBe("done");
  });

  it("runs tasks of different projects at once, within the machine's cap", async () => {
    const { lead, addProject, plan, planned, turns } = setup();
    const one = addProject("one");
    const two = addProject("two");
    await plan(
      planReply([
        { key: "a", project: lead.cwd },
        { key: "b", project: one.cwd },
        { key: "c", project: two.cwd },
      ]),
      { projectIds: [lead.id, one.id, two.id] },
    );
    const statuses = Object.values(planned()).map((entry) => entry.status);
    expect(statuses.filter((status) => status === "running")).toHaveLength(2);
    expect(statuses.filter((status) => status === "queued")).toHaveLength(1);
    // The planner, and two tasks.
    expect(turns).toHaveLength(3);
  });

  it("cancels a goal: stops its running tasks and blocks its queued ones", async () => {
    const { goals, lead, addRepo, plan, planned, provider, goal, advance } = setup();
    const repo = addRepo("repo");
    await plan(
      planReply([
        { key: "a", project: repo.cwd },
        { key: "b", project: repo.cwd, dependsOn: ["a"] },
      ]),
      { projectIds: [lead.id, repo.id] },
    );
    const before = planned().a;
    const cancelled = await goals.cancel("goal");
    expect(cancelled.status).toBe("cancelled");
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await advance();
    const { a, b } = planned();
    expect(a).toMatchObject({ status: "blocked", error: "Stopped by you." });
    expect(b).toMatchObject({ status: "blocked", error: "Goal cancelled" });
    expect(goal().status).toBe("cancelled");
    // The branch stays.
    expect(git(repo.cwd, "branch", "--list", before.branch!)).toContain(before.branch);
    await expect(goals.cancel("goal")).rejects.toThrow("This goal is already cancelled.");
  });

  it("cancels a goal while it is planning", async () => {
    const { goals, create, provider, settled, advance, goal } = setup();
    const created = await create();
    await goals.cancel("goal");
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(created.plannerSessionId!);
    await advance();
    expect(goal().status).toBe("cancelled");
  });

  it("deletes a goal with nothing running, leaving its tasks unless told", async () => {
    const { goals, lead, plan, planned, tasks } = setup();
    await plan(planReply([{ key: "a", project: lead.cwd }]), {
      approvePlan: false,
    });
    await expect(goals.delete("goal")).rejects.toThrow(
      "Stop this goal’s running tasks before deleting it.",
    );
    await tasks.move(planned().a.id, "blocked");
    await goals.delete("goal");
    expect(goals.list()).toEqual([]);
    expect(tasks.list()).toHaveLength(1);

    await plan(planReply([{ key: "b", project: lead.cwd }]), { id: "other" });
    const other = planned("other").b;
    await tasks.move(other.id, "blocked");
    await goals.delete("other", true);
    expect(tasks.list().map((entry) => entry.id)).not.toContain(other.id);
  });
});

describe("goal merging and work limits", () => {
  it("runs direct goal tasks concurrently, preserves dirty work and releases dependencies", async () => {
    const { plan, planned, addRepo, finish, goal, advance } = setup();
    const repo = addRepo("direct");
    const head = git(repo.cwd, "rev-parse", "HEAD");
    writeFileSync(join(repo.cwd, "file.txt"), "owner changes\n");
    await plan(
      planReply([
        { key: "one", project: repo.cwd },
        { key: "two", project: repo.cwd },
        { key: "final", project: repo.cwd, dependsOn: ["one", "two"] },
      ]),
      {
        projectIds: [repo.id],
        leadProjectId: repo.id,
        isolate: false,
        autoMerge: true,
        maxRunningTasks: 4,
        workspaces: { [repo.id]: { checkoutCwd: repo.cwd, baseBranch: "main" } },
      },
    );
    expect(planned().one).toMatchObject({ isolate: false, status: "running" });
    expect(planned().one.branch).toBeUndefined();
    expect(planned().one.autoMerge).toBeUndefined();
    expect(planned().two.status).toBe("running");
    writeFileSync(join(repo.cwd, "result.txt"), "first task\n");
    await finish(planned().one.sessionId!);
    await advance();
    expect(planned().one.status).toBe("done");
    expect(planned().two.status).toBe("running");
    expect(planned().final.status).toBe("queued");
    await finish(planned().two.sessionId!);
    await advance();
    expect(planned().final.status).toBe("running");
    await finish(planned().final.sessionId!);
    await advance();
    expect(goal().status).toBe("done");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("owner changes\n");
    expect(readFileSync(join(repo.cwd, "result.txt"), "utf8")).toBe("first task\n");
  });

  it("gives every planned task the goal autoMerge setting", async () => {
    const { plan, planned, lead } = setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]), {
      autoMerge: true,
    });
    expect(planned().one.autoMerge).toBe(true);
  });

  it("leaves autoMerge off by default", async () => {
    const { plan, planned, lead } = setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]));
    expect(planned().one.autoMerge).toBeUndefined();
  });

  it("counts the planner toward the day", async () => {
    const { plan, tasks, lead } = setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]));
    expect(tasks.limits.usedMinutes()).toBeGreaterThan(0);
  });

  it("waits to plan while the day is used up, then plans tomorrow", async () => {
    const { goals, goal, tasks, turns, clock, input } = setup();
    tasks.limits.save({ dailyAgentMinutes: 1 });
    tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    const created = goals.create(input());
    expect(created).toMatchObject({ status: "planning" });
    expect(created.plannerSessionId).toBeUndefined();
    clock.now += MINUTE;
    await tasks.tick();
    expect(turns).toHaveLength(0);
    expect(goal()).toMatchObject({ status: "planning" });

    clock.now += 24 * 60 * MINUTE;
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(goal().plannerSessionId).toBeDefined();
  });
});
