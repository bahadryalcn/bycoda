import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import { HostStewards, PREVIOUS_RUN_SKIP, openLimitSkip } from "./stewards";
import { DAILY_LIMIT_SKIP } from "../src/features/tasks/model/hostSettings";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

const reply = (proposals: unknown) =>
  `Here is what I found.\n\n\`\`\`json\n${JSON.stringify({ proposals })}\n\`\`\``;

function setup() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-stewards-test-")));
  const store = new HostStore(join(directory, "host.db"));
  const repo = (() => {
    const cwd = join(directory, "repo");
    mkdirSync(cwd);
    const added = store.addProject(cwd, "repo");
    git(cwd, "init", "-q");
    git(cwd, "checkout", "-q", "-b", "main");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.test");
    writeFileSync(join(cwd, "file.txt"), "initial\n");
    git(cwd, "add", "file.txt");
    git(cwd, "commit", "-q", "-m", "initial");
    return added;
  })();
  const plain = (() => {
    const cwd = join(directory, "plain");
    mkdirSync(cwd);
    return store.addProject(cwd, "plain");
  })();
  const turns: Array<{
    input: SendTurnInput;
    finish: () => void;
    fail: (error: Error) => void;
  }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve, reject) => {
          turns.push({ input, finish: resolve, fail: reject });
        }),
    ),
    cancel: vi.fn(async (sessionId) => {
      turns.find((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    stop: vi.fn(async (sessionId) => {
      turns.find((turn) => turn.input.sessionId === sessionId)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { claude: provider });
  // 08:00 local; a daily steward at 09:00 is due an hour later.
  const clock = { now: new Date("2026-10-05T08:00:00").getTime() };
  const tasks = new HostTasks(store, engine, () => clock.now);
  const stewards = new HostStewards(store, engine, tasks, () => clock.now);
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await tasks.idle();
    await stewards.idle();
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "steward",
    projectId: repo.id,
    enabled: true,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    focus: "follow docs/ROADMAP.md",
    ...overrides,
  });
  const steward = (id = "steward") => stewards.list().find((entry) => entry.id === id)!;
  const taskInput = (overrides: Record<string, unknown> = {}) => ({
    id: "existing",
    title: "Existing work",
    prompt: "Do the thing",
    projectId: repo.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    status: "todo",
    ...overrides,
  });
  /** Moves the clock past the steward's time and starts its run. */
  const startDue = async () => {
    // A minute past its next scheduled time.
    clock.now = Math.max(clock.now, steward().nextRunAt) + MINUTE;
    const started = turns.length + 1;
    await stewards.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(started), { timeout: 10_000 });
    return turns.at(-1)!;
  };
  /** Ends the latest turn with `text` and lets the next tick settle it. */
  const finish = async (text: string) => {
    const turn = turns.at(-1)!;
    turn.input.onEvent({ type: "message.delta", text });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await vi.waitFor(() => expect(store.session(turn.input.sessionId).status).toBe("idle"), {
      timeout: 10_000,
    });
    clock.now += MINUTE;
    await stewards.tick();
    await stewards.idle();
  };
  const worktrees = () =>
    git(repo.cwd, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree ")).length;
  return {
    store,
    engine,
    tasks,
    stewards,
    turns,
    clock,
    repo,
    plain,
    input,
    steward,
    taskInput,
    startDue,
    finish,
    worktrees,
  };
}

describe("host stewards", () => {
  it("rejects stale configuration edits and toggles while preserving newer steward focus", () => {
    const { stewards, input } = setup();
    const opening = stewards.save(input({ enabled: false }));
    const newer = stewards.save({
      ...opening,
      focus: "Newer focus",
      expectedConfiguration: opening,
    });
    expect(() =>
      stewards.save({ ...opening, model: "claude:other", expectedConfiguration: opening }),
    ).toThrow("Configuration changed in another client");
    expect(() =>
      stewards.save({ ...opening, enabled: true, expectedConfiguration: opening }),
    ).toThrow("Configuration changed in another client");
    expect(stewards.list()[0]).toEqual(newer);
    expect(
      stewards.save({ ...newer, model: "claude:other", expectedConfiguration: newer }),
    ).toMatchObject({ focus: "Newer focus", model: "claude:other", enabled: false });
  });
  it("keeps an active run attached to the project that owns its checkout", async () => {
    const { stewards, repo, plain, input, startDue, steward } = setup();
    stewards.save(input());
    await startDue();
    expect(() => stewards.save(input({ projectId: plain.id }))).toThrow(
      "Wait for the steward run to finish before changing its project.",
    );
    expect(steward().projectId).toBe(repo.id);
    expect(steward().run?.worktreeCwd).toBeTruthy();
  });
  it("runs a due steward in a throwaway worktree and proposes to-do tasks", async () => {
    const { stewards, tasks, repo, input, startDue, finish, steward, worktrees, turns, store } =
      setup();
    stewards.save(input());
    expect(steward().nextRunAt).toBe(new Date("2026-10-05T09:00:00").getTime());

    const turn = await startDue();
    expect(turn.input.cwd).not.toBe(repo.cwd);
    expect(existsSync(turn.input.cwd)).toBe(true);
    expect(worktrees()).toBe(2);
    expect(steward()).toMatchObject({ lastRunStatus: "running" });
    expect(store.session(turn.input.sessionId).session.title).toBe("Steward: repo");

    await finish(
      reply([
        { title: "Add retry tests", description: "In src/retry.ts cover backoff." },
        { title: "Fix flaky login", description: "Seen in auth.test.ts." },
      ]),
    );

    expect(steward()).toMatchObject({
      lastRunStatus: "succeeded",
      lastProposed: 2,
      lastSessionId: turn.input.sessionId,
    });
    expect(steward().run).toBeUndefined();
    // The next scheduled run moved on to tomorrow.
    expect(steward().nextRunAt).toBeGreaterThan(steward().lastRunAt!);
    const created = tasks.list();
    expect(created.map((task) => task.title)).toEqual(["Add retry tests", "Fix flaky login"]);
    expect(created[0]).toMatchObject({
      status: "todo",
      source: "steward",
      stewardId: "steward",
      projectId: repo.id,
      harness: "claude",
      model: "claude:test",
      prompt: "In src/retry.ts cover backoff.",
    });
    // The throwaway checkout and its branch are gone.
    expect(existsSync(turn.input.cwd)).toBe(false);
    expect(worktrees()).toBe(1);
    expect(git(repo.cwd, "branch", "--list", "mc/*")).toBe("");
    expect(turns).toHaveLength(1);
  });

  it("queues proposals when the steward starts them automatically", async () => {
    const { stewards, tasks, input, startDue, finish } = setup();
    stewards.save(input({ autoStart: true }));
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect(tasks.list()).toMatchObject([{ title: "Do it", status: "queued", source: "steward" }]);
  });

  it("keeps at most maxProposals", async () => {
    const { stewards, tasks, input, startDue, finish } = setup();
    stewards.save(input({ maxProposals: 2 }));
    await startDue();
    await finish(
      reply([
        { title: "One", description: "a" },
        { title: "Two", description: "b" },
        { title: "Three", description: "c" },
      ]),
    );
    expect(tasks.list().map((task) => task.title)).toEqual(["One", "Two"]);
  });

  it("skips a run while maxOpen proposals wait, and still moves on", async () => {
    const { stewards, tasks, input, taskInput, clock, steward, turns, repo } = setup();
    stewards.save(input({ maxOpen: 2 }));
    for (const id of ["a", "b"])
      tasks.save(taskInput({ id, title: `Open ${id}`, source: "steward", stewardId: "steward" }));
    clock.now += 2 * HOUR;
    await stewards.tick();
    expect(turns).toHaveLength(0);
    expect(steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: openLimitSkip(2),
    });
    expect(steward().nextRunAt).toBeGreaterThan(clock.now);
    expect(git(repo.cwd, "worktree", "list")).not.toContain("wt-mc");
  });

  it("skips a run while the previous one is still going", async () => {
    const { stewards, input, startDue, steward, turns } = setup();
    stewards.save(input());
    await startDue();
    await stewards.runNow("steward");
    expect(turns).toHaveLength(1);
    expect(steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: PREVIOUS_RUN_SKIP,
    });
    // The run itself is untouched.
    expect(steward().run).toBeDefined();
  });

  it("leaves out proposals that match open, done or declined work", async () => {
    const { stewards, tasks, input, taskInput, startDue, finish } = setup();
    stewards.save(input({ maxProposals: 10 }));
    tasks.save(taskInput({ id: "open", title: "Add  Retry Tests." }));
    tasks.save(taskInput({ id: "done", title: "Fix the login" }));
    await tasks.move("done", "done");
    tasks.save(
      taskInput({
        id: "mine",
        title: "Rename module",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await stewards.decline("mine");
    await startDue();
    await finish(
      reply([
        { title: "add retry tests", description: "dup of open" },
        { title: "  Fix the login!! ", description: "dup of done" },
        { title: "RENAME   module", description: "declined" },
        { title: "Brand new idea", description: "keep" },
        { title: "brand new idea.", description: "dup within the reply" },
      ]),
    );
    expect(
      tasks
        .list()
        .filter((task) => task.source === "steward")
        .map((task) => task.title),
    ).toEqual(["Brand new idea"]);
  });

  it("fails the run when the reply has no usable proposals", async () => {
    const { stewards, tasks, input, startDue, finish, steward, worktrees } = setup();
    stewards.save(input());
    await startDue();
    await finish("I looked around but forgot the json block.");
    expect(steward()).toMatchObject({ lastRunStatus: "failed" });
    expect(steward().lastRunError).toContain("json");
    expect(tasks.list()).toEqual([]);
    expect(worktrees()).toBe(1);

    await startDue();
    await finish("```json\n{not json\n```");
    expect(steward().lastRunStatus).toBe("failed");
    expect(steward().lastRunError).toContain("not valid JSON");
  });

  it("succeeds with no tasks when the steward proposes nothing", async () => {
    const { stewards, tasks, input, startDue, finish, steward } = setup();
    stewards.save(input());
    await startDue();
    await finish(reply([]));
    expect(steward()).toMatchObject({ lastRunStatus: "succeeded", lastProposed: 0 });
    expect(tasks.list()).toEqual([]);
  });

  it("keeps a proposal and its suppression list when dependent work prevents declining", async () => {
    const { stewards, tasks, input, taskInput, steward } = setup();
    stewards.save(input());
    tasks.save(taskInput({ id: "protected-proposal", title: "Keep me", source: "steward", stewardId: "steward" }));
    tasks.save(taskInput({ id: "dependent-proposal", dependsOn: ["protected-proposal"] }));
    await expect(stewards.decline("protected-proposal")).rejects.toThrow("depend");
    expect(tasks.get("protected-proposal")).toBeTruthy();
    expect(steward().declined).not.toContain("keep me");
  });
  it("declines a to-do suggestion: deletes it and remembers its title", async () => {
    const { stewards, tasks, input, taskInput, steward } = setup();
    stewards.save(input());
    tasks.save(
      taskInput({
        id: "mine",
        title: "  Rename   Module. ",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await stewards.decline("mine");
    expect(tasks.get("mine")).toBeUndefined();
    expect(steward().declined).toEqual(["rename module"]);
  });

  it("only declines to-do steward suggestions", async () => {
    const { stewards, tasks, input, taskInput } = setup();
    stewards.save(input());
    tasks.save(taskInput({ id: "manual" }));
    tasks.save(
      taskInput({ id: "queued", source: "steward", stewardId: "steward", status: "queued" }),
    );
    await expect(stewards.decline("manual")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("queued")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("missing")).rejects.toThrow("Task not found");
  });

  it("caps the declined list at 200 titles", async () => {
    const { stewards, tasks, input, taskInput, steward } = setup();
    stewards.save(input());
    for (let index = 0; index < 202; index++) {
      tasks.save(
        taskInput({
          id: `t${index}`,
          title: `Idea ${index}`,
          source: "steward",
          stewardId: "steward",
        }),
      );
      await stewards.decline(`t${index}`);
    }
    expect(steward().declined).toHaveLength(200);
    expect(steward().declined.at(-1)).toBe("idea 201");
    expect(steward().declined).not.toContain("idea 0");
  });

  it("allows one steward per project", () => {
    const { stewards, input, plain } = setup();
    stewards.save(input());
    expect(() => stewards.save(input({ id: "second" }))).toThrow(
      "This project already has a steward.",
    );
    // Editing it is fine, and so is a steward for another project.
    expect(stewards.save(input({ focus: "new focus" })).focus).toBe("new focus");
    stewards.save(input({ id: "other", projectId: plain.id }));
    expect(stewards.list()).toHaveLength(2);
  });

  it("keeps declined titles and last run across an edit", async () => {
    const { stewards, tasks, input, taskInput, steward } = setup();
    stewards.save(input());
    tasks.save(taskInput({ id: "mine", source: "steward", stewardId: "steward" }));
    await stewards.decline("mine");
    stewards.save(input({ maxOpen: 3 }));
    expect(steward()).toMatchObject({ declined: ["existing work"], maxOpen: 3 });
  });

  it("puts the read-only rule, focus and existing titles in the prompt", async () => {
    const { stewards, tasks, input, taskInput, startDue, finish } = setup();
    stewards.save(input());
    tasks.save(taskInput({ id: "o", title: "Open item" }));
    tasks.save(taskInput({ id: "d", title: "Finished item" }));
    await tasks.move("d", "done");
    tasks.save(
      taskInput({ id: "x", title: "Declined idea", source: "steward", stewardId: "steward" }),
    );
    await stewards.decline("x");
    const turn = await startDue();
    const prompt = turn.input.text;
    expect(prompt).toContain("repo");
    expect(prompt).toContain("follow docs/ROADMAP.md");
    expect(prompt).toContain("must NOT modify, create or delete");
    expect(prompt).toContain("read-only commands only");
    expect(prompt).toContain("- Open item");
    expect(prompt).toContain("- Finished item");
    expect(prompt).toContain("- declined idea");
    expect(prompt).toContain("at most 5");
    expect(prompt).toContain('{"proposals":[');
    await finish(reply([]));
  });

  it("runs a project that is not a git repository in place", async () => {
    const { stewards, input, plain, startDue, finish, steward } = setup();
    stewards.save(input({ projectId: plain.id }));
    const turn = await startDue();
    expect(turn.input.cwd).toBe(plain.cwd);
    expect(turn.input.text).toContain("the project folder itself");
    await finish(reply([{ title: "Idea", description: "Do it." }]));
    expect(steward().lastRunStatus).toBe("succeeded");
  });

  it("does not run a disabled steward, but runNow does", async () => {
    const { stewards, input, clock, turns, steward } = setup();
    stewards.save(input({ enabled: false }));
    clock.now += 2 * HOUR;
    await stewards.tick();
    expect(turns).toHaveLength(0);
    await stewards.runNow("steward");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10_000 });
    expect(steward().run).toBeDefined();
  });

  it("stops a run past its time limit and removes its checkout", async () => {
    const { stewards, input, startDue, clock, steward, worktrees } = setup();
    stewards.save(input());
    await startDue();
    clock.now += 21 * MINUTE;
    await stewards.tick();
    await vi.waitFor(() => expect(steward().run?.error).toBeDefined());
    clock.now += MINUTE;
    // Settling removes a worktree, which takes git a while.
    await vi.waitFor(
      async () => {
        await stewards.tick();
        expect(steward().lastRunStatus).toBe("failed");
      },
      { timeout: 30_000, interval: 200 },
    );
    expect(steward().lastRunError).toContain("20");
    expect(worktrees()).toBe(1);
  });

  it("cancels only the exact steward turn and settles through normal cleanup", async () => {
    const { stewards, input, startDue, steward, store, worktrees } = setup();
    stewards.save(input());
    const turn = await startDue();
    const runId = steward().run!.runId!;
    expect(() => stewards.stopRun("steward", "stale-turn")).toThrow("no longer active");
    expect(store.session(turn.input.sessionId).status).toBe("running");
    expect(stewards.stopRun("steward", runId)).toMatchObject({ requested: true, run: { runId } });
    await vi.waitFor(() => expect(store.session(turn.input.sessionId).status).toBe("idle"), { timeout: 10_000 });
    await stewards.tick();
    expect(steward().run).toBeUndefined();
    expect(steward().lastRunStatus).toBe("cancelled");
    expect(worktrees()).toBe(1);
    expect(() => stewards.stopRun("steward", runId)).toThrow("no longer active");
  });

  it("increments the configuration revision for same-clock saves", () => {
    const { stewards, input } = setup();
    const first = stewards.save(input());
    const second = stewards.save(input({ focus: "new focus" }));
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("removes the checkout when the steward is deleted mid-run", async () => {
    const { stewards, engine, input, startDue, worktrees, steward } = setup();
    stewards.save(input());
    const turn = await startDue();
    const capture = engine.checkpoints.finish.bind(engine.checkpoints);
    let releaseCapture!: () => void;
    let captureStarted = false;
    const gate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    vi.spyOn(engine.checkpoints, "finish").mockImplementation(async (...args) => {
      captureStarted = true;
      await gate;
      return capture(...args);
    });
    let deleted = false;
    const deletion = stewards.delete("steward").then(() => {
      deleted = true;
    });
    try {
      await vi.waitFor(() => expect(captureStarted).toBe(true));
      expect(deleted).toBe(false);
      expect(existsSync(turn.input.cwd)).toBe(true);
    } finally {
      releaseCapture();
      await deletion;
    }
    expect(stewards.list()).toEqual([]);
    expect(worktrees()).toBe(1);
    expect(existsSync(turn.input.cwd)).toBe(false);
    expect(steward).toBeDefined();
  });
});

describe("steward work limits and merging", () => {
  it("gives the tasks it creates the steward autoMerge setting", async () => {
    const { stewards, tasks, input, startDue, finish } = setup();
    stewards.save(input({ autoMerge: true }));
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect(tasks.list()).toMatchObject([{ title: "Do it", autoMerge: true }]);
  });

  it("leaves autoMerge off by default", async () => {
    const { stewards, tasks, input, startDue, finish } = setup();
    stewards.save(input());
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect(tasks.list()[0].autoMerge).toBeUndefined();
  });

  it("counts the run toward the day", async () => {
    const { stewards, tasks, input, startDue, finish } = setup();
    stewards.save(input());
    await startDue();
    await finish(reply([]));
    expect(tasks.limits.usedMinutes()).toBeCloseTo(1, 1);
  });

  it("records a skipped run once the day is used up, and runs again tomorrow", async () => {
    const { stewards, tasks, input, startDue, steward, turns, clock } = setup();
    stewards.save(input());
    tasks.limits.save({ dailyAgentMinutes: 1 });
    clock.now = steward().nextRunAt + MINUTE;
    tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await stewards.tick();
    await stewards.idle();
    expect(steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: DAILY_LIMIT_SKIP,
    });
    expect(turns).toHaveLength(0);

    await startDue();
    expect(steward().lastRunStatus).toBe("running");
    expect(turns).toHaveLength(1);
  });

  it("skips runNow too while the day is used up", async () => {
    const { stewards, tasks, input, steward, turns, clock } = setup();
    stewards.save(input());
    tasks.limits.save({ dailyAgentMinutes: 1 });
    tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await stewards.runNow("steward");
    expect(steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: DAILY_LIMIT_SKIP,
    });
    expect(turns).toHaveLength(0);
  });
});
