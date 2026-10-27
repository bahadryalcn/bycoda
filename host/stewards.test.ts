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
import { writerWorkspaces } from "./writer-workspaces.test-support";
import { DAILY_LIMIT_SKIP } from "../src/features/tasks/model/hostSettings";
// Managed runs capture real Git checkpoints before provider dispatch.
if (process.platform === "win32") vi.setConfig({ testTimeout: 120000 });
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
it("drains a held steward launch on close without dispatching its prepared session", async () => {
  const f = await setup();
  await f.stewards.save(f.input());
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const original = f.engine.updateSession.bind(f.engine);
  vi.spyOn(f.engine, "updateSession").mockImplementation(async (...args) => {
    const updated = await original(...args);
    entered.resolve();
    await released.promise;
    return updated;
  });
  const running = f.stewards.runNow("steward");
  await entered.promise;
  let closed = false;
  const closing = f.stewards.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  released.resolve();
  await Promise.all([running, closing]);
  expect((await f.steward()).run).toBeUndefined();
  expect(f.turns).toHaveLength(0);
  expect(f.worktrees()).toBe(1);
  await expect(f.stewards.runNow("steward")).rejects.toThrow("closing");
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const reply = (proposals: unknown) =>
  `Here is what I found.\n\n\`\`\`json\n${JSON.stringify({ proposals })}\n\`\`\``;
async function setup() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-stewards-test-")));
  const store = new HostStore(join(directory, "host.db"));
  const repo = await (async () => {
    const cwd = join(directory, "repo");
    mkdirSync(cwd);
    const added = await store.addProject(cwd, "repo");
    git(cwd, "init", "-q");
    git(cwd, "checkout", "-q", "-b", "main");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.test");
    writeFileSync(join(cwd, "file.txt"), "initial\n");
    git(cwd, "add", "file.txt");
    git(cwd, "commit", "-q", "-m", "initial");
    return added;
  })();
  const plain = await (async () => {
    const cwd = join(directory, "plain");
    mkdirSync(cwd);
    return await store.addProject(cwd, "plain");
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
  // Legacy per-file checkpoints are independent of this fixture. Managed runs
  // below attach real retained turn-history capture through writerWorkspaces.
  vi.spyOn(engine.checkpoints, "begin").mockResolvedValue();
  vi.spyOn(engine.checkpoints, "finish").mockResolvedValue();
  // 08:00 local; a daily steward at 09:00 is due an hour later.
  const clock = { now: new Date("2026-10-05T08:00:00").getTime() };
  const tasks = new HostTasks(store, engine, () => clock.now);
  const workspaces = writerWorkspaces(directory, async (id) => (await store.project(id)).cwd);
  await workspaces.attachEngine(engine);
  const stewards = new HostStewards(store, engine, tasks, () => clock.now, workspaces);
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    await tasks.idle();
    await stewards.idle();
    await engine.close();
    await store.close();
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
    isolate: true,
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    focus: "follow docs/ROADMAP.md",
    ...overrides,
  });
  const steward = async (id = "steward") =>
    (await stewards.list()).find((entry) => entry.id === id)!;
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
    clock.now = Math.max(clock.now, (await steward()).nextRunAt) + MINUTE;
    const started = turns.length + 1;
    await stewards.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(started), { timeout: 30000 });
    return turns.at(-1)!;
  };
  /** Ends the latest turn with `text` and lets the next tick settle it. */
  const finish = async (text: string) => {
    const turn = turns.at(-1)!;
    turn.input.onEvent({ type: "message.delta", text });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await vi.waitFor(
      async () => expect((await store.session(turn.input.sessionId)).status).toBe("idle"),
      {
        timeout: 30000,
      },
    );
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
    workspaces,
  };
}
describe("host stewards", () => {
  it("inherits worktree project policy when no steward choice is supplied", async () => {
    const f = await setup();
    const { createWorkspacePolicyResolver } = await import("./workspace-policy");
    const policy = createWorkspacePolicyResolver(f.store);
    await policy.update(
      {
        projectId: f.repo.id,
        environmentId: f.workspaces.environmentId,
        policy: { defaultMode: "worktree" },
        expectedRevision: 0,
        idempotencyKey: "steward-worktree",
      },
      { ownerId: "test", authorizationId: "test" },
    );
    f.workspaces.policy = policy;
    await f.stewards.save(f.input({ isolate: undefined }));
    await f.stewards.runNow("steward");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 20000 });
    expect(f.workspaces.prepare).toHaveBeenCalledOnce();
    expect(f.turns[0].input.cwd).toBe([...f.workspaces.rows.values()][0].path);
  });
  it("defaults steward runs and proposed tasks to the current checkout", async () => {
    const f = await setup();
    await f.stewards.save(f.input({ isolate: undefined }));
    await f.stewards.runNow("steward");
    await vi.waitFor(() => expect(f.turns).toHaveLength(1));
    expect(f.turns[0].input.cwd).toBe(f.repo.cwd);
    expect(f.workspaces.prepare).not.toHaveBeenCalled();
    expect(f.turns[0].input.text).toContain("the project folder itself");
    await f.finish(reply([{ title: "Cover retry", description: "Test retry recovery" }]));
    const proposal = (await f.tasks.list())[0];
    expect(proposal.isolate).toBeUndefined();
    await f.tasks.move(proposal.id, "queued");
    await f.tasks.tick();
    await vi.waitFor(() => expect(f.turns).toHaveLength(2));
    expect(f.turns[1].input.cwd).toBe(f.repo.cwd);
    expect((await f.tasks.get(proposal.id))?.isolate).toBe(false);
  });
  it("retains unexpected steward source through the removal interface", async () => {
    const f = await setup();
    await f.stewards.save(f.input());
    const turn = await f.startDue();
    const workspace = [...f.workspaces.rows.values()][0];
    writeFileSync(join(turn.input.cwd, "unexpected.txt"), "retain me");
    await f.finish(reply([]));
    expect(existsSync(turn.input.cwd)).toBe(true);
    expect(f.workspaces.plan).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: workspace.id }),
    );
    expect(f.workspaces.apply).not.toHaveBeenCalled();
    expect(git(f.repo.cwd, "rev-parse", workspace.branchRef)).toBeTruthy();
  });
  it("accepts only one concurrent edit of the same configuration", async () => {
    const f = await setup();
    const opening = await f.stewards.save(f.input({ enabled: false }));
    const results = await Promise.allSettled([
      f.stewards.save({ ...opening, focus: "First", expectedConfiguration: opening }),
      f.stewards.save({ ...opening, focus: "Second", expectedConfiguration: opening }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
  it("reserves a steward before awaited run and budget reads", async () => {
    const f = await setup();
    await f.stewards.save(f.input());
    const [first, second] = await Promise.all([
      f.stewards.runNow("steward"),
      f.stewards.runNow("steward"),
    ]);
    expect(first.run ?? second.run).toBeDefined();
    await vi.waitFor(() => expect(f.turns).toHaveLength(1), { timeout: 30000 });
    expect(f.worktrees()).toBe(2);
  });
  it("rejects stale configuration edits and toggles while preserving newer steward focus", async () => {
    const { stewards, input } = await setup();
    const opening = await stewards.save(input({ enabled: false }));
    const newer = await stewards.save({
      ...opening,
      focus: "Newer focus",
      expectedConfiguration: opening,
    });
    await expect(
      (async () =>
        await stewards.save({
          ...opening,
          model: "claude:other",
          expectedConfiguration: opening,
        }))(),
    ).rejects.toThrow("Configuration changed in another client");
    await expect(
      (async () =>
        await stewards.save({ ...opening, enabled: true, expectedConfiguration: opening }))(),
    ).rejects.toThrow("Configuration changed in another client");
    expect((await stewards.list())[0]).toEqual(newer);
    expect(
      await stewards.save({ ...newer, model: "claude:other", expectedConfiguration: newer }),
    ).toMatchObject({ focus: "Newer focus", model: "claude:other", enabled: false });
  });
  it("keeps an active run attached to the project that owns its checkout", async () => {
    const { stewards, repo, plain, input, startDue, steward } = await setup();
    await stewards.save(input());
    await startDue();
    await expect(
      (async () => await stewards.save(input({ projectId: plain.id })))(),
    ).rejects.toThrow("Wait for the steward run to finish before changing its project.");
    expect((await steward()).projectId).toBe(repo.id);
    expect((await steward()).run?.worktreeCwd).toBeTruthy();
  });
  it("runs a due steward in a throwaway worktree and proposes to-do tasks", async () => {
    const { stewards, tasks, repo, input, startDue, finish, steward, worktrees, turns, store } =
      await setup();
    await stewards.save(input());
    expect((await steward()).nextRunAt).toBe(new Date("2026-10-05T09:00:00").getTime());
    const turn = await startDue();
    expect(turn.input.cwd).not.toBe(repo.cwd);
    expect(existsSync(turn.input.cwd)).toBe(true);
    expect(worktrees()).toBe(2);
    expect(await steward()).toMatchObject({ lastRunStatus: "running" });
    expect((await store.session(turn.input.sessionId)).session.title).toBe("Steward: repo");
    await finish(
      reply([
        { title: "Add retry tests", description: "In src/retry.ts cover backoff." },
        { title: "Fix flaky login", description: "Seen in auth.test.ts." },
      ]),
    );
    expect(await steward()).toMatchObject({
      lastRunStatus: "succeeded",
      lastProposed: 2,
      lastSessionId: turn.input.sessionId,
    });
    expect((await steward()).run).toBeUndefined();
    // The next scheduled run moved on to tomorrow.
    expect((await steward()).nextRunAt).toBeGreaterThan((await steward()).lastRunAt!);
    const created = await tasks.list();
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
    // Directory retirement preserves the owned branch.
    expect(existsSync(turn.input.cwd)).toBe(false);
    expect(worktrees()).toBe(1);
    expect(git(repo.cwd, "branch", "--list", "bycoda/t/*")).not.toBe("");
    expect(turns).toHaveLength(1);
  });
  it("queues proposals when the steward starts them automatically", async () => {
    const { stewards, tasks, input, startDue, finish } = await setup();
    await stewards.save(input({ autoStart: true }));
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect(await tasks.list()).toMatchObject([
      { title: "Do it", status: "queued", source: "steward" },
    ]);
  });
  it("keeps at most maxProposals", async () => {
    const { stewards, tasks, input, startDue, finish } = await setup();
    await stewards.save(input({ maxProposals: 2 }));
    await startDue();
    await finish(
      reply([
        { title: "One", description: "a" },
        { title: "Two", description: "b" },
        { title: "Three", description: "c" },
      ]),
    );
    expect((await tasks.list()).map((task) => task.title)).toEqual(["One", "Two"]);
  });
  it("skips a run while maxOpen proposals wait, and still moves on", async () => {
    const { stewards, tasks, input, taskInput, clock, steward, turns, repo } = await setup();
    await stewards.save(input({ maxOpen: 2 }));
    for (const id of ["a", "b"])
      await tasks.save(
        taskInput({ id, title: `Open ${id}`, source: "steward", stewardId: "steward" }),
      );
    clock.now += 2 * HOUR;
    await stewards.tick();
    expect(turns).toHaveLength(0);
    expect(await steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: openLimitSkip(2),
    });
    expect((await steward()).nextRunAt).toBeGreaterThan(clock.now);
    expect(git(repo.cwd, "worktree", "list")).not.toContain("wt-mc");
  });
  it("skips a run while the previous one is still going", async () => {
    const { stewards, input, startDue, steward, turns } = await setup();
    await stewards.save(input());
    await startDue();
    await stewards.runNow("steward");
    expect(turns).toHaveLength(1);
    expect(await steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: PREVIOUS_RUN_SKIP,
    });
    // The run itself is untouched.
    expect((await steward()).run).toBeDefined();
  });
  it("leaves out proposals that match open, done or declined work", async () => {
    const { stewards, tasks, input, taskInput, startDue, finish } = await setup();
    await stewards.save(input({ maxProposals: 10 }));
    await tasks.save(taskInput({ id: "open", title: "Add  Retry Tests." }));
    await tasks.save(taskInput({ id: "done", title: "Fix the login" }));
    await tasks.move("done", "done");
    await tasks.save(
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
      (await tasks.list()).filter((task) => task.source === "steward").map((task) => task.title),
    ).toEqual(["Brand new idea"]);
  });
  it("fails the run when the reply has no usable proposals", async () => {
    const { stewards, tasks, input, startDue, finish, steward, worktrees } = await setup();
    await stewards.save(input());
    await startDue();
    await finish("I looked around but forgot the json block.");
    expect(await steward()).toMatchObject({ lastRunStatus: "failed" });
    expect((await steward()).lastRunError).toContain("json");
    expect(await tasks.list()).toEqual([]);
    expect(worktrees()).toBe(1);
    await startDue();
    await finish("```json\n{not json\n```");
    expect((await steward()).lastRunStatus).toBe("failed");
    expect((await steward()).lastRunError).toContain("not valid JSON");
  });
  it("succeeds with no tasks when the steward proposes nothing", async () => {
    const { stewards, tasks, input, startDue, finish, steward } = await setup();
    await stewards.save(input());
    await startDue();
    await finish(reply([]));
    expect(await steward()).toMatchObject({ lastRunStatus: "succeeded", lastProposed: 0 });
    expect(await tasks.list()).toEqual([]);
  });
  it("keeps a proposal and its suppression list when dependent work prevents declining", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(
      taskInput({
        id: "protected-proposal",
        title: "Keep me",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await tasks.save(taskInput({ id: "dependent-proposal", dependsOn: ["protected-proposal"] }));
    await expect(stewards.decline("protected-proposal")).rejects.toThrow("depend");
    expect(await tasks.get("protected-proposal")).toBeTruthy();
    expect((await steward()).declined).not.toContain("keep me");
  });
  it("declines a to-do suggestion: deletes it and remembers its title", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(
      taskInput({
        id: "mine",
        title: "  Rename   Module. ",
        source: "steward",
        stewardId: "steward",
      }),
    );
    await stewards.decline("mine");
    expect(await tasks.get("mine")).toBeUndefined();
    expect((await steward()).declined).toEqual(["rename module"]);
  });
  it("only declines to-do steward suggestions", async () => {
    const { stewards, tasks, input, taskInput } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "manual" }));
    await tasks.save(
      taskInput({ id: "queued", source: "steward", stewardId: "steward", status: "queued" }),
    );
    await expect(stewards.decline("manual")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("queued")).rejects.toThrow("Only a to-do suggestion");
    await expect(stewards.decline("missing")).rejects.toThrow("Task not found");
  });
  it("caps the declined list at 200 titles", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    for (let index = 0; index < 202; index++) {
      await tasks.save(
        taskInput({
          id: `t${index}`,
          title: `Idea ${index}`,
          source: "steward",
          stewardId: "steward",
        }),
      );
      await stewards.decline(`t${index}`);
    }
    expect((await steward()).declined).toHaveLength(200);
    expect((await steward()).declined.at(-1)).toBe("idea 201");
    expect((await steward()).declined).not.toContain("idea 0");
  });
  it("allows one steward per project", async () => {
    const { stewards, input, plain } = await setup();
    await stewards.save(input());
    await expect((async () => await stewards.save(input({ id: "second" })))()).rejects.toThrow(
      "This project already has a steward.",
    );
    // Editing it is fine, and so is a steward for another project.
    expect((await stewards.save(input({ focus: "new focus" }))).focus).toBe("new focus");
    await stewards.save(input({ id: "other", projectId: plain.id }));
    expect(await stewards.list()).toHaveLength(2);
  });
  it("keeps declined titles and last run across an edit", async () => {
    const { stewards, tasks, input, taskInput, steward } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "mine", source: "steward", stewardId: "steward" }));
    await stewards.decline("mine");
    await stewards.save(input({ maxOpen: 3 }));
    expect(await steward()).toMatchObject({ declined: ["existing work"], maxOpen: 3 });
  });
  it("puts the read-only rule, focus and existing titles in the prompt", async () => {
    const { stewards, tasks, input, taskInput, startDue, finish } = await setup();
    await stewards.save(input());
    await tasks.save(taskInput({ id: "o", title: "Open item" }));
    await tasks.save(taskInput({ id: "d", title: "Finished item" }));
    await tasks.move("d", "done");
    await tasks.save(
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
  it("fails closed for a project without a committed Git base", async () => {
    const { stewards, input, plain, steward, turns } = await setup();
    await stewards.save(input({ projectId: plain.id }));
    await stewards.runNow("steward");
    expect(turns).toHaveLength(0);
    expect((await steward()).lastRunStatus).toBe("failed");
  });
  it("does not run a disabled steward, but runNow does", async () => {
    const { stewards, input, clock, turns, steward } = await setup();
    await stewards.save(input({ enabled: false }));
    clock.now += 2 * HOUR;
    await stewards.tick();
    expect(turns).toHaveLength(0);
    await stewards.runNow("steward");
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 30000 });
    expect((await steward()).run).toBeDefined();
  });
  it("stops a run past its time limit and removes its checkout", async () => {
    const { stewards, input, startDue, clock, steward, worktrees } = await setup();
    await stewards.save(input());
    await startDue();
    clock.now += 21 * MINUTE;
    await stewards.tick();
    await vi.waitFor(async () => expect((await steward()).run?.error).toBeDefined());
    clock.now += MINUTE;
    // Settling removes a worktree, which takes git a while.
    await vi.waitFor(
      async () => {
        await stewards.tick();
        expect((await steward()).lastRunStatus).toBe("failed");
      },
      { timeout: 30000, interval: 200 },
    );
    expect((await steward()).lastRunError).toContain("20");
    expect(worktrees()).toBe(1);
  });
  it("cancels only the exact steward turn and settles through normal cleanup", async () => {
    const { stewards, input, startDue, steward, store, worktrees } = await setup();
    await stewards.save(input());
    const turn = await startDue();
    const runId = (await steward()).run!.runId!;
    await expect((async () => await stewards.stopRun("steward", "stale-turn"))()).rejects.toThrow(
      "no longer active",
    );
    expect((await store.session(turn.input.sessionId)).status).toBe("running");
    expect(await stewards.stopRun("steward", runId)).toMatchObject({
      requested: true,
      run: { runId },
    });
    await vi.waitFor(
      async () => expect((await store.session(turn.input.sessionId)).status).toBe("idle"),
      { timeout: 30000 },
    );
    await stewards.tick();
    expect((await steward()).run).toBeUndefined();
    expect((await steward()).lastRunStatus).toBe("cancelled");
    expect(worktrees()).toBe(1);
    await expect((async () => await stewards.stopRun("steward", runId))()).rejects.toThrow(
      "no longer active",
    );
  });
  it("increments the configuration revision for same-clock saves", async () => {
    const { stewards, input } = await setup();
    const first = await stewards.save(input());
    const second = await stewards.save(input({ focus: "new focus" }));
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
  it("removes the checkout when the steward is deleted mid-run", async () => {
    const { stewards, input, startDue, worktrees, steward, workspaces } = await setup();
    await stewards.save(input());
    const turn = await startDue();
    let releaseCapture!: () => void;
    let captureStarted = false;
    const gate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const end = workspaces.history.end.bind(workspaces.history);
    vi.spyOn(workspaces.history, "end").mockImplementation(async (request) => {
      captureStarted = true;
      await gate;
      return await end(request);
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
    expect(await stewards.list()).toEqual([]);
    expect(worktrees()).toBe(1);
    expect(existsSync(turn.input.cwd)).toBe(false);
    expect(steward).toBeDefined();
  });
});
describe("steward work limits and merging", () => {
  it("suspends the steward automatic merge preference for new tasks", async () => {
    const { stewards, tasks, input, startDue, finish } = await setup();
    await stewards.save(input({ autoMerge: true }));
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect(await tasks.list()).toMatchObject([{ title: "Do it" }]);
    expect((await tasks.list())[0].autoMerge).not.toBe(true);
  });
  it("leaves autoMerge off by default", async () => {
    const { stewards, tasks, input, startDue, finish } = await setup();
    await stewards.save(input());
    await startDue();
    await finish(reply([{ title: "Do it", description: "Specific work." }]));
    expect((await tasks.list())[0].autoMerge).toBeUndefined();
  });
  it("counts the run toward the day", async () => {
    const { stewards, tasks, input, startDue, finish } = await setup();
    await stewards.save(input());
    await startDue();
    await finish(reply([]));
    expect(await tasks.limits.usedMinutes()).toBeCloseTo(1, 1);
  });
  it("records a skipped run once the day is used up, and runs again tomorrow", async () => {
    const { stewards, tasks, input, startDue, steward, turns, clock } = await setup();
    await stewards.save(input());
    await tasks.limits.save({ dailyAgentMinutes: 1 });
    clock.now = (await steward()).nextRunAt + MINUTE;
    await tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await stewards.tick();
    await stewards.idle();
    expect(await steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: DAILY_LIMIT_SKIP,
    });
    expect(turns).toHaveLength(0);
    await startDue();
    expect((await steward()).lastRunStatus).toBe("running");
    expect(turns).toHaveLength(1);
  });
  it("skips runNow too while the day is used up", async () => {
    const { stewards, tasks, input, steward, turns, clock } = await setup();
    await stewards.save(input());
    await tasks.limits.save({ dailyAgentMinutes: 1 });
    await tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await stewards.runNow("steward");
    expect(await steward()).toMatchObject({
      lastRunStatus: "skipped",
      lastRunError: DAILY_LIMIT_SKIP,
    });
    expect(turns).toHaveLength(0);
  });
});
