import { mapAsync } from "./async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
// Each planner and worker turn also captures a real workspace checkpoint.
if (process.platform === "win32") vi.setConfig({ testTimeout: 60000 });
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
import type { HostTask } from "../src/features/tasks/model/hostTasks";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const MINUTE = 60000;
it("runs final-result snapshots four at a time without serializing independent reads", async () => {
  const f = await setup();
  const ids = Array.from({ length: 6 }, (_, index) => `result-${index}`);
  const started: string[] = [];
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(f.tasks, "resultFingerprint").mockImplementation(async (task) => {
    started.push(task.id);
    maximum = Math.max(maximum, ++active);
    try {
      if (started.length <= 4) await held;
      return `fingerprint-${task.id}`;
    } finally {
      active--;
    }
  });
  const goals = f.goals as unknown as {
    finalWorkspaceFingerprint(
      goal: { taskIds: string[] },
      tasks: ReadonlyMap<string, HostTask>,
    ): Promise<string | undefined>;
  };
  const pending = goals.finalWorkspaceFingerprint(
    { taskIds: ids },
    new Map(ids.map((id) => [id, { id } as HostTask])),
  );
  try {
    await vi.waitFor(() => expect(started).toEqual(ids.slice(0, 4)));
    expect(maximum).toBe(4);
  } finally {
    release();
  }
  expect(await pending).toBeTruthy();
  expect(started).toEqual(ids);
  expect(maximum).toBe(4);
});
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
async function setup() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-goals-test-")));
  const store = new HostStore(join(directory, "host.db"));
  const addProject = async (name: string) => {
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
    return await store.addProject(cwd, name);
  };
  const addRepo = addProject;
  const turns: Array<{
    input: SendTurnInput;
    runId?: string;
    finish: () => void;
    fail: (error: Error) => void;
  }> = [];
  const provider: HostProvider = {
    send: vi.fn(async (input) => {
      const runId = (await store.session(input.sessionId)).runId;
      return new Promise<void>((resolve, reject) => {
        turns.push({ input, runId, finish: resolve, fail: reject });
      });
    }),
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
  await goals.ready;
  const providersStarted = async () => {
    await vi.waitFor(
      async () => {
        for (const value of (await store.sessions()).filter(
          (entry) => entry.status === "running",
        )) {
          expect(turns.findLast((turn) => turn.input.sessionId === value.session.id)?.runId).toBe(
            value.runId,
          );
        }
      },
      { timeout: 10000 },
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
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const lead = await addProject("lead");
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
  const goal = async (id = "goal") => (await goals.list()).find((entry) => entry.id === id)!;
  const task = async (id: string) => (await tasks.list()).find((entry) => entry.id === id)!;
  /** The goal's tasks by plan key. */
  const planned = async (id = "goal") => {
    const current = await goal(id);
    return Object.fromEntries(
      await mapAsync(current.plan!.tasks, async (entry, index) => [
        entry.key,
        await task(current.taskIds[index]),
      ]),
    );
  };
  const turnOf = (sessionId: string) =>
    turns.findLast((turn) => turn.input.sessionId === sessionId)!;
  const settled = (sessionId: string) =>
    vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"), {
      timeout: 10000,
    });
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
    const created = await goals.create(input(overrides));
    // Real Git checkpoint capture precedes the provider call for repository goals.
    await vi.waitFor(() => expect(turns).toHaveLength(expected), { timeout: 10000 });
    return created;
  };
  /** Creates a goal whose planner replies with `reply`. */
  const plan = async (reply: string, overrides: Record<string, unknown> = {}) => {
    const created = await create(overrides);
    await finish(created.plannerSessionId!, reply);
    return await goal(created.id);
  };
  return {
    store,
    engine,
    provider,
    providersStarted,
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
describe("integrated final goal acceptance", () => {
  async function ready(overrides: Record<string, unknown> = {}) {
    const env = await setup();
    await env.tasks.save({
      id: "delivered",
      title: "Delivered implementation",
      prompt: "Build the requested result",
      projectId: env.lead.id,
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      status: "todo",
      review: false,
    });
    await env.tasks.move("delivered", "done");
    await env.store.db.prepare("INSERT INTO goals VALUES (?, ?)").run(
      "goal",
      JSON.stringify({
        ...(await env.input()),
        finalReview: true,
        status: "running",
        taskIds: ["delivered"],
        approvePlan: false,
        createdAt: env.clock.now,
        updatedAt: env.clock.now,
        ...overrides,
      }),
    );
    await env.advance();
    return env;
  }
  const report = (second = "verified") =>
    "```json\n" +
    JSON.stringify({
      schema: "bycoda.acceptance.v1",
      criteria: [
        { criterionIndex: 0, verdict: "verified", evidence: ["file.txt:1 and original objective"] },
        {
          criterionIndex: 1,
          verdict: second,
          evidence: second === "verified" ? ["Integration check output"] : [],
          note: "Integrated flow checked",
        },
      ],
    }) +
    "\n```\nVERDICT: PASS";
  it("holds done children until independent original-objective and integration proof passes", async () => {
    const f = await ready();
    const before = await f.goal();
    expect(before.status).toBe("running");
    expect(before.finalAcceptance?.status).toBe("running");
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0].input.text).toContain("Ship the beta across the app and the API");
    expect(f.turns[0].input.text).toContain("do not edit files");
    await f.finish(before.finalAcceptance!.sessionId!, report());
    expect(await f.goal()).toMatchObject({
      status: "done",
      finalAcceptance: {
        status: "passed",
        acceptance: {
          criteria: [{ verdict: "verified" }, { verdict: "verified" }],
        },
      },
    });
  });
  it("does not accept a bare PASS or unresolved integrated proof", async () => {
    const f = await ready();
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, "VERDICT: PASS");
    expect(await f.goal()).toMatchObject({
      status: "blocked",
      finalAcceptance: { status: "failed" },
    });
    const failed = await f.goal();
    await f.goals.recheckFinalReview("goal", failed.updatedAt);
    await f.advance();
    expect((await f.goal()).finalAcceptanceHistory).toHaveLength(1);
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, report("unresolved"));
    expect((await f.goal()).status).toBe("blocked");
    expect((await f.goal()).finalAcceptance?.acceptance?.criteria[1].verdict).toBe("unresolved");
  });
  it("retains final reviewer failure and never automatically restarts implementation", async () => {
    const f = await ready();
    await f.finish(
      (await f.goal()).finalAcceptance!.sessionId!,
      report().replace("VERDICT: PASS", "VERDICT: FAIL - API and app disagree."),
    );
    expect(await f.goal()).toMatchObject({ status: "blocked", error: "API and app disagree." });
    await f.advance();
    expect(f.turns).toHaveLength(1);
    expect((await f.task("delivered")).status).toBe("done");
  });
  it("rejects stale child result identities and preserves owner cancellation", async () => {
    const f = await ready();
    const sessionId = (await f.goal()).finalAcceptance!.sessionId!;
    const child = await f.task("delivered");
    await f.store.db
      .prepare("UPDATE tasks SET value=json_set(value, '$.updatedAt', ?) WHERE id=?")
      .run(child.updatedAt + 1, child.id);
    await f.advance();
    expect(await f.goal()).toMatchObject({
      status: "blocked",
      finalAcceptance: { status: "failed" },
    });
    expect((await f.goal()).error).toContain("changed during final review");
    expect(vi.mocked(f.provider.cancel).mock.calls.some((call) => call[0] === sessionId)).toBe(
      true,
    );
    const current = await f.goal();
    await f.goals.recheckFinalReview("goal", current.updatedAt);
    await f.advance();
    await f.goals.cancel("goal");
    await f.advance();
    expect((await f.goal()).status).toBe("cancelled");
    const turnCount = f.turns.length;
    await f.advance();
    expect(f.turns).toHaveLength(turnCount);
  });
  it("repairs malformed final evidence only in its retained read-only review", async () => {
    const f = await ready({ continueUntilDone: true });
    const sessionId = (await f.goal()).finalAcceptance!.sessionId!;
    await f.finish(sessionId, "VERDICT: PASS");
    expect((await f.goal()).finalAcceptance?.sessionId).toBe(sessionId);
    expect((await f.goal()).finalAcceptance?.formatRepairAttempts).toBe(1);
    expect(f.turns).toHaveLength(2);
    await f.finish(sessionId, report());
    expect((await f.goal()).status).toBe("done");
  });
  it("waits for daily capacity and leaves legacy completion unchanged", async () => {
    const f = await ready({ finalReview: undefined });
    expect((await f.goal()).status).toBe("done");
    expect(f.turns).toHaveLength(0);
    await f.store.db
      .prepare(
        "UPDATE goals SET value=json_set(value, '$.status', 'running', '$.finalReview', json('true')) WHERE id='goal'",
      )
      .run();
    await f.tasks.limits.save({ dailyAgentMinutes: 1 });
    await f.tasks.limits.record(f.clock.now - 2 * MINUTE, f.clock.now);
    await f.advance();
    expect(await f.goal()).toMatchObject({
      status: "running",
      finalAcceptance: { status: "pending" },
    });
    expect(f.turns).toHaveLength(0);
    await f.tasks.limits.save({ dailyAgentMinutes: 0 });
    await f.advance();
    expect((await f.goal()).finalAcceptance?.status).toBe("running");
  });
  it("recovers a trusted host interruption in the same final review", async () => {
    const f = await ready();
    const sessionId = (await f.goal()).finalAcceptance!.sessionId!;
    (await f.turnOf(sessionId)).finish();
    await f.settled(sessionId);
    const session = await f.store.session(sessionId);
    await f.store.save(
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
    await f.advance();
    expect((await f.goal()).finalAcceptance?.sessionId).toBe(sessionId);
    expect(f.turns).toHaveLength(2);
    await f.finish(sessionId, report());
    expect((await f.goal()).status).toBe("done");
  });
  it("counts planner and format recovery against the shared goal run budget", async () => {
    const f = await setup();
    const created = await f.create({ continueUntilDone: true, budget: { maxAttempts: 1 } });
    await f.finish(created.plannerSessionId!, "This is not a plan.");
    expect((await f.goal()).status).toBe("blocked");
    expect((await f.goal()).budgetStop).toContain("agent-run budget");
    expect((await f.goal()).budgetUsage?.attempts).toBe(1);
    expect(f.turns).toHaveLength(1);
  });
  it("holds final format recovery at its goal budget and permits an owner-funded recheck", async () => {
    const f = await ready({ continueUntilDone: true, budget: { maxAttempts: 1 } });
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, "VERDICT: PASS");
    expect((await f.goal()).budgetStop).toContain("agent-run budget");
    expect(f.turns).toHaveLength(1);
    let current = await f.goal();
    await f.goals.update(
      "goal",
      {
        autoMerge: false,
        continueUntilDone: true,
        maxRunningTasks: 0,
        maxRunMinutes: 0,
        budget: { maxAttempts: 2 },
      },
      current.updatedAt,
    );
    current = await f.goal();
    await f.goals.recheckFinalReview("goal", current.updatedAt);
    await f.advance();
    // Settings and recheck can share an already-started scheduler pass; the next
    // pass refreshes its child index before the retained review can launch.
    if ((await f.goal()).finalAcceptance?.status === "pending") await f.advance();
    expect(await f.goal()).toMatchObject({
      status: "running",
      finalAcceptance: { status: "running" },
    });
    await f.providersStarted();
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, report());
    expect((await f.goal()).status).toBe("done");
    expect((await f.goal()).budgetUsage?.attempts).toBe(2);
  });
  it("stops an active final reviewer when total agent time is exhausted", async () => {
    const f = await ready({ budget: { maxAgentMinutes: 0.5 } });
    const sessionId = (await f.goal()).finalAcceptance!.sessionId!;
    await f.advance();
    expect(await f.goal()).toMatchObject({
      status: "blocked",
      finalAcceptance: { status: "failed" },
    });
    expect((await f.goal()).budgetStop).toContain("agent-time budget");
    expect(vi.mocked(f.provider.cancel).mock.calls.some((call) => call[0] === sessionId)).toBe(
      true,
    );
    expect((await f.task("delivered")).status).toBe("done");
  });
  it("rejects changed delivered files even when task metadata did not change", async () => {
    const f = await ready();
    expect((await f.goal()).finalAcceptance?.workspaceFingerprint).toEqual(expect.any(String));
    writeFileSync(join(f.lead.cwd, "file.txt"), "Changed during final review\n");
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, report());
    expect(await f.goal()).toMatchObject({
      status: "blocked",
      finalAcceptance: { status: "failed" },
    });
    expect((await f.goal()).error).toContain("working copies changed");
  });
  it("treats failed final output reads as unknown instead of accepting unchanged evidence", async () => {
    const f = await ready();
    const snapshot = vi
      .spyOn(f.tasks, "resultFingerprint")
      .mockRejectedValue(new Error("Output unavailable"));
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, report());
    snapshot.mockRestore();
    expect((await f.goal()).status).toBe("blocked");
    expect((await f.goal()).error).toContain("working copies changed");
  });
  it("never consumes or cancels a later owner turn as final acceptance evidence", async () => {
    const f = await ready();
    const sessionId = (await f.goal()).finalAcceptance!.sessionId!;
    (await f.turnOf(sessionId)).finish();
    await f.settled(sessionId);
    await f.engine.command({
      type: "send",
      commandId: "owner-follow-up",
      sessionId,
      text: "Owner follow-up in this conversation",
    });
    await f.providersStarted();
    const ownerRunId = (await f.store.session(sessionId)).runId;
    await f.advance();
    expect((await f.goal()).status).toBe("blocked");
    expect((await f.goal()).error).toContain("no longer owns");
    expect(await f.store.session(sessionId)).toMatchObject({
      status: "running",
      runId: ownerRunId,
    });
    expect(f.provider.cancel).not.toHaveBeenCalled();
  });
  it("reserves a machine worker slot until final review settles", async () => {
    const f = await ready();
    await f.tasks.limits.save({ maxRunningTasks: 1 });
    await f.tasks.save({
      id: "other",
      title: "Unrelated work",
      prompt: "Perform unrelated work",
      projectId: f.lead.id,
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "auto",
      maxRunMinutes: 0,
      isolate: false,
      review: false,
    });
    await f.advance();
    expect((await f.task("other")).status).toBe("queued");
    await f.finish((await f.goal()).finalAcceptance!.sessionId!, report());
    expect((await f.goal()).status).toBe("done");
    expect((await f.task("other")).status).toBe("running");
  });
  it("reattaches the durable final launch receipt without starting a duplicate review", async () => {
    const f = await ready();
    const before = await f.goal();
    const retained = before.finalAcceptance!;
    await f.store.db.prepare("UPDATE goals SET value=? WHERE id=?").run(
      JSON.stringify({
        ...before,
        finalAcceptance: { ...retained, status: "pending", sessionId: undefined, runId: undefined },
      }),
      "goal",
    );
    await f.advance();
    expect((await f.goal()).finalAcceptance).toMatchObject({
      status: "running",
      sessionId: retained.sessionId,
      runId: retained.runId,
    });
    expect(f.turns).toHaveLength(1);
    expect((await f.goal()).budgetUsage?.attempts).toBe(1);
    await f.finish(retained.sessionId!, report());
    expect((await f.goal()).status).toBe("done");
  });
  it("does not turn missing historical planner accounting into a fresh budget", async () => {
    const f = await setup();
    await f.goals.ready;
    await f.store.db.prepare("INSERT INTO goals VALUES (?, ?)").run(
      "goal",
      JSON.stringify({
        ...(await f.input()),
        status: "blocked",
        taskIds: [],
        plannerSessionId: "missing-history",
        plannerRunId: "missing-run",
        plannerStartedAt: f.clock.now - MINUTE,
        budget: { maxAttempts: 3 },
        approvePlan: false,
        createdAt: f.clock.now - MINUTE,
        updatedAt: f.clock.now,
      }),
    );
    const reopened = new HostGoals(f.store, f.engine, f.tasks, () => f.clock.now);
    await reopened.ready;
    expect((await f.tasks.budgets.read({ goalId: "goal" })).historyComplete).toBe(false);
    await reopened.replan("goal");
    expect((await f.goal()).status).toBe("blocked");
    expect((await f.goal()).budgetStop).toMatch(/historical/i);
    expect(f.turns).toHaveLength(0);
  });
  it("does not accept a result after owner cancellation during its final snapshot", async () => {
    const f = await ready();
    const original = f.tasks.resultFingerprint.bind(f.tasks);
    let entered = false;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshot = vi.spyOn(f.tasks, "resultFingerprint").mockImplementation(async (task) => {
      entered = true;
      await paused;
      return await original(task);
    });
    const finishing = f.finish((await f.goal()).finalAcceptance!.sessionId!, report());
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 10000 });
    await f.goals.cancel("goal");
    release();
    await finishing;
    snapshot.mockRestore();
    expect((await f.goal()).status).toBe("cancelled");
    expect((await f.goal()).finalAcceptance?.status).not.toBe("passed");
  });
});
describe("editing goal settings", () => {
  it("keeps the chosen account through planning and scheduled worker creation", async () => {
    const f = await setup();
    const created = await f.create({ providerAccountId: "account-work", isolate: false });
    expect(f.turns[0].input.providerAccountId).toBe("account-work");
    expect((await f.store.session(created.plannerSessionId!)).session.providerAccountId).toBe(
      "account-work",
    );
    await f.finish(created.plannerSessionId!, planReply([{ key: "build", project: f.lead.cwd }]));
    const task = (await f.tasks.list())[0];
    expect(task.providerAccountId).toBe("account-work");
    expect((await f.turnOf(task.sessionId!)).input.providerAccountId).toBe("account-work");
  });
  it("reuses the task index across goal polls and refreshes it after task writes", async () => {
    const { store, tasks, goals, input, lead } = await setup();
    await tasks.save({ ...input(), id: "waiting", projectId: lead.id, status: "todo" });
    await store.db.prepare("INSERT INTO goals VALUES (?, ?)").run(
      "goal",
      JSON.stringify({
        ...input(),
        status: "running",
        taskIds: ["waiting"],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const prepare = vi.spyOn(store.db, "prepare");
    const pointReads = () =>
      prepare.mock.calls.filter(([sql]) => sql === "SELECT value FROM tasks WHERE id=?").length;
    expect((await goals.list())[0].status).toBe("running");
    expect((await goals.list())[0].status).toBe("running");
    expect(pointReads()).toBe(1);
    await tasks.save({ ...input(), id: "waiting", projectId: lead.id, title: "Changed" });
    // save() independently reads current tasks to validate dependency cycles.
    // Count goal polling itself: one refresh after a write, then shared reads.
    prepare.mockClear();
    await goals.list();
    await goals.list();
    expect(pointReads()).toBe(1);
    await tasks.delete("waiting");
    prepare.mockClear();
    expect((await goals.list())[0].status).toBe("blocked");
    await goals.list();
    expect(pointReads()).toBe(1);
    prepare.mockRestore();
  });
  async function seeded() {
    const env = await setup();
    vi.mocked(env.tasks.tick).mockResolvedValue();
    const original = {
      ...(await env.input()),
      approvePlan: false,
      status: "running",
      taskIds: ["waiting", "reviewed", "active", "stopped", "finished"],
      createdAt: 1,
      updatedAt: 2,
    };
    await env.store.db
      .prepare("INSERT INTO goals VALUES (?, ?)")
      .run("goal", JSON.stringify(original));
    for (const [id, status] of [
      ["waiting", "queued"],
      ["reviewed", "review"],
      ["active", "running"],
      ["stopped", "blocked"],
      ["finished", "done"],
    ]) {
      const saved = await env.tasks.save({
        ...(await env.input()),
        id,
        projectId: env.lead.id,
        goalId: "goal",
        isolate: true,
        review: true,
        maxRunMinutes: 10,
        status: "todo",
      });
      await env.store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
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
  it("applies settings to unfinished tasks while retaining review, dependencies and owner stops", async () => {
    const { goals, tasks, original } = await seeded();
    const before = await tasks.list();
    const saved = await goals.update("goal", settings, original.updatedAt);
    expect(saved).toMatchObject({ ...settings, status: "running", taskIds: original.taskIds });
    for (const id of ["waiting", "reviewed", "active", "stopped"]) {
      const task = (await tasks.get(id))!;
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
    expect((await tasks.get("stopped"))?.awaitingOwnerRestart).toBe(true);
    expect(await tasks.get("finished")).toEqual(before.find((task) => task.id === "finished"));
    const disabled = await goals.update(
      "goal",
      { ...settings, autoMerge: false, continueUntilDone: false, maxRunningTasks: 0 },
      saved.updatedAt,
    );
    expect(disabled.autoMerge).toBeUndefined();
    expect(disabled.maxRunningTasks).toBeUndefined();
    expect((await tasks.get("reviewed"))?.autoMerge).toBeUndefined();
  });
  it("rejects stale or invalid updates without partially changing tasks", async () => {
    const { goals, tasks } = await seeded();
    const before = await tasks.list();
    await expect((async () => await goals.update("goal", settings, 1))()).rejects.toThrow(
      "This goal changed",
    );
    await expect(
      (async () => await goals.update("goal", { ...settings, maxRunningTasks: 99 }, 2))(),
    ).rejects.toThrow("Invalid goal concurrency");
    await expect(
      (async () => await goals.update("goal", { ...settings, runtimeMode: "full-access" }, 2))(),
    ).rejects.toThrow("Invalid goal settings");
    expect(await tasks.list()).toEqual(before);
  });
  it("preserves individual task settings when the corresponding goal setting is unchanged", async () => {
    const { goals, tasks } = await seeded();
    await goals.update("goal", { ...settings, continueUntilDone: false, maxRunMinutes: 0 }, 2);
    expect((await tasks.get("waiting"))?.maxRunMinutes).toBe(10);
    expect((await tasks.get("stopped"))?.awaitingOwnerRestart).toBe(true);
    expect((await tasks.get("waiting"))?.continueUntilDone).toBeUndefined();
    expect((await tasks.get("waiting"))?.autoMerge).toBe(true);
  });
  it("rolls back all task updates if one write fails", async () => {
    const { goals, tasks, store } = await seeded();
    const before = await tasks.list();
    await store.db.exec(
      "CREATE TRIGGER reject_goal_task BEFORE UPDATE ON tasks WHEN NEW.id = 'reviewed' BEGIN SELECT RAISE(ABORT, 'write rejected'); END",
    );
    await expect((async () => await goals.update("goal", settings, 2))()).rejects.toThrow(
      "write rejected",
    );
    expect(await tasks.list()).toEqual(before);
    expect((await goals.list())[0].autoMerge).toBeUndefined();
  });
  it("rejects automatic merge for a shared checkout and edits to finished goals", async () => {
    const { goals, store, original } = await seeded();
    const replace = async (patch: Record<string, unknown>) =>
      await store.db
        .prepare("UPDATE goals SET value=? WHERE id='goal'")
        .run(JSON.stringify({ ...original, ...patch }));
    await replace({ isolate: false });
    await expect((async () => await goals.update("goal", settings, 2))()).rejects.toThrow(
      "Automatic merge requires isolated tasks",
    );
    for (const status of ["done", "cancelled"]) {
      await replace({ status });
      await expect((async () => await goals.update("goal", settings, 2))()).rejects.toThrow(
        "Only an active goal",
      );
    }
  });
  it("delivers an already reviewed branch and releases its queued dependency", async () => {
    const { addRepo, plan, finish, planned, goals, goal, tasks } = await setup();
    const repo = await addRepo("edit-delivery");
    await plan(
      planReply([
        { key: "one", project: repo.cwd },
        { key: "two", project: repo.cwd, dependsOn: ["one"] },
      ]),
      { projectIds: [repo.id], leadProjectId: repo.id },
    );
    const first = (await planned()).one;
    writeFileSync(join(first.worktreeCwd!, "result.txt"), "reviewed result\n");
    await finish(first.sessionId!);
    expect((await planned()).one.status).toBe("review");
    expect((await planned()).two.status).toBe("queued");
    await goals.update("goal", { ...settings, maxRunMinutes: 0 }, (await goal()).updatedAt);
    await tasks.idle();
    expect((await planned()).one).toMatchObject({ status: "done", merged: true, autoMerged: true });
    expect((await planned()).two.status).toBe("running");
    expect(readFileSync(join(repo.cwd, "result.txt"), "utf8").replace(/\r\n/g, "\n")).toBe(
      "reviewed result\n",
    );
  });
});
describe("goal workspace and scheduling choices", () => {
  it("plans in the selected checkout and leaves manually started tasks in todo", async () => {
    const { addRepo, plan, tasks, turns } = await setup();
    const repo = await addRepo("workspace");
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
    expect(await tasks.list()).toHaveLength(2);
    expect((await tasks.list()).every((task) => task.status === "todo")).toBe(true);
    expect((await tasks.list())[0].workspace).toMatchObject({ checkoutCwd: checkout });
    await tasks.startTask(goal.taskIds[1]);
    expect((await tasks.get(goal.taskIds[1]))?.status).toBe("queued");
    await tasks.startTask(goal.taskIds[0]);
    expect((await tasks.get(goal.taskIds[0]))?.status).toBe("running");
  }, 60000);
  it("caps one goal without consuming another goal's available capacity", async () => {
    const { lead, addProject, plan, tasks, input } = await setup();
    const api = await addProject("api");
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
      (await tasks.list()).filter((task) => task.goalId === goal.id && task.status === "running"),
    ).toHaveLength(1);
    const independent = await addProject("independent");
    const spec = input();
    await tasks.save({
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
    expect((await tasks.get("independent"))?.status).toBe("running");
    expect(
      (await tasks.list()).filter((task) => task.goalId === goal.id && task.status === "queued"),
    ).toHaveLength(1);
  });
});
describe("goal planning", () => {
  it("rolls back every queued task when plan approval cannot save the complete batch", async () => {
    const { goals, lead, plan, tasks, goal } = await setup();
    await plan(
      planReply([
        { key: "one", project: lead.cwd },
        { key: "two", project: lead.cwd, dependsOn: ["one"] },
      ]),
      { approvePlan: true },
    );
    const save = tasks.save.bind(tasks);
    let count = 0;
    const spy = vi.spyOn(tasks, "save").mockImplementation(async (input) => {
      if (++count === 2) throw new Error("Task persistence unavailable");
      return await save(input);
    });
    try {
      await expect((async () => await goals.approve("goal"))()).rejects.toThrow(
        "Task persistence unavailable",
      );
      expect(await tasks.list()).toEqual([]);
      expect(await goal()).toMatchObject({ status: "awaiting-approval", taskIds: [] });
    } finally {
      spy.mockRestore();
    }
  });
  it("plans in the lead project and creates the plan's tasks", async () => {
    const { goals, lead, addProject, create, finish, goal, planned, store, turns, turnOf } =
      await setup();
    const api = await addProject("api");
    const created = await create({
      projectIds: [lead.id, api.id],
      verifyDefaults: {
        review: false,
        verifyCommand: { [api.id]: "npm test" },
      },
    });
    expect(created).toMatchObject({ status: "planning", taskIds: [] });
    expect(await goals.list()).toEqual([expect.objectContaining({ id: "goal" })]);
    const planner = (await store.session(created.plannerSessionId!)).session;
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
    expect(await goal()).toMatchObject({ status: "running" });
    expect((await goal()).taskIds).toHaveLength(2);
    expect((await goal()).plan!.tasks.map((entry) => entry.projectId)).toEqual([api.id, lead.id]);
    const { api: first, app: second } = await planned();
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
    const { goals, lead, plan, goal, tasks, turns, advance } = await setup();
    const waiting = await plan(planReply([{ key: "one", project: lead.cwd }]), {
      approvePlan: true,
    });
    expect(waiting.status).toBe("awaiting-approval");
    expect(waiting.plan!.tasks).toMatchObject([{ key: "one", title: "Do one" }]);
    expect(await tasks.list()).toEqual([]);
    await advance();
    expect((await goal()).status).toBe("awaiting-approval");
    const approved = await goals.approve("goal");
    expect(approved.status).toBe("running");
    expect(approved.taskIds).toHaveLength(1);
    await tasks.tick();
    expect(turns).toHaveLength(2);
    await tasks.idle();
    expect((await tasks.list())[0].status).toBe("running");
    await expect((async () => await goals.approve("goal"))()).rejects.toThrow(
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
    const { lead, plan, tasks } = await setup();
    const blocked = await plan(reply(lead.cwd));
    expect(blocked.status).toBe("blocked");
    expect(blocked.planError).toContain(error);
    expect(blocked.taskIds).toEqual([]);
    expect(await tasks.list()).toEqual([]);
  });
  it("reads a plan the planner wrote in plan mode or before its last message", async () => {
    const { lead, create, turnOf, settled, advance, goal } = await setup();
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
    expect(await goal()).toMatchObject({ status: "running" });
    expect((await goal()).plan!.tasks).toMatchObject([{ key: "one" }]);
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
    expect((await goal("split")).plan!.tasks).toMatchObject([{ key: "two" }]);
  });
  it("blocks a goal whose planner run failed", async () => {
    const { create, turnOf, settled, advance, goal } = await setup();
    const created = await create();
    turnOf(created.plannerSessionId!).fail(new Error("Not signed in"));
    await settled(created.plannerSessionId!);
    await advance();
    expect(await goal()).toMatchObject({
      status: "blocked",
      planError: "The planner failed: Not signed in",
    });
  });
  it("repairs invalid plans in the existing conversation and inherits continuous execution", async () => {
    const { create, goal, finish, turns, lead, tasks } = await setup();
    const created = await create({ continueUntilDone: true });
    await finish(created.plannerSessionId!, "The plan is ready, without JSON.");
    expect(await goal()).toMatchObject({
      status: "planning",
      plannerSessionId: created.plannerSessionId,
      plannerRepairAttempts: 1,
    });
    expect(turns.at(-1)!.input.text).toContain("has no ```json block");
    expect(await tasks.list()).toEqual([]);
    await finish(created.plannerSessionId!, planReply([{ key: "one", project: lead.cwd }]));
    expect((await goal()).status).toBe("running");
    expect((await tasks.list())[0]).toMatchObject({ continueUntilDone: true, status: "running" });
  });
  it("bounds planner format repairs and resets their budget when the owner replans", async () => {
    const { create, goal, finish, turns, goals } = await setup();
    const created = await create({ continueUntilDone: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await finish(created.plannerSessionId!, "No JSON plan.");
      expect(await goal()).toMatchObject({ status: "planning", plannerRepairAttempts: attempt });
    }
    await finish(created.plannerSessionId!, "Still no JSON plan.");
    expect((await goal()).status).toBe("blocked");
    expect(turns).toHaveLength(3);
    const replanned = await goals.replan("goal", "Use one concrete task.");
    expect(replanned.plannerRepairAttempts).toBeUndefined();
    expect(replanned.plannerRecoveryPending).toBeUndefined();
  });
  it("resumes only a trusted planner interruption and waits for available daily time", async () => {
    const { create, goal, turns, turnOf, settled, store, tasks, advance, clock } = await setup();
    const created = await create({ continueUntilDone: true });
    const sessionId = created.plannerSessionId!;
    turnOf(sessionId).finish();
    await settled(sessionId);
    const session = await store.session(sessionId);
    await store.save(
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
    await tasks.limits.save({ dailyAgentMinutes: 1 });
    await tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await advance();
    expect(await goal()).toMatchObject({
      status: "planning",
      plannerRecoveryPending: true,
      plannerSessionId: sessionId,
    });
    expect(turns).toHaveLength(1);
    await tasks.limits.save({ dailyAgentMinutes: 0 });
    await advance();
    expect(await goal()).toMatchObject({ status: "planning", plannerSessionId: sessionId });
    expect((await goal()).plannerRecoveryPending).toBeUndefined();
    expect((await goal()).plannerRepairAttempts).toBe(0);
    expect(turns).toHaveLength(2);
    expect(turns.at(-1)!.input.text).toContain("existing read-only planning conversation");
  });
  it("never revives an owner stop or an untrusted interrupted planner", async () => {
    const { create, goal, turnOf, settled, store, advance, turns, engine } = await setup();
    const stopped = await create({ continueUntilDone: true });
    await engine.command({
      type: "cancel",
      commandId: "stop-planner",
      sessionId: stopped.plannerSessionId!,
      runId: stopped.plannerRunId,
    });
    await settled(stopped.plannerSessionId!);
    await advance();
    expect(await goal()).toMatchObject({ status: "blocked", planError: "Stopped by you." });
    const broken = await create({ id: "broken", continueUntilDone: true });
    turnOf(broken.plannerSessionId!).finish();
    await settled(broken.plannerSessionId!);
    const session = await store.session(broken.plannerSessionId!);
    await store.save(
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
    expect((await goal("broken")).status).toBe("blocked");
    expect(turns).toHaveLength(2);
  });
  it("plans again with the owner's feedback", async () => {
    const { goals, lead, plan, goal, turns, finish, providersStarted } = await setup();
    const blocked = await plan("No plan, sorry.");
    expect(blocked.status).toBe("blocked");
    const again = await goals.replan("goal", "  Split the work by folder.  ");
    expect(again).toMatchObject({
      status: "planning",
      feedback: "Split the work by folder.",
    });
    expect(again.planError).toBeUndefined();
    expect(again.plannerSessionId).not.toBe(blocked.plannerSessionId);
    // Replanning captures another real checkpoint before provider.send. Wait
    // for that run's provider readiness, as create() and task ticks already do.
    await providersStarted();
    expect(turns).toHaveLength(2);
    expect(turns[1].input.text).toContain(
      "The owner's feedback on an earlier plan:\nSplit the work by folder.",
    );
    await finish(again.plannerSessionId!, planReply([{ key: "one", project: lead.cwd }]));
    expect((await goal()).status).toBe("running");
    await expect((async () => await goals.replan("goal"))()).rejects.toThrow(
      "Only a goal whose plan was not started can be planned again.",
    );
  });
  it("rejects a goal for a project this machine does not have", async () => {
    const { goals, input, lead } = await setup();
    await expect(
      (async () => await goals.create(input({ projectIds: [lead.id, "missing"] })))(),
    ).rejects.toThrow("Project is not registered on this machine");
    await expect(
      (async () => await goals.create(input({ leadProjectId: "other" })))(),
    ).rejects.toThrow("The lead project must be one of the goal’s projects.");
    expect(await goals.list()).toEqual([]);
  });
});
describe("goal tasks", () => {
  it(
    "starts a dependent task once its dependency is merged, from the merged HEAD",
    async () => {
      const { goals, lead, addRepo, plan, planned, tasks, turns, turnOf, finish } = await setup();
      const repo = await addRepo("repo");
      await plan(
        planReply([
          { key: "a", project: repo.cwd },
          { key: "b", project: repo.cwd, dependsOn: ["a"] },
        ]),
        { projectIds: [lead.id, repo.id] },
      );
      let { a, b } = await planned();
      expect(a.status).toBe("running");
      expect(b.status).toBe("queued");
      expect(turns).toHaveLength(2);
      writeFileSync(join(turnOf(a.sessionId!).input.cwd, "from-a.txt"), "A\n");
      await finish(a.sessionId!);
      ({ a, b } = await planned());
      expect(a.status).toBe("review");
      // Still waiting: review is not done.
      expect(b.status).toBe("queued");
      await tasks.move(a.id, "done");
      await tasks.tick();
      await vi.waitFor(() => expect(turns).toHaveLength(3));
      ({ b } = await planned());
      expect(b.status).toBe("running");
      expect(b.baseCommit).toBe(git(repo.cwd, "rev-parse", "HEAD"));
      expect(existsSync(join(b.worktreeCwd!, "from-a.txt"))).toBe(true);
      expect((await goals.list())[0].status).toBe("running");
      // This scenario creates two worktrees and merges a real branch.
    },
    process.platform === "win32" ? 60000 : 5000,
  );
  it("keeps dependents queued behind a blocked task and blocks the goal", async () => {
    const { lead, addProject, plan, planned, tasks, turnOf, settled, advance, goal, turns } =
      await setup();
    const api = await addProject("api");
    await plan(
      planReply([
        { key: "a", project: api.cwd },
        { key: "b", project: lead.cwd, dependsOn: ["a"] },
        { key: "c", project: lead.cwd, dependsOn: ["b"] },
      ]),
      { projectIds: [lead.id, api.id] },
    );
    let { a, b, c } = await planned();
    turnOf(a.sessionId!).fail(new Error("Not signed in"));
    await settled(a.sessionId!);
    await advance();
    ({ a, b, c } = await planned());
    expect(a.status).toBe("blocked");
    expect(b.status).toBe("queued");
    expect(c.status).toBe("queued");
    expect(await goal()).toMatchObject({
      status: "blocked",
      error: "1 of 3 tasks blocked: Do a",
    });
    // Retrying the blocked task takes the goal up again.
    await tasks.move(a.id, "queued");
    expect((await goal()).status).toBe("running");
    expect((await goal()).error).toBeUndefined();
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect((await planned()).a.status).toBe("running");
  });
  it.each([false, true])(
    "recovers legacy review failures only for active goals (cancelled: %s)",
    async (cancelled) => {
      const { lead, plan, planned, finish, store, goals, goal, tasks } = await setup();
      await plan(
        planReply([
          { key: "a", project: lead.cwd },
          { key: "b", project: lead.cwd, dependsOn: ["a"] },
        ]),
        { verifyDefaults: { review: true } },
      );
      await finish((await planned()).a.sessionId!);
      const reviewing = (await planned()).a;
      // Simulate a persisted failure from a host predating automatic correction.
      await store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify({ ...reviewing, goalId: undefined, source: undefined }), reviewing.id);
      await finish(reviewing.reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
      const legacy = { ...(await tasks.get(reviewing.id))!, goalId: "goal" };
      if (cancelled) await goals.cancel("goal");
      await store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify(legacy), legacy.id);
      await tasks.tick();
      expect((await goal()).status).toBe(cancelled ? "cancelled" : "running");
      expect((await planned()).a.status).toBe(cancelled ? "blocked" : "running");
      if (!cancelled) expect((await planned()).a.blockedTakeover).toBeDefined();
      expect((await planned()).b.status).toBe(cancelled ? "blocked" : "queued");
    },
  );
  it("is done once every task is done", async () => {
    const { lead, addProject, plan, planned, tasks, finish, goal, advance } = await setup();
    const api = await addProject("api");
    await plan(
      planReply([
        { key: "a", project: api.cwd },
        { key: "b", project: lead.cwd },
      ]),
      { projectIds: [lead.id, api.id] },
    );
    let { a, b } = await planned();
    await finish(a.sessionId!);
    await finish(b.sessionId!);
    ({ a, b } = await planned());
    expect([a.status, b.status]).toEqual(["review", "review"]);
    await tasks.move(a.id, "done");
    await advance();
    expect((await goal()).status).toBe("running");
    await tasks.move(b.id, "done");
    // Listing brings progress up to date without waiting for a tick.
    expect((await goal()).status).toBe("done");
  });
  it("runs tasks of different projects at once, within the machine's cap", async () => {
    const { lead, addProject, plan, planned, turns } = await setup();
    const one = await addProject("one");
    const two = await addProject("two");
    await plan(
      planReply([
        { key: "a", project: lead.cwd },
        { key: "b", project: one.cwd },
        { key: "c", project: two.cwd },
      ]),
      { projectIds: [lead.id, one.id, two.id] },
    );
    const statuses = Object.values(await planned()).map((entry) => entry.status);
    expect(statuses.filter((status) => status === "running")).toHaveLength(2);
    expect(statuses.filter((status) => status === "queued")).toHaveLength(1);
    // The planner, and two tasks.
    expect(turns).toHaveLength(3);
  });
  it("cancels a goal: stops its running tasks and blocks its queued ones", async () => {
    const { goals, lead, addRepo, plan, planned, provider, goal, advance } = await setup();
    const repo = await addRepo("repo");
    await plan(
      planReply([
        { key: "a", project: repo.cwd },
        { key: "b", project: repo.cwd, dependsOn: ["a"] },
      ]),
      { projectIds: [lead.id, repo.id] },
    );
    const before = (await planned()).a;
    const cancelled = await goals.cancel("goal");
    expect(cancelled.status).toBe("cancelled");
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await advance();
    const { a, b } = await planned();
    expect(a).toMatchObject({ status: "blocked", error: "Stopped by you." });
    expect(b).toMatchObject({ status: "blocked", error: "Goal cancelled" });
    expect((await goal()).status).toBe("cancelled");
    // The branch stays.
    expect(git(repo.cwd, "branch", "--list", before.branch!)).toContain(before.branch);
    await expect(goals.cancel("goal")).rejects.toThrow("This goal is already cancelled.");
  });
  it("cancels a goal while it is planning", async () => {
    const { goals, create, provider, settled, advance, goal } = await setup();
    const created = await create();
    await goals.cancel("goal");
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(created.plannerSessionId!);
    await advance();
    expect((await goal()).status).toBe("cancelled");
  });
  it("cancels a goal's registered verification job through the normal task Stop path", async () => {
    const { goals, tasks, lead, plan, planned, turnOf, settled, turns } = await setup();
    await plan(planReply([{ key: "a", project: lead.cwd }]), {
      verifyDefaults: {
        review: false,
        verifyCommand: { [lead.id]: 'node -e "setTimeout(() => {}, 1000)"' },
      },
    });
    const running = (await planned()).a;
    turnOf(running.sessionId!).finish();
    await settled(running.sessionId!);
    await tasks.tick();
    expect((await tasks.get(running.id))?.status).toBe("verifying");
    const cancelled = await goals.cancel("goal");
    expect(cancelled.status).toBe("cancelled");
    expect(await tasks.get(running.id)).toMatchObject({
      status: "blocked",
      error: "Stopped by you.",
    });
    await tasks.idle();
    expect((await tasks.get(running.id))?.status).toBe("blocked");
    expect(turns).toHaveLength(2);
  });
  it("deletes a goal with nothing running, leaving its tasks unless told", async () => {
    const { goals, lead, plan, planned, tasks } = await setup();
    await plan(planReply([{ key: "a", project: lead.cwd }]), {
      approvePlan: false,
    });
    await expect(goals.delete("goal")).rejects.toThrow(
      "Stop this goal’s running tasks before deleting it.",
    );
    await tasks.move((await planned()).a.id, "blocked");
    await goals.delete("goal");
    expect(await goals.list()).toEqual([]);
    expect(await tasks.list()).toHaveLength(1);
    // Deleting tasks with unmerged isolated work is protected. Exercise the
    // allowed direct-checkout case here; branch protection has its own checks.
    await plan(planReply([{ key: "b", project: lead.cwd }]), { id: "other", isolate: false });
    const other = (await planned("other")).b;
    await tasks.move(other.id, "blocked");
    await goals.delete("other", true);
    expect((await tasks.list()).map((entry) => entry.id)).not.toContain(other.id);
  });
});
describe("goal merging and work limits", () => {
  it("runs direct goal tasks concurrently, preserves dirty work and releases dependencies", async () => {
    const { plan, planned, addRepo, finish, goal, advance } = await setup();
    const repo = await addRepo("direct");
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
    expect((await planned()).one).toMatchObject({ isolate: false, status: "running" });
    expect((await planned()).one.branch).toBeUndefined();
    expect((await planned()).one.autoMerge).toBeUndefined();
    expect((await planned()).two.status).toBe("running");
    writeFileSync(join(repo.cwd, "result.txt"), "first task\n");
    await finish((await planned()).one.sessionId!);
    await advance();
    expect((await planned()).one.status).toBe("done");
    expect((await planned()).two.status).toBe("running");
    expect((await planned()).final.status).toBe("queued");
    await finish((await planned()).two.sessionId!);
    await advance();
    expect((await planned()).final.status).toBe("running");
    await finish((await planned()).final.sessionId!);
    await advance();
    expect((await goal()).status).toBe("done");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("owner changes\n");
    expect(readFileSync(join(repo.cwd, "result.txt"), "utf8")).toBe("first task\n");
  });
  it("gives every planned task the goal autoMerge setting", async () => {
    const { plan, planned, lead } = await setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]), {
      autoMerge: true,
    });
    expect((await planned()).one.autoMerge).toBe(true);
  });
  it("leaves autoMerge off by default", async () => {
    const { plan, planned, lead } = await setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]));
    expect((await planned()).one.autoMerge).toBeUndefined();
  });
  it("counts the planner toward the day", async () => {
    const { plan, tasks, lead } = await setup();
    await plan(planReply([{ key: "one", project: lead.cwd }]));
    expect(await tasks.limits.usedMinutes()).toBeGreaterThan(0);
  });
  it("waits to plan while the day is used up, then plans tomorrow", async () => {
    const { goals, goal, tasks, turns, clock, input } = await setup();
    await tasks.limits.save({ dailyAgentMinutes: 1 });
    await tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    const created = await goals.create(input());
    expect(created).toMatchObject({ status: "planning" });
    expect(created.plannerSessionId).toBeUndefined();
    clock.now += MINUTE;
    await tasks.tick();
    expect(turns).toHaveLength(0);
    expect(await goal()).toMatchObject({ status: "planning" });
    clock.now += 24 * 60 * MINUTE;
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect((await goal()).plannerSessionId).toBeDefined();
  });
});
