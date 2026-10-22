import { afterEach, describe, expect, it, vi } from "vitest";
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
import { HostStore } from "./store";
import { HostTasks, MAX_RUNNING_TASKS, MAX_REPAIR_ATTEMPTS } from "./tasks";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MINUTE = 60_000;
/** Tests that run a check command start a real shell. */
const SHELL_TEST_MS = 60_000;
// Checkpoint capture runs real Git before and after each worker/reviewer turn.
// Multi-turn scenarios on Windows need the same budget as real shell checks.
if (process.platform === "win32") vi.setConfig({ testTimeout: SHELL_TEST_MS });

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  }).trim();

function setup(verifyTimeoutMs?: number) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-tasks-test-")));
  const store = new HostStore(join(directory, "host.db"));
  const gitProjects = new Set<string>();
  const addProject = (name: string) => {
    const cwd = join(directory, name);
    mkdirSync(cwd);
    return store.addProject(cwd, name);
  };
  /** A project that is a git repository on `main`, with one commit. */
  const addRepo = (name: string) => {
    const added = addProject(name);
    git(added.cwd, "init", "-q");
    git(added.cwd, "checkout", "-q", "-b", "main");
    git(added.cwd, "config", "user.name", "Test");
    git(added.cwd, "config", "user.email", "test@example.test");
    // A Windows runner defaults to autocrlf=true, which rewrites the files these tests read back.
    git(added.cwd, "config", "core.autocrlf", "false");
    writeFileSync(join(added.cwd, "file.txt"), "initial\n");
    git(added.cwd, "add", "file.txt");
    git(added.cwd, "commit", "-q", "-m", "initial");
    gitProjects.add(added.id);
    return added;
  };
  const project = addProject("first");
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
  const tasks = new HostTasks(store, engine, () => clock.now, verifyTimeoutMs);
  const providersStarted = async () => {
    // Checkpoint capture is serialized across sessions. Each run gets the
    // existing readiness budget instead of sharing one deadline with all peers.
    for (const value of store.sessions().filter((entry) => entry.status === "running")) {
      await vi.waitFor(
        () => {
          expect(turns.findLast((turn) => turn.input.sessionId === value.session.id)?.runId).toBe(
            value.runId,
          );
        },
        { timeout: 10_000 },
      );
    }
  };
  const tick = tasks.tick.bind(tasks);
  vi.spyOn(tasks, "tick").mockImplementation(async () => {
    await tick();
    // A running record precedes checkpoint capture and the provider's send.
    await providersStarted();
  });
  const idle = tasks.idle.bind(tasks);
  vi.spyOn(tasks, "idle").mockImplementation(async () => {
    await idle();
    // Verification jobs may launch a reviewer after the scheduler tick.
    await providersStarted();
  });
  cleanups.push(async () => {
    for (const turn of turns) turn.finish();
    // Close first so a queued checkpoint cannot launch a new unresolved mock
    // provider after the finish loop. Shutdown must not assert startup readiness.
    await engine.close();
    await idle();
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "main",
    title: "Ship the report",
    prompt: "Write the weekly report",
    projectId: project.id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    maxRunMinutes: 0,
    // Plain fixtures run directly; isolation now requires an actual repository.
    isolate: gitProjects.has(String(overrides.projectId ?? project.id)),
    // The reviewer has tests of its own.
    review: false,
    ...overrides,
  });
  const task = (id = "main") => tasks.list().find((entry) => entry.id === id)!;
  const settled = (sessionId: string) =>
    vi.waitFor(() => expect(store.session(sessionId).status).toBe("idle"), { timeout: 10_000 });
  const interrupt = async (
    sessionId: string,
    note = "Host restarted. This turn was interrupted; inspect its work before continuing.",
  ) => {
    turns.findLast((turn) => turn.input.sessionId === sessionId)!.finish();
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
            { id: "host-interruption", role: "system", text: note },
          ],
        },
      },
      { type: "interrupted" },
    );
  };
  /** Saves a task and starts it; later saves get a later creation time. */
  const run = async (overrides: Record<string, unknown> = {}) => {
    const saved = tasks.save(input(overrides));
    clock.now += 1;
    const started = turns.length + 1;
    await tasks.tick();
    // Creating a real Git worktree can outlast Vitest's 1s polling budget on Windows.
    await vi.waitFor(() => expect(turns).toHaveLength(started), {
      timeout: process.platform === "win32" ? 10_000 : 1_000,
    });
    return task(saved.id);
  };
  /** A minute later: settles what finished and lets its checks run. */
  const advance = async () => {
    clock.now += MINUTE;
    await tasks.tick();
    await tasks.idle();
  };
  /** Ends the requested session turn cleanly and settles it. */
  const finish = async (sessionId: string, reply?: string) => {
    await providersStarted();
    const turn = turns.findLast((turn) => turn.input.sessionId === sessionId)!;
    if (reply !== undefined) {
      turn.input.onEvent({ type: "message.delta", text: reply });
      turn.input.onEvent({ type: "message.completed" });
    }
    turn.finish();
    await settled(sessionId);
    await advance();
  };
  /** Runs a task to a clean finish, leaving it in review. `files` is what
   * the agent leaves uncommitted in its working copy. */
  const review = async (
    overrides: Record<string, unknown> = {},
    files: Record<string, string> = {},
  ) => {
    const started = await run(overrides);
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(turns.at(-1)!.input.cwd, name), text);
    await finish(started.sessionId!);
    return task(started.id);
  };
  /** Runs a task to its reviewer, which is the latest turn afterwards. */
  const reviewing = async (overrides: Record<string, unknown> = {}) => {
    const started = await run({ review: true, ...overrides });
    await finish(started.sessionId!);
    await vi.waitFor(() => expect(turns.at(-1)!.input.text).toContain("VERDICT: PASS"));
    return task(started.id);
  };
  return {
    directory,
    store,
    engine,
    provider,
    turns,
    clock,
    tasks,
    input,
    task,
    settled,
    interrupt,
    run,
    review,
    reviewing,
    advance,
    finish,
    addProject,
    addRepo,
  };
}

describe("explicit task workspaces and owner controls", () => {
  it("rejects stale configuration saves without replacing newer task instructions", () => {
    const { tasks, input } = setup();
    const opening = tasks.save(input({ status: "todo" }));
    const newer = tasks.save({
      ...input({ status: "todo", prompt: "Newer instructions" }),
      expectedConfiguration: opening,
    });
    expect(() =>
      tasks.save({
        ...input({ status: "todo", title: "My new title" }),
        expectedConfiguration: opening,
      }),
    ).toThrow("Configuration changed in another client");
    expect(tasks.get(opening.id)).toEqual(newer);
    expect(
      tasks.save({
        ...input({ status: "todo", prompt: newer.prompt, title: "Reconciled" }),
        expectedConfiguration: newer,
      }),
    ).toMatchObject({ title: "Reconciled", prompt: "Newer instructions", status: "todo" });
  });
  it("delivers into a selected integration checkout while preserving dirty main", async () => {
    const { addRepo, review, tasks, input } = setup();
    const repo = addRepo("selected");
    const integration = join(repo.cwd, "..", "integration");
    git(repo.cwd, "worktree", "add", "-q", "-b", "goal/settings", integration, "HEAD");
    writeFileSync(join(repo.cwd, "file.txt"), "owner work\n");
    const before = git(repo.cwd, "status", "--porcelain");
    const done = await review(
      {
        projectId: repo.id,
        workspace: {
          checkoutCwd: integration,
          baseBranch: "goal/settings",
          branchName: "mc/selected",
        },
      },
      { "result.txt": "task result\n" },
    );
    expect(done).toMatchObject({
      baseBranch: "goal/settings",
      branch: "mc/selected",
      deliveryCwd: integration,
    });
    const delivered = await tasks.move(done.id, "done");
    expect(delivered.deliveredCommit).toBe(git(integration, "rev-parse", "HEAD"));
    expect(readFileSync(join(integration, "result.txt"), "utf8")).toBe("task result\n");
    expect(git(repo.cwd, "status", "--porcelain")).toBe(before);
    expect(existsSync(integration)).toBe(true);
    tasks.save(
      input({
        id: "wrong-base",
        projectId: repo.id,
        dependsOn: [done.id],
        workspace: { checkoutCwd: repo.cwd, baseBranch: "main" },
      }),
    );
    await tasks.tick();
    expect(tasks.get("wrong-base")?.error).toContain("does not contain completed dependency");
  }, 60_000);

  it("keeps a direct project run free of contradictory worktree instructions", async () => {
    const { addRepo, run, turns } = setup();
    const repo = addRepo("default-direct");
    const started = await run({ projectId: repo.id, isolate: false });
    expect(started.worktreeCwd).toBeUndefined();
    expect(turns[0].input.cwd).toBe(repo.cwd);
    expect(turns[0].input.text).not.toContain("a separate checkout");
  }, 60_000);

  it("retains a removed delivery worktree error on the reviewed result", async () => {
    const { addRepo, review, tasks } = setup();
    const repo = addRepo("removed-target");
    const checkout = join(repo.cwd, "..", "temporary-target");
    git(repo.cwd, "worktree", "add", "-q", "-b", "goal/temporary", checkout, "HEAD");
    const result = await review({
      projectId: repo.id,
      workspace: { checkoutCwd: checkout, baseBranch: "goal/temporary" },
    });
    git(repo.cwd, "worktree", "remove", checkout);
    await expect(tasks.move(result.id, "done")).rejects.toThrow("available worktree");
    expect(tasks.get(result.id)).toMatchObject({
      status: "review",
      mergeError: expect.stringContaining("available worktree"),
    });
  }, 60_000);

  it("runs direct tasks concurrently in the shared owner worktree and retains it", async () => {
    const { addRepo, input, tasks, turns, finish } = setup();
    const repo = addRepo("direct");
    const checkout = join(repo.cwd, "..", "owner-tree");
    git(repo.cwd, "worktree", "add", "-q", "-b", "owner", checkout, "HEAD");
    for (const id of ["one", "two"])
      tasks.save(
        input({
          id,
          projectId: repo.id,
          isolate: false,
          workspace: { checkoutCwd: checkout, baseBranch: "owner" },
        }),
      );
    await tasks.tick();
    expect(tasks.get("one")?.status).toBe("running");
    expect(tasks.get("two")?.status).toBe("running");
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    await finish(tasks.get("one")!.sessionId!);
    expect(tasks.get("one")?.status).toBe("done");
    await tasks.tick();
    expect(tasks.get("two")?.status).toBe("running");
    expect(existsSync(checkout)).toBe(true);
    expect(git(checkout, "branch", "--show-current")).toBe("owner");
  }, 60_000);

  it("closes a fixture before a queued checkpoint can start another provider", async () => {
    const { directory, store, engine, provider, tasks, input } = setup();
    let entered!: () => void;
    let release!: () => void;
    const capturing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const captured = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(engine.checkpoints, "begin").mockImplementation(async () => {
      entered();
      await captured;
    });
    // Schedule a real task, but keep its checkpoint pending before provider.send.
    vi.mocked(tasks.tick).mockRestore();
    const saved = tasks.save(input());
    await tasks.tick();
    await capturing;
    expect(store.session(tasks.get(saved.id)!.sessionId!).status).toBe("running");
    expect(provider.send).not.toHaveBeenCalled();
    // Exercise the same registered cleanup used after a readiness assertion fails.
    const cleanup = cleanups.pop()!;
    const closing = cleanup();
    release();
    await closing;
    expect(provider.send).not.toHaveBeenCalled();
    expect(existsSync(directory)).toBe(false);
  });

  it("runs six direct tasks on main without committing the shared changes", async () => {
    const { addRepo, input, tasks, turns, finish } = setup();
    const repo = addRepo("shared-main");
    const head = git(repo.cwd, "rev-parse", "HEAD");
    writeFileSync(join(repo.cwd, "file.txt"), "owner changes\n");
    tasks.limits.save({ maxRunningTasks: 6 });
    const ids = Array.from({ length: 6 }, (_, index) => `direct-${index}`);
    for (const id of ids)
      tasks.save(input({ id, projectId: repo.id, isolate: false, review: false }));
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(6));
    expect(ids.map((id) => tasks.get(id)?.status)).toEqual(Array(6).fill("running"));
    for (const id of ids) {
      expect(tasks.get(id)?.branch).toBeUndefined();
      writeFileSync(join(repo.cwd, `${id}.txt`), `${id}\n`);
      await finish(tasks.get(id)!.sessionId!);
    }
    expect(ids.map((id) => tasks.get(id)?.status)).toEqual(Array(6).fill("done"));
    expect(git(repo.cwd, "branch", "--show-current")).toBe("main");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("owner changes\n");
    for (const id of ids) expect(readFileSync(join(repo.cwd, `${id}.txt`), "utf8")).toBe(`${id}\n`);
  }, 60_000);

  it("rejects a worktree belonging to another repository before launching", async () => {
    const { addRepo, input, tasks, turns } = setup();
    const repo = addRepo("owned"),
      other = addRepo("other");
    tasks.save(input({ projectId: repo.id, workspace: { checkoutCwd: other.cwd } }));
    await tasks.tick();
    expect(tasks.get("main")?.status).toBe("blocked");
    expect(turns).toHaveLength(0);
    tasks.save({
      ...input(),
      ...tasks.get("main"),
      workspace: { checkoutCwd: repo.cwd, baseBranch: "main" },
      status: undefined,
    });
    await tasks.startTask("main");
    expect(tasks.get("main")?.status).toBe("running");
  }, 60_000);

  it("starts an owner-selected todo first while retaining capacity and dependencies", async () => {
    const { tasks, input } = setup();
    tasks.limits.save({ maxRunningTasks: 1 });
    tasks.save(input({ id: "old" }));
    tasks.save(input({ id: "chosen", status: "todo" }));
    expect((await tasks.startTask("chosen")).status).toBe("running");
    expect(tasks.get("old")?.status).toBe("queued");
    tasks.save(input({ id: "dependent", status: "todo", dependsOn: ["chosen"] }));
    expect((await tasks.startTask("dependent")).status).toBe("queued");
    expect(tasks.list().filter((task) => task.status === "running")).toHaveLength(1);
  });

  it("retargets a reviewed goal result and its pending tasks without rerunning", async () => {
    const { addRepo, review, tasks, input, store, turns } = setup();
    const repo = addRepo("retarget");
    store.db.exec("CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    store.db
      .prepare("INSERT INTO goals VALUES (?,?)")
      .run("goal", JSON.stringify({ id: "goal", status: "running" }));
    const reviewed = await review(
      { projectId: repo.id, goalId: "goal" },
      { "result.txt": "delivered\n" },
    );
    tasks.save(input({ id: "next", projectId: repo.id, goalId: "goal", dependsOn: [reviewed.id] }));
    writeFileSync(join(repo.cwd, "file.txt"), "ongoing owner edits\n");
    const checkout = join(repo.cwd, "..", "delivery");
    git(repo.cwd, "worktree", "add", "-q", "-b", "goal/delivery", checkout, "HEAD");
    await tasks.retarget(reviewed.id, { checkoutCwd: checkout, baseBranch: "goal/delivery" });
    expect(turns).toHaveLength(1);
    expect(tasks.get("next")?.workspace).toMatchObject({ checkoutCwd: checkout });
    await tasks.move(reviewed.id, "done");
    await tasks.tick();
    expect(tasks.get("next")).toMatchObject({ status: "running", baseBranch: "goal/delivery" });
    expect(readFileSync(join(tasks.get("next")!.worktreeCwd!, "result.txt"), "utf8")).toBe(
      "delivered\n",
    );
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("ongoing owner edits\n");
  }, 60_000);

  it("validates reorder requests and persists the new queue order", () => {
    const { tasks, input } = setup();
    for (const id of ["one", "two"]) tasks.save(input({ id }));
    tasks.save(input({ id: "todo", status: "todo" }));
    expect(() => tasks.reorder(["one", "todo"])).toThrow("one status");
    expect(() => tasks.reorder(["one", "one"])).toThrow("Invalid task order");
    tasks.reorder(["two", "one"]);
    expect(tasks.get("two")?.position).toBe(0);
    expect(tasks.get("one")?.position).toBe(1);
  });
});

describe("host tasks", () => {
  it("queues a saved task and lists tasks oldest first", () => {
    const { tasks, input, clock } = setup();
    const first = tasks.save(input());
    expect(first).toMatchObject({ status: "queued", createdAt: clock.now });
    clock.now += 1;
    const second = tasks.save(input({ id: "second" }));
    expect(tasks.list()).toEqual([first, second]);
  });

  it("rejects a task for an unknown project", () => {
    const { tasks, input } = setup();
    expect(() => tasks.save(input({ projectId: "missing" }))).toThrow(
      "Project is not registered on this machine",
    );
  });

  it("recomputes the change etag only after a task is written or removed", () => {
    const { tasks, input, clock, store } = setup();
    const empty = tasks.changeEtag();
    const revision = tasks.revision;
    expect(tasks.changeEtag()).toBe(empty);
    expect(tasks.revision).toBe(revision);
    tasks.save(input());
    const one = tasks.changeEtag();
    expect(one).not.toBe(empty);
    // Unchanged rows are not parsed again while polling.
    const prepare = vi.spyOn(store.db, "prepare");
    expect(tasks.changeEtag()).toBe(one);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    clock.now += 1;
    tasks.save(input({ id: "second" }));
    expect(tasks.changeEtag()).not.toBe(one);
  });

  it("shares one list/index across a tick and applies hook writes and deletes before dependency checks", async () => {
    const { tasks, input, turns } = setup();
    tasks.save(input({ id: "parent" }));
    tasks.save(input({ id: "child", dependsOn: ["parent"] }));
    const list = vi.spyOn(tasks, "list");
    tasks.limits.save({ dailyAgentMinutes: 1 });
    tasks.onTick(async () => {
      expect(tasks.taskIndex().has("parent")).toBe(true);
      // Reading the limit source must reuse this pass too.
      tasks.limits.usedMinutes();
      await tasks.delete("parent");
      tasks.save(input({ id: "child", status: "queued", dependsOn: ["parent"] }));
    });
    await tasks.tick();
    expect(list).toHaveBeenCalledTimes(1);
    expect(tasks.get("parent")).toBeUndefined();
    expect(tasks.get("child")?.status).toBe("running");
    expect(turns).toHaveLength(1);
  });

  it("invalidates the goal task index after saves and deletion", async () => {
    const { tasks, input } = setup();
    const empty = tasks.taskIndex();
    expect(tasks.taskIndex()).toBe(empty);
    tasks.save(input());
    const saved = tasks.taskIndex();
    expect(saved).not.toBe(empty);
    expect(saved.get("main")?.title).toBe("Ship the report");
    tasks.save(input({ title: "Updated" }));
    expect(tasks.taskIndex().get("main")?.title).toBe("Updated");
    await tasks.delete("main");
    expect(tasks.taskIndex().size).toBe(0);
  });

  it("does not schedule rolled-back tasks or release their dependencies in the same pass", async () => {
    const { tasks, input, turns } = setup();
    tasks.save(input({ id: "parent", status: "todo" }));
    tasks.save(input({ id: "child", dependsOn: ["parent"] }));
    const list = vi.spyOn(tasks, "list");
    tasks.onTick(() => {
      expect(() =>
        tasks.transaction(() => {
          tasks.save(input({ id: "ghost" }));
          tasks.save(input({ id: "parent", title: "Uncommitted" }));
          throw new Error("Rollback fixture");
        }),
      ).toThrow("Rollback fixture");
      expect(tasks.taskIndex().get("parent")?.title).toBe("Ship the report");
      expect(tasks.taskIndex().has("ghost")).toBe(false);
    });
    await tasks.tick();
    expect(list).toHaveBeenCalledTimes(1);
    expect(tasks.get("child")?.status).toBe("queued");
    expect(turns).toHaveLength(0);
  });

  it("starts a direct queued task in a session named after it and completes it", async () => {
    const { tasks, run, task, store, turns, settled, clock } = setup();
    const started = await run();
    expect(started).toMatchObject({ status: "running", startedAt: clock.now });
    expect(store.session(started.sessionId!).session.title).toBe("Ship the report");
    expect(
      JSON.parse(turns[0].input.text.slice(turns[0].input.text.indexOf("{"))).task.instructions
        .objective,
    ).toBe("Write the weekly report");

    turns[0].finish();
    await settled(started.sessionId!);
    clock.now += MINUTE;
    await tasks.tick();
    await tasks.idle();
    expect(task()).toMatchObject({
      status: "done",
      completedAt: clock.now,
      sessionId: started.sessionId,
      verification: {},
    });
    expect(task().error).toBeUndefined();
  });

  it("blocks a task whose turn failed, with the agent error", async () => {
    const { tasks, run, task, turns, settled, clock } = setup();
    const started = await run();
    turns[0].fail(new Error("Not signed in"));
    await settled(started.sessionId!);
    clock.now += MINUTE;
    await tasks.tick();
    expect(task()).toMatchObject({ status: "blocked", error: "Not signed in" });
  });

  it("stops a task that passes its time limit and blocks it", async () => {
    const { tasks, run, task, provider, settled, clock } = setup();
    const started = await run({ maxRunMinutes: 30 });

    clock.now += 29 * MINUTE;
    await tasks.tick();
    expect(provider.cancel).not.toHaveBeenCalled();

    clock.now += MINUTE;
    await tasks.tick();
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(started.sessionId!);
    clock.now += MINUTE;
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Stopped: reached the 30-minute time limit.",
    });
  });

  it(
    "resumes an interrupted task in its retained session and worktree before releasing dependencies",
    async () => {
      const { tasks, run, task, clock, interrupt, turns, input, addRepo, finish } = setup();
      const repo = addRepo("recover");
      const started = await run({ projectId: repo.id });
      writeFileSync(join(started.worktreeCwd!, "progress.txt"), "keep this work");
      tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: [started.id] }));
      await interrupt(started.sessionId!);
      clock.now += MINUTE;
      await tasks.tick();
      expect(task()).toMatchObject({
        status: "running",
        sessionId: started.sessionId,
        branch: started.branch,
        worktreeCwd: started.worktreeCwd,
      });
      expect(task().runId).not.toBe(started.runId);
      expect(task().error).toBeUndefined();
      expect(turns).toHaveLength(2);
      expect(turns.at(-1)!.input.text).toContain("do not start over");
      expect(readFileSync(join(started.worktreeCwd!, "progress.txt"), "utf8")).toBe(
        "keep this work",
      );
      expect(task("dependent").status).toBe("queued");
      await finish(started.sessionId!);
      await tasks.move(started.id, "done");
      await tasks.tick();
      expect(task("dependent").status).toBe("running");
    },
    SHELL_TEST_MS,
  );

  it("recovers legacy host-stopped blocked tasks but keeps failures blocked", async () => {
    const { tasks, run, task, clock, interrupt, store } = setup();
    const started = await run();
    await interrupt(started.sessionId!);
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
      JSON.stringify({
        ...task(),
        status: "blocked",
        error: "The host stopped during this run.",
        completedAt: clock.now,
      }),
      started.id,
    );
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "running",
      sessionId: started.sessionId,
    });
    expect(task().completedAt).toBeUndefined();
    await interrupt(started.sessionId!, "Could not persist this turn safely.");
    clock.now += MINUTE;
    await tasks.tick();
    expect(task().status).toBe("blocked");
    await tasks.tick();
    expect(task().status).toBe("blocked");
  });

  it("keeps recovered work queued when the daily agent limit is reached", async () => {
    const { tasks, run, task, clock, interrupt, turns } = setup();
    tasks.limits.save({ dailyAgentMinutes: 1 });
    const started = await run();
    await interrupt(started.sessionId!);
    clock.now += 2 * MINUTE;
    await tasks.tick();
    expect(task().status).toBe("queued");
    expect(turns).toHaveLength(1);
    tasks.limits.save({ dailyAgentMinutes: 0 });
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "running",
      sessionId: started.sessionId,
    });
  });

  it("restarts interrupted verification without recording a failed review", async () => {
    const { tasks, reviewing, task, interrupt, turns } = setup();
    const started = await reviewing();
    await interrupt(started.reviewer!.sessionId!);
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect(task().status).toBe("verifying");
    expect(task().verification?.review).toBeUndefined();
    expect(task().reviewer!.sessionId).toBe(started.reviewer!.sessionId);
  });

  it("holds a retained interrupted reviewer for daily limits and never resumes a later owner stop", async () => {
    const { tasks, reviewing, task, interrupt, turns, clock, engine, settled } = setup();
    const started = await reviewing({ continueUntilDone: true });
    tasks.limits.save({ dailyAgentMinutes: 1 });
    await interrupt(started.reviewer!.sessionId!);
    clock.now += 2 * MINUTE;
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "verifying",
      reviewer: { sessionId: started.reviewer!.sessionId, recoveryPending: true },
    });
    expect(turns).toHaveLength(2);
    tasks.limits.save({ dailyAgentMinutes: 0 });
    await tasks.tick();
    expect(task().reviewer!.sessionId).toBe(started.reviewer!.sessionId);
    expect(task().reviewer!.recoveryPending).toBeUndefined();
    expect(task().reviewer!.verdictRepairAttempts).toBe(0);
    engine.command({
      type: "cancel",
      commandId: "owner-stop-review",
      sessionId: task().reviewer!.sessionId!,
      runId: task().reviewer!.runId,
    });
    await settled(started.reviewer!.sessionId!);
    await tasks.tick();
    expect(task()).toMatchObject({ status: "blocked", error: "Stopped by you." });
    expect(turns).toHaveLength(3);
  });

  it("blocks a task whose turn was stopped from a desktop", async () => {
    const { tasks, run, task, engine, settled, clock } = setup();
    const started = await run();
    engine.command({
      type: "cancel",
      commandId: "cancel-from-desktop",
      sessionId: started.sessionId!,
      runId: started.runId!,
    });
    await settled(started.sessionId!);
    clock.now += MINUTE;
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Stopped by you.",
    });
  });

  it("allows explicit direct tasks to share a project folder within host limits", async () => {
    const { tasks, input, run, task, turns, finish } = setup();
    const first = await run();
    tasks.save(input({ id: "second" }));
    await tasks.tick();
    expect(task("second").status).toBe("running");
    expect(turns).toHaveLength(2);

    await finish(first.sessionId!);
    expect(task().status).toBe("done");
    await tasks.tick();
    expect(task("second").status).toBe("running");
  });

  it("runs at most two tasks at once, oldest first", async () => {
    const { tasks, input, task, turns, settled, clock, addProject, advance } = setup();
    expect(MAX_RUNNING_TASKS).toBe(2);
    for (const id of ["a", "b", "c"]) {
      tasks.save(input({ id, projectId: addProject(id).id }));
      clock.now += 1;
    }
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(["a", "b", "c"].map((id) => task(id).status)).toEqual(["running", "running", "queued"]);

    turns[0].finish();
    await settled(task("a").sessionId!);
    // A task being verified still counts.
    await advance();
    expect(task("c").status).toBe("queued");
    await tasks.tick();
    expect(["a", "b", "c"].map((id) => task(id).status)).toEqual(["done", "running", "running"]);
  });

  it("mirrors whether the running session is waiting on the user", async () => {
    const { tasks, run, task, store, clock } = setup();
    const started = await run();
    expect(task().needsInput).toBeUndefined();
    const ask = async (pendingQuestion?: { requestId: number; questions: [] }) => {
      const session = store.session(started.sessionId!);
      store.save(
        {
          ...session,
          revision: session.revision + 1,
          session: { ...session.session, pendingQuestion },
        },
        { type: "question" },
      );
      clock.now += MINUTE;
      await tasks.tick();
    };
    await ask({ requestId: 1, questions: [] });
    expect(task()).toMatchObject({ status: "running", needsInput: true });
    await ask(undefined);
    expect(task().status).toBe("running");
    expect(task().needsInput).toBeUndefined();
  });

  it("approves a reviewed task, and runs a reviewed or done one again", async () => {
    const { tasks, review, task, turns, store, addRepo } = setup();
    const reviewed = await review({ projectId: addRepo("again-cleanup").id });
    expect((await tasks.move("main", "done")).status).toBe("done");
    store.db.prepare("UPDATE tasks SET value=? WHERE id='main'").run(
      JSON.stringify({
        ...task(),
        cleanupRetryAfter: Date.now() + 60_000,
        deliveryRequested: true,
        dependencyArtifactsPrepared: true,
        artifactPaths: ["temp/local/old-output.txt"],
        artifactHashes: { "temp/local/old-output.txt": "old" },
      }),
    );

    const again = await tasks.move("main", "queued");
    expect(again.status).toBe("queued");
    expect(again.sessionId).toBeUndefined();
    expect(again.completedAt).toBeUndefined();
    expect(again.verification).toBeUndefined();
    expect(again.cleanupRetryAfter).toBeUndefined();
    expect(again.deliveryRequested).toBeUndefined();
    expect(again.dependencyArtifactsPrepared).toBeUndefined();
    expect(again.artifactPaths).toBeUndefined();
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(task().sessionId).not.toBe(reviewed.sessionId);
    turns[1].finish();
  });

  it("sends a reviewed task back to the queue", async () => {
    const { tasks, review } = setup();
    await review();
    expect((await tasks.move("main", "queued")).status).toBe("queued");
  });

  it("stops a running task and retries a blocked one in a fresh session", async () => {
    const { tasks, run, task, provider, turns, settled } = setup();
    const started = await run();
    expect(await tasks.move("main", "blocked")).toMatchObject({
      status: "blocked",
      error: "Stopped by you.",
    });
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(started.sessionId!);
    await tasks.tick();
    expect(task().status).toBe("blocked");

    const retried = await tasks.move("main", "queued");
    expect(retried.status).toBe("queued");
    expect(retried.error).toBeUndefined();
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(task()).toMatchObject({ status: "running" });
    expect(task().sessionId).not.toBe(started.sessionId);
  });

  it("refuses moves the board does not offer", async () => {
    const { tasks, input, run, review, addRepo } = setup();
    tasks.save(input({ id: "waiting" }));
    for (const to of ["running", "verifying", "review", "done", "blocked", "queued"])
      await expect(tasks.move("waiting", to)).rejects.toThrow(
        `A queued task cannot be moved to ${to}.`,
      );
    await tasks.delete("waiting");

    await run();
    for (const to of ["queued", "verifying", "review", "done"])
      await expect(tasks.move("main", to)).rejects.toThrow(
        `A running task cannot be moved to ${to}.`,
      );
    await tasks.move("main", "blocked");
    for (const to of ["running", "verifying", "review", "done"])
      await expect(tasks.move("main", to)).rejects.toThrow(
        `A blocked task cannot be moved to ${to}.`,
      );
    await tasks.delete("main");

    await review({ id: "reviewed", projectId: addRepo("review-repo").id });
    for (const to of ["running", "verifying", "blocked"])
      await expect(tasks.move("reviewed", to)).rejects.toThrow(
        `A review task cannot be moved to ${to}.`,
      );
    await tasks.move("reviewed", "done");
    for (const to of ["running", "verifying", "review", "blocked"])
      await expect(tasks.move("reviewed", to)).rejects.toThrow(
        `A done task cannot be moved to ${to}.`,
      );

    await expect(tasks.move("reviewed", "archived")).rejects.toThrow("Invalid task status");
    await expect(tasks.move("missing", "done")).rejects.toThrow("Task not found.");
  });

  it("edits a queued or blocked task but not a running or finished one", async () => {
    const { tasks, input, run, review, task, addProject } = setup();
    tasks.save(input({ verifyCommand: "npm test" }));
    const other = addProject("other");
    const edited = tasks.save(input({ title: "Renamed", maxRunMinutes: 15, projectId: other.id }));
    expect(edited).toMatchObject({
      status: "queued",
      title: "Renamed",
      maxRunMinutes: 15,
    });
    // A check command left empty is removed.
    expect(edited.verifyCommand).toBeUndefined();
    // A task stays in the project it was created for.
    expect(edited.projectId).toBe(input().projectId);

    await run({ title: "Renamed" });
    expect(() => tasks.save(input({ title: "Again" }))).toThrow(
      "Stop this task before editing it.",
    );
    expect(task().title).toBe("Renamed");

    await tasks.move("main", "blocked");
    expect(tasks.save(input({ prompt: "Try again" }))).toMatchObject({
      status: "blocked",
      prompt: "Try again",
      error: "Stopped by you.",
    });
    await tasks.delete("main");

    await review({ id: "reviewed" });
    expect(() => tasks.save(input({ id: "reviewed" }))).toThrow(
      "Only a to-do, queued or blocked task can be edited.",
    );
  });

  it("keeps a to-do item off the queue: tick never starts it and it takes no slot", async () => {
    const { tasks, input, clock, turns, task, addProject } = setup();
    const added = tasks.save(input({ id: "idea", status: "todo" }));
    expect(added).toMatchObject({ status: "todo", createdAt: clock.now });
    // Two tasks running would fill the board; the to-do item is not counted.
    tasks.save(input({ id: "a" }));
    // Tasks sharing a project folder run one at a time.
    tasks.save(input({ id: "b", projectId: addProject("second").id }));
    clock.now += 1;
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(MAX_RUNNING_TASKS));
    clock.now += MINUTE;
    await tasks.tick();
    expect(task("idea")).toMatchObject({ status: "todo" });
    expect(task("idea").sessionId).toBeUndefined();
    expect(turns).toHaveLength(MAX_RUNNING_TASKS);
  });

  it("adds a to-do item with no description, and queues by default", () => {
    const { tasks, input } = setup();
    expect(tasks.save(input({ id: "idea", status: "todo", prompt: "" }))).toMatchObject({
      status: "todo",
      prompt: "",
    });
    expect(tasks.save(input({ id: "later", status: "queued" })).status).toBe("queued");
    expect(() => tasks.save(input({ id: "bad", status: "running" }))).toThrow(
      "A new task starts as to do or queued.",
    );
    expect(() => tasks.save(input({ id: "empty", prompt: "  " }))).toThrow(
      "Add a description before starting this task with an agent.",
    );
  });

  it("edits a to-do item and keeps it in to do", () => {
    const { tasks, input } = setup();
    tasks.save(input({ status: "todo", prompt: "" }));
    const edited = tasks.save(input({ title: "Renamed", prompt: "Details" }));
    expect(edited).toMatchObject({
      status: "todo",
      title: "Renamed",
      prompt: "Details",
    });
    // An edit may leave the description empty while it is only a to-do item.
    expect(tasks.save(input({ prompt: "" })).status).toBe("todo");
  });

  it("starts a to-do item like a newly queued task", async () => {
    const { tasks, input, task, turns } = setup();
    tasks.save(input({ status: "todo" }));
    const queued = await tasks.move("main", "queued");
    expect(queued.status).toBe("queued");
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(task().status).toBe("running");
    expect(
      JSON.parse(turns[0].input.text.slice(turns[0].input.text.indexOf("{"))).task.instructions
        .objective,
    ).toBe("Write the weekly report");
  });

  it("refuses to start a task with an empty description", async () => {
    const { tasks, input } = setup();
    tasks.save(input({ status: "todo", prompt: " " }));
    await expect(tasks.move("main", "queued")).rejects.toThrow(
      "Add a description before starting this task with an agent.",
    );
    expect(tasks.list()[0].status).toBe("todo");
  });

  it("marks a to-do item done without running or merging anything", async () => {
    const { tasks, input, clock, turns } = setup();
    tasks.save(input({ status: "todo" }));
    clock.now += 5;
    expect(await tasks.move("main", "done")).toMatchObject({
      status: "done",
      completedAt: clock.now,
    });
    await tasks.tick();
    expect(turns).toHaveLength(0);
    const reopened = await tasks.move("main", "todo");
    expect(reopened.status).toBe("todo");
    expect(reopened.completedAt).toBeUndefined();
  });

  it("pulls a queued task back to to do, and reopens blocked and done ones", async () => {
    const { tasks, input, run, review, task } = setup();
    tasks.save(input({ id: "waiting" }));
    expect((await tasks.move("waiting", "todo")).status).toBe("todo");
    await tasks.delete("waiting");

    await run();
    await tasks.move("main", "blocked");
    const back = await tasks.move("main", "todo");
    expect(back.status).toBe("todo");
    expect(back.error).toBeUndefined();
    expect(back.sessionId).toBeUndefined();
    expect(back.startedAt).toBeUndefined();
    await tasks.delete("main", true);

    await review({ id: "reviewed" });
    expect(task("reviewed").status).toBe("done");
    expect((await tasks.move("reviewed", "todo")).status).toBe("todo");
    expect(task("reviewed").sessionId).toBeUndefined();
  });

  it("refuses to-do moves the board does not offer", async () => {
    const { tasks, input, run, review, addRepo } = setup();
    tasks.save(input({ id: "idea", status: "todo" }));
    for (const to of ["running", "verifying", "review", "blocked", "todo"])
      await expect(tasks.move("idea", to)).rejects.toThrow(`A todo task cannot be moved to ${to}.`);
    await run({ id: "working" });
    await expect(tasks.move("working", "todo")).rejects.toThrow(
      "A running task cannot be moved to todo.",
    );
    await tasks.move("working", "blocked");
    await tasks.delete("working");
    await review({ id: "reviewed", projectId: addRepo("review-repo").id });
    await expect(tasks.move("reviewed", "todo")).rejects.toThrow(
      "A review task cannot be moved to todo.",
    );
  });

  it("does not pull back a queued task that has unmerged work on a branch", async () => {
    const { tasks, addRepo, run, task, finish, turns } = setup();
    const repo = addRepo("repo");
    const started = await run({ projectId: repo.id, review: false });
    writeFileSync(join(turns.at(-1)!.input.cwd, "work.txt"), "work\n");
    await finish(started.sessionId!);
    // In review with its branch; run it again, then try to pull it back.
    await tasks.move("main", "queued");
    expect(task().branch).toBeTruthy();
    await expect(tasks.move("main", "todo")).rejects.toThrow(
      "This task already started, so it cannot go back to To do.",
    );
  });

  it("deletes any task that is not running", async () => {
    const { tasks, run } = setup();
    await run();
    await expect(tasks.delete("main")).rejects.toThrow("Stop this task before deleting it.");
    await tasks.move("main", "blocked");
    await tasks.delete("main");
    expect(tasks.list()).toEqual([]);
  });
});

describe("a task on its own branch", () => {
  it("runs in a new worktree and leaves the project checkout untouched", async () => {
    const { run, addRepo, turns, store } = setup();
    const repo = addRepo("repo");
    const head = git(repo.cwd, "rev-parse", "HEAD");
    const started = await run({ projectId: repo.id });
    expect(started).toMatchObject({
      status: "running",
      baseBranch: "main",
      baseCommit: head,
    });
    expect(started.branch).toMatch(/^mc\/[a-z0-9]{8}$/);
    expect(started.worktreeCwd).not.toBe(repo.cwd);
    expect(turns[0].input.cwd).toBe(started.worktreeCwd);
    // The agent is told to stay out of the project folder.
    const prompt = turns[0].input.text;
    expect(prompt).toContain(`You are working in ${started.worktreeCwd}`);
    expect(prompt).toContain(`Do not edit, commit in or switch branches in ${repo.cwd}`);
    expect(prompt).toContain(`on the branch ${started.branch}`);
    expect(JSON.parse(prompt.slice(prompt.indexOf("{")))).toMatchObject({
      schema: "bycoda.task-contract.v1",
      task: { instructions: { objective: started.prompt } },
      workspace: { path: started.worktreeCwd, branch: started.branch },
      // Model text in planned instructions must not override the host's assignment.
      runtime: { harness: started.harness, model: started.model },
    });
    expect(store.session(started.sessionId!).session.cwd).toBe(started.worktreeCwd);
    expect(git(started.worktreeCwd!, "symbolic-ref", "--short", "HEAD")).toBe(started.branch);
    expect(git(repo.cwd, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo.cwd, "status", "--porcelain")).toBe("");
  });

  it("commits what the agent left uncommitted on the task branch", async () => {
    const { review, addRepo } = setup();
    const repo = addRepo("repo");
    const head = git(repo.cwd, "rev-parse", "HEAD");
    const reviewed = await review(
      { projectId: repo.id },
      { "report.md": "# Report\n", "file.txt": "changed\n" },
    );
    expect(reviewed.status).toBe("review");
    expect(git(reviewed.worktreeCwd!, "status", "--porcelain")).toBe("");
    expect(git(repo.cwd, "log", "-1", "--format=%s", reviewed.branch!)).toBe("Ship the report");
    expect(reviewed.diffStat).toContain("report.md");
    expect(reviewed.diffStat).toContain("2 files changed");
    // Nothing reached the project.
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo.cwd, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo.cwd, "report.md"))).toBe(false);
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("initial\n");
  });

  it("runs several tasks of one project at once, each on its branch", async () => {
    const { tasks, input, task, turns, addRepo, clock } = setup();
    const repo = addRepo("repo");
    for (const id of ["a", "b"]) {
      tasks.save(input({ id, projectId: repo.id }));
      clock.now += 1;
    }
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(task("a").status).toBe("running");
    expect(task("b").status).toBe("running");
    expect(task("a").branch).not.toBe(task("b").branch);
  });

  it("runs explicit direct tasks in the selected folder, including non-Git projects", async () => {
    const { run, review, addRepo, turns } = setup();
    const repo = addRepo("repo");
    const inPlace = await review(
      { projectId: repo.id, isolate: false },
      { "report.md": "# Report\n" },
    );
    expect(turns[0].input.cwd).toBe(repo.cwd);
    expect(inPlace.status).toBe("done");
    expect(inPlace.branch).toBeUndefined();
    expect(inPlace.diffStat).toBeUndefined();
    // The host never commits in the project checkout.
    expect(git(repo.cwd, "status", "--porcelain")).toBe("?? report.md");

    const plain = await run({ id: "plain", isolate: false });
    expect(plain.status).toBe("running");
    expect(plain.branch).toBeUndefined();
    expect(plain.worktreeCwd).toBeUndefined();
  });

  it("blocks explicit isolation in a Git subdirectory without starting a provider", async () => {
    const { tasks, input, task, store, addRepo, turns } = setup();
    const repo = addRepo("repo");
    const child = join(repo.cwd, "child");
    mkdirSync(child);
    const project = store.addProject(child, "child");
    tasks.save(input({ projectId: project.id, isolate: true }));
    await tasks.tick();
    expect(task().status).toBe("blocked");
    expect(task().error).toContain("Open the Git repository root");
    expect(task().branch).toBeUndefined();
    expect(task().worktreeCwd).toBeUndefined();
    expect(turns).toHaveLength(0);
    expect(git(repo.cwd, "status", "--porcelain")).toBe("");
  });

  it.each([false, true])(
    "blocks explicit isolation when Git discovery fails (broken Git metadata: %s)",
    async (broken) => {
      const { tasks, input, task, addProject, turns } = setup();
      const project = addProject("not-git");
      if (broken) writeFileSync(join(project.cwd, ".git"), "gitdir: missing-repository\n");
      tasks.save(input({ projectId: project.id, isolate: true }));
      await tasks.tick();
      expect(task().status).toBe("blocked");
      expect(task().error).toContain("Cannot create an isolated task workspace");
      expect(turns).toHaveLength(0);
    },
  );

  it("keeps explicit direct execution in a Git project subdirectory", async () => {
    const { run, store, addRepo, turns } = setup();
    const repo = addRepo("repo");
    const child = join(repo.cwd, "child");
    mkdirSync(child);
    const project = store.addProject(child, "child");
    const started = await run({ projectId: project.id, isolate: false });
    expect(started.status).toBe("running");
    expect(started.branch).toBeUndefined();
    expect(turns[0].input.cwd).toBe(child);
  });

  it("blocks legacy tasks with unspecified isolation rather than falling back to the shared checkout", async () => {
    const { tasks, input, task, store, turns } = setup();
    const saved = tasks.save(input());
    const legacy = { ...saved, isolate: undefined };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(legacy), saved.id);
    await tasks.tick();
    expect(task().status).toBe("blocked");
    expect(task().error).toContain("Cannot create an isolated task workspace");
    expect(turns).toHaveLength(0);
  });

  it("blocks a task when the project is not on a branch", async () => {
    const { tasks, input, task, addRepo, turns } = setup();
    const repo = addRepo("repo");
    git(repo.cwd, "checkout", "-q", "--detach");
    tasks.save(input({ projectId: repo.id }));
    await tasks.tick();
    expect(task().status).toBe("blocked");
    expect(task().error).toContain("not on a branch");
    expect(turns).toHaveLength(0);
  });

  it("merges an approved task into its base branch and cleans up", async () => {
    const { tasks, review, addRepo } = setup();
    const repo = addRepo("repo");
    const reviewed = await review({ projectId: repo.id }, { "report.md": "# Report\n" });
    const done = await tasks.move("main", "done");
    expect(done).toMatchObject({
      status: "done",
      merged: true,
      branch: reviewed.branch,
    });
    expect(done.worktreeCwd).toBeUndefined();
    expect(readFileSync(join(repo.cwd, "report.md"), "utf8")).toBe("# Report\n");
    expect(git(repo.cwd, "symbolic-ref", "--short", "HEAD")).toBe("main");
    // A merge commit, not a fast-forward.
    expect(git(repo.cwd, "rev-list", "--parents", "-1", "HEAD").split(" ")).toHaveLength(3);
    expect(git(repo.cwd, "branch", "--list", "mc/*")).toBe("");
    expect(existsSync(reviewed.worktreeCwd!)).toBe(false);

    // A merged task is deleted without discarding anything, and runs again on
    // a new branch.
    const again = await tasks.move("main", "queued");
    expect(again.branch).toBeUndefined();
    expect(again.merged).toBeUndefined();
    await tasks.delete("main");
    expect(tasks.list()).toEqual([]);
  });

  it("keeps a task in review when the project is on another branch", async () => {
    const { tasks, review, task, addRepo } = setup();
    const repo = addRepo("repo");
    const reviewed = await review({ projectId: repo.id }, { "report.md": "# Report\n" });
    const head = git(repo.cwd, "rev-parse", "HEAD");

    git(repo.cwd, "checkout", "-q", "-b", "other");
    await expect(tasks.move("main", "done")).rejects.toThrow(
      "The project is on other. Check out main there, then merge again.",
    );
    expect(task().status).toBe("review");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo.cwd, "rev-parse", "--verify", reviewed.branch!)).toBeTruthy();
    expect(existsSync(reviewed.worktreeCwd!)).toBe(true);

    git(repo.cwd, "checkout", "-q", "main");
    const done = await tasks.move("main", "done");
    expect(done.status).toBe("done");
    expect(done.mergeError).toBeUndefined();
    expect(existsSync(join(repo.cwd, "report.md"))).toBe(true);
  });

  it("repairs an owner-requested conflicting merge without changing the delivery checkout", async () => {
    const { tasks, review, task, addRepo } = setup();
    const repo = addRepo("repo");
    const reviewed = await review({ projectId: repo.id }, { "file.txt": "from the agent\n" });
    writeFileSync(join(repo.cwd, "file.txt"), "from the owner\n");
    git(repo.cwd, "commit", "-q", "-am", "owner");
    const head = git(repo.cwd, "rev-parse", "HEAD");

    await tasks.move("main", "done");
    expect(task().status).toBe("running");
    expect(task().deliveryRequested).toBe(true);
    expect(task().mergeRepair?.conflicts).toEqual(["file.txt"]);
    expect(task().mergeError).toContain("conflicts with main");
    expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo.cwd, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("from the owner\n");
    expect(git(repo.cwd, "log", "-1", "--format=%s", reviewed.branch!)).toBe("Ship the report");
    expect(existsSync(reviewed.worktreeCwd!)).toBe(true);
  });

  it("deletes an unmerged task only when told to discard its branch", async () => {
    const { tasks, review, addRepo } = setup();
    const repo = addRepo("repo");
    const reviewed = await review({ projectId: repo.id }, { "report.md": "# Report\n" });
    await expect(tasks.delete("main")).rejects.toThrow(
      `This task’s work is on ${reviewed.branch} and was never merged.`,
    );
    expect(tasks.list()).toHaveLength(1);
    expect(git(repo.cwd, "branch", "--list", "mc/*")).toContain(reviewed.branch);
    expect(existsSync(reviewed.worktreeCwd!)).toBe(true);

    await tasks.delete("main", true);
    expect(tasks.list()).toEqual([]);
    expect(git(repo.cwd, "branch", "--list", "mc/*")).toBe("");
    expect(existsSync(reviewed.worktreeCwd!)).toBe(false);
    expect(existsSync(join(repo.cwd, "report.md"))).toBe(false);
  });

  it("retries on the same branch, keeping the earlier work", async () => {
    const { tasks, review, task, turns, addRepo, finish } = setup();
    const repo = addRepo("repo");
    const reviewed = await review({ projectId: repo.id }, { "report.md": "# Report\n" });
    const queued = await tasks.move("main", "queued");
    expect(queued).toMatchObject({
      status: "queued",
      branch: reviewed.branch,
      worktreeCwd: reviewed.worktreeCwd,
      baseCommit: reviewed.baseCommit,
    });
    expect(queued.diffStat).toBeUndefined();

    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(task()).toMatchObject({
      status: "running",
      branch: reviewed.branch,
    });
    expect(task().sessionId).not.toBe(reviewed.sessionId);
    expect(turns[1].input.cwd).toBe(reviewed.worktreeCwd);
    expect(existsSync(join(reviewed.worktreeCwd!, "report.md"))).toBe(true);

    writeFileSync(join(reviewed.worktreeCwd!, "notes.md"), "More\n");
    await finish(task().sessionId!);
    expect(task().status).toBe("review");
    expect(task().diffStat).toContain("report.md");
    expect(task().diffStat).toContain("notes.md");
    expect(git(repo.cwd, "branch", "--list", "mc/*").split("\n")).toHaveLength(1);
  });
});

describe("task verification", () => {
  it(
    "completes a direct task when the check command passes, running it once",
    async () => {
      const { tasks, run, task, turns, settled, clock, store } = setup();
      const started = await run({
        verifyCommand: "node -e \"require('fs').appendFileSync('runs.txt', 'x')\"",
      });
      turns[0].finish();
      await settled(started.sessionId!);
      clock.now += MINUTE;
      await tasks.tick();
      // A tick during the check does not start it again.
      await tasks.tick();
      expect(task().status).toBe("verifying");
      await tasks.idle();
      await tasks.tick();
      await tasks.idle();
      expect(task()).toMatchObject({
        status: "done",
        verification: { command: { exitCode: 0, timedOut: false } },
      });
      expect(readFileSync(join(store.project(started.projectId).cwd, "runs.txt"), "utf8")).toBe(
        "x",
      );
    },
    SHELL_TEST_MS,
  );

  it(
    "blocks a task whose check command fails, keeping its output",
    async () => {
      const { review, addRepo } = setup();
      const repo = addRepo("repo");
      const blocked = await review(
        {
          projectId: repo.id,
          verifyCommand: "node -e \"console.log('boom'); process.exit(3)\"",
        },
        { "report.md": "# Report\n" },
      );
      expect(blocked.status).toBe("blocked");
      expect(blocked.error).toMatch(/^The check command failed \(exit code \d+\)\.$/);
      expect(blocked.verification!.command).toMatchObject({ timedOut: false });
      expect(blocked.verification!.command!.exitCode).not.toBe(0);
      expect(blocked.verification!.command!.output).toContain("boom");
      // The work is still on its branch.
      expect(git(repo.cwd, "log", "-1", "--format=%s", blocked.branch!)).toBe("Ship the report");
      expect(existsSync(blocked.worktreeCwd!)).toBe(true);
    },
    SHELL_TEST_MS,
  );

  it(
    "blocks a task whose check command runs past its time limit",
    async () => {
      const { review } = setup(1500);
      const blocked = await review({
        verifyCommand: 'node -e "setTimeout(() => {}, 60000)"',
      });
      expect(blocked).toMatchObject({
        status: "blocked",
        error: "The check command timed out.",
        verification: { command: { exitCode: null, timedOut: true } },
      });
    },
    SHELL_TEST_MS,
  );

  it("moves to review when the reviewer passes the work", async () => {
    const { reviewing, task, turns, store, finish, addRepo } = setup();
    const repo = addRepo("repo");
    const verifying = await reviewing({ projectId: repo.id });
    expect(verifying.status).toBe("verifying");
    const reviewer = verifying.reviewer!.sessionId!;
    expect(reviewer).not.toBe(verifying.sessionId);
    expect(store.session(reviewer).session).toMatchObject({
      title: "Review: Ship the report",
      cwd: verifying.worktreeCwd,
      model: "claude:test",
    });
    const prompt = turns[1].input.text;
    expect(prompt).toContain("Task: Ship the report");
    expect(prompt).toContain("Write the weekly report");
    expect(prompt).toContain(`git diff ${verifying.baseCommit}`);

    await finish(reviewer, "The report covers the week.\n\nVERDICT: PASS");
    expect(task()).toMatchObject({
      status: "review",
      verification: {
        review: { verdict: "pass", note: "", sessionId: reviewer },
      },
    });
    expect(task().reviewer).toBeUndefined();
  });

  it("blocks a task the reviewer fails, with its reason", async () => {
    const { reviewing, task, turns, finish } = setup();
    const verifying = await reviewing();
    // Not on a branch: the reviewer looks at the uncommitted changes.
    expect(turns[1].input.text).toContain("the uncommitted changes");
    await finish(
      verifying.reviewer!.sessionId!,
      "Looked at it.\nVERDICT: FAIL - The report skips Friday.",
    );
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Review failed: The report skips Friday.",
      verification: {
        review: { verdict: "fail", note: "The report skips Friday." },
      },
    });
  });

  it("repairs goal work on its existing branch, keeps dependents waiting, then delivers", async () => {
    const { tasks, input, reviewing, task, turns, finish, addRepo } = setup();
    const repo = addRepo("repair");
    const original = await reviewing({
      projectId: repo.id,
      goalId: "goal",
      autoMerge: true,
    });
    tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: ["main"] }));
    await finish(
      original.reviewer!.sessionId!,
      "file.txt:1 needs Friday.\nVERDICT: FAIL - Friday is missing.",
    );
    expect(task()).toMatchObject({
      status: "running",
      repairAttempts: 1,
      branch: original.branch,
      worktreeCwd: original.worktreeCwd,
    });
    expect(task("dependent").status).toBe("queued");
    expect(turns.at(-1)!.input.text).toContain("file.txt:1 needs Friday.");
    expect(task().sessionId).not.toBe(original.sessionId);
    writeFileSync(join(original.worktreeCwd!, "file.txt"), "Friday\n");
    await finish(task().sessionId!);
    await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
    expect(task()).toMatchObject({ status: "done", autoMerged: true });
    expect(task("dependent").status).toBe("running");
  });

  it("hands blocked work to one independent worker before asking for instructions", async () => {
    const { tasks, store, engine, clock, reviewing, task, finish } = setup();
    await reviewing({ goalId: "goal" });
    for (let attempt = 1; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
      await finish(task().reviewer!.sessionId!, `VERDICT: FAIL - Missing item ${attempt}.`);
      expect(task()).toMatchObject({
        status: "running",
        repairAttempts: attempt,
      });
      expect(new HostTasks(store, engine, () => clock.now).get("main")!.repairAttempts).toBe(
        attempt,
      );
      await finish(task().sessionId!);
    }
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is still missing.");
    expect(task()).toMatchObject({
      status: "blocked",
      repairAttempts: MAX_REPAIR_ATTEMPTS - 1,
      reviewFailureCount: 3,
    });
    const previousSession = task().sessionId;
    expect(task().needsInput).toBeUndefined();
    await tasks.tick();
    expect(task()).toMatchObject({
      status: "running",
      blockedTakeover: { previousSessionId: previousSession },
    });
    expect(task().sessionId).not.toBe(previousSession);
    await finish(task().sessionId!);
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is still missing.");
    expect(task().status).toBe("blocked");
    expect(task().needsInput).toBe(true);
    await new HostTasks(store, engine, () => clock.now).tick();
    expect(task().status).toBe("blocked");
    await expect(tasks.move("main", "queued")).rejects.toThrow("Update the task description");
    expect(() => tasks.recheckReview("main")).toThrow("Update the task description");
    tasks.save({ ...task(), status: undefined, title: "Renamed", prompt: `  ${task().prompt}  ` });
    await expect(tasks.move("main", "queued")).rejects.toThrow("Update the task description");
    tasks.save({
      ...task(),
      status: undefined,
      prompt: "Include Friday; its figures are now in the supplied report.",
    });
    tasks.recoverGoalReview("main", "goal");
    expect(task().status).toBe("blocked");
    await tasks.move("main", "queued");
    expect(task().repairAttempts).toBe(0);
    expect(task().reviewFailureCount).toBe(0);
    expect(task().attemptHistory).toHaveLength(4);
    expect(task().retryFeedback).toContain("Friday is still missing.");
  });

  it("continues manual tasks beyond the old repair limit while changing failures are actionable", async () => {
    const { reviewing, task, finish, tasks, turns, store, engine, clock } = setup();
    await reviewing({ continueUntilDone: true });
    for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt++) {
      await finish(
        task().reviewer!.sessionId!,
        `VERDICT: FAIL - Remaining deliverable ${attempt}.`,
      );
      expect(task()).toMatchObject({
        status: "running",
        continueUntilDone: true,
        repairAttempts: attempt,
      });
      expect(task().repairStop).toBeUndefined();
      expect(new HostTasks(store, engine, () => clock.now).get("main")!.continueUntilDone).toBe(
        true,
      );
      expect(turns.at(-1)!.input.text).toContain('"continueUntilDone": true');
      writeFileSync(
        join(turns.at(-1)!.input.cwd, "report.txt"),
        `Completed deliverables: ${attempt}\n`,
      );
      await finish(task().sessionId!, `Corrected deliverable ${attempt}.`);
    }
    await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
    expect(task().status).toBe("done");
    expect(tasks.list()).toHaveLength(1);
  });

  it("saves continuation changes and removes only an obsolete numeric budget when the owner enables it", () => {
    const { tasks, input, store, task } = setup();
    tasks.save(input({ continueUntilDone: true }));
    expect(task().continueUntilDone).toBe(true);
    tasks.save(input({ continueUntilDone: false }));
    expect(task().continueUntilDone).toBeUndefined();
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
      JSON.stringify({
        ...task(),
        status: "blocked",
        repairStop: { reason: "limit", message: "Old correction limit" },
        needsInput: true,
      }),
      "main",
    );
    tasks.save(input({ continueUntilDone: true }));
    expect(task()).toMatchObject({
      status: "blocked",
      continueUntilDone: true,
      awaitingOwnerRestart: true,
    });
    expect(task().repairStop).toBeUndefined();
    expect(task().needsInput).toBeUndefined();
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
      JSON.stringify({
        ...task(),
        continueUntilDone: undefined,
        repairStop: { reason: "external", message: "Provide the required resource" },
        needsInput: true,
      }),
      "main",
    );
    tasks.save(input({ continueUntilDone: true }));
    expect(task().repairStop?.reason).toBe("external");
  });

  it("keeps correcting the same broad finding while contents progress, then stops unchanged recovery", async () => {
    const { reviewing, task, finish, tasks, turns } = setup();
    await reviewing({ continueUntilDone: true });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - The report remains incomplete.");
      expect(task().status).toBe("running");
      writeFileSync(
        join(turns.at(-1)!.input.cwd, "report.txt"),
        `Completed sections: ${attempt}\n`,
      );
      await finish(task().sessionId!, `Completed section ${attempt}.`);
    }
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - The report remains incomplete.");
    await finish(task().sessionId!, "No further changes.");
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - The report remains incomplete.");
    expect(task()).toMatchObject({ status: "blocked", repairStop: { reason: "no_progress" } });
    await tasks.tick();
    expect(task().blockedTakeover).toBeDefined();
    await finish(task().sessionId!, "The same report was inspected, without changes.");
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - The report remains incomplete.");
    expect(task()).toMatchObject({
      status: "blocked",
      needsInput: true,
      repairStop: { reason: "no_progress" },
    });
    const count = turns.length;
    await tasks.tick();
    expect(turns).toHaveLength(count);
  });

  it("does not mistake changing review wording for implementation progress", async () => {
    const { reviewing, task, finish } = setup();
    await reviewing({ continueUntilDone: true });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await finish(
        task().reviewer!.sessionId!,
        `VERDICT: FAIL - Defect described as item ${attempt}.`,
      );
      expect(task().status).toBe("running");
      await finish(task().sessionId!, "No content was changed.");
    }
    await finish(
      task().reviewer!.sessionId!,
      "VERDICT: FAIL - A differently worded defect remains.",
    );
    expect(task()).toMatchObject({ status: "blocked", repairStop: { reason: "no_progress" } });
  });

  it("repairs a missing reviewer verdict in the same review conversation with a bounded budget", async () => {
    const { reviewing, task, finish, turns } = setup();
    await reviewing({ continueUntilDone: true });
    const reviewer = task().reviewer!.sessionId!;
    const worker = task().sessionId;
    await finish(reviewer, "The implementation appears correct.");
    expect(task()).toMatchObject({
      status: "verifying",
      sessionId: worker,
      reviewer: { sessionId: reviewer, verdictRepairAttempts: 1 },
    });
    expect(turns.at(-1)!.input.text).toContain("Complete the existing read-only review");
    await finish(reviewer, "Still reviewing, without a verdict.");
    expect(task().reviewer!.verdictRepairAttempts).toBe(2);
    await finish(reviewer, "Still no verdict.");
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Review failed: Reviewer gave no verdict",
    });
  });

  it(
    "stops unchanged check failures in continuous mode and preserves the owner's stop",
    async () => {
      const { run, task, finish, tasks, turns } = setup();
      await run({
        continueUntilDone: true,
        verifyCommand: 'node -e "console.log(123); process.exit(1)"',
      });
      await finish(task().sessionId!);
      await tasks.tick();
      expect(task()).toMatchObject({ status: "running", repairAttempts: 1 });
      await finish(task().sessionId!);
      expect(task()).toMatchObject({ status: "blocked", repairStop: { reason: "no_progress" } });
      await tasks.tick();
      expect(task().blockedTakeover).toBeDefined();
      await tasks.move("main", "blocked");
      const count = turns.length;
      await tasks.tick();
      expect(task()).toMatchObject({ status: "blocked", error: "Stopped by you." });
      expect(turns).toHaveLength(count);
    },
    SHELL_TEST_MS,
  );

  it("recovers the review budget from legacy history and holds an already queued retry", async () => {
    const { tasks, store, input, task, turns } = setup();
    const saved = tasks.save(input());
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(
      JSON.stringify({
        ...saved,
        attemptHistory: Array.from({ length: 9 }, (_, index) => ({
          attempt: 0,
          at: index,
          reviewerSessionId: `review-${index}`,
          workerSummary: "Checks passed; device evidence unavailable.",
          verdict: "fail",
          note: `Still missing device evidence ${index}.`,
          findings: [],
        })),
      }),
      "main",
    );
    await tasks.tick();
    expect(task()).toMatchObject({ status: "blocked", needsInput: true });
    expect(turns).toHaveLength(0);
    await expect(tasks.move("main", "queued")).rejects.toThrow("Update the task description");
    tasks.save({
      ...task(),
      status: undefined,
      prompt: "Device is now connected; verify the retained implementation.",
    });
    await tasks.move("main", "queued");
    await tasks.tick();
    expect(task().status).toBe("running");
    expect(turns).toHaveLength(1);
  });

  it(
    "automatically takes over blocked work in its existing checkout and delivers after review",
    async () => {
      const { reviewing, tasks, task, finish, turns, input, addRepo } = setup();
      const repo = addRepo("takeover");
      await reviewing({ projectId: repo.id, autoMerge: true });
      await finish(
        task().reviewer!.sessionId!,
        '```json\n{"reviewNotes":[{"finding":"Need an alternative local check.","category":"external","suggestion":"Inspect available test tools."}]}\n```\nVERDICT: FAIL - Evidence missing.',
      );
      const blocked = task();
      writeFileSync(join(blocked.worktreeCwd!, "retained.txt"), "keep this progress");
      tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: ["main"] }));
      tasks.limits.save({ maxRunningTasks: 1 });
      await tasks.tick();
      expect(task()).toMatchObject({
        status: "running",
        worktreeCwd: blocked.worktreeCwd,
        branch: blocked.branch,
        harness: blocked.harness,
        model: blocked.model,
      });
      expect(task().sessionId).not.toBe(blocked.sessionId);
      expect(readFileSync(join(blocked.worktreeCwd!, "retained.txt"), "utf8")).toBe(
        "keep this progress",
      );
      expect(turns.at(-1)!.input.text).toContain("bycoda.blocked-handoff.v1");
      expect(turns.at(-1)!.input.text).toContain("Evidence missing.");
      expect(task("dependent").status).toBe("queued");
      await finish(
        task().sessionId!,
        "Used the available local acceptance tool and recorded results.",
      );
      expect(task().status).toBe("verifying");
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task()).toMatchObject({ status: "done", autoMerged: true });
      expect(task("dependent").status).toBe("running");
    },
    SHELL_TEST_MS,
  );

  it("holds takeover for daily limits and respects cancelled goals", async () => {
    const { reviewing, tasks, task, finish, store, clock } = setup();
    await reviewing({ goalId: "goal" });
    await finish(
      task().reviewer!.sessionId!,
      '```json\n{"reviewNotes":[{"finding":"Need device evidence.","category":"external","suggestion":"Provide a device for the required test."}]}\n```\nVERDICT: FAIL - Evidence missing.',
    );
    tasks.limits.save({ dailyAgentMinutes: 1, maxRunningTasks: 1 });
    tasks.limits.record(clock.now - 2 * MINUTE, clock.now);
    await tasks.tick();
    expect(task().status).toBe("blocked");
    tasks.limits.save({ dailyAgentMinutes: 0 });
    store.db.exec("CREATE TABLE goals (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    store.db
      .prepare("INSERT INTO goals VALUES (?, ?)")
      .run("goal", JSON.stringify({ status: "cancelled" }));
    await tasks.tick();
    expect(task().blockedTakeover).toBeUndefined();
    store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify({ status: "running" }), "goal");
    await tasks.tick();
    expect(task().status).toBe("running");
  });

  it("stops unchanged findings after a correction and records both worker outcomes", async () => {
    const { reviewing, task, finish, tasks, store, engine, clock } = setup();
    await reviewing({ goalId: "goal" });
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
    await finish(
      task().sessionId!,
      "Changed the parser. Focused check passed; device acceptance unavailable.",
    );
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
    expect(task()).toMatchObject({
      status: "blocked",
      repairAttempts: 1,
      repairStop: { reason: "no_progress" },
    });
    expect(task().attemptHistory).toHaveLength(2);
    expect(task().attemptHistory!.at(-1)!.workerSummary).toContain("Changed the parser");
    expect(new HostTasks(store, engine, () => clock.now).get("main")!.attemptHistory).toHaveLength(
      2,
    );
    await tasks.move("main", "todo");
    await expect(tasks.move("main", "queued")).rejects.toThrow("Update the task description");
    expect(task().repairStop?.reason).toBe("no_progress");
  });

  it("does not retry external-only acceptance or release dependent work, but starts independent work", async () => {
    const { reviewing, task, finish, tasks, input } = setup();
    await reviewing({ goalId: "goal", autoMerge: true });
    tasks.save(input({ id: "dependent", dependsOn: ["main"] }));
    tasks.save(input({ id: "independent" }));
    await finish(
      task().reviewer!.sessionId!,
      '```json\n{"reviewNotes":[{"finding":"TalkBack acceptance missing.","category":"external","suggestion":"Provide an Android device with TalkBack; exercise reset, search and favorites and record results."}]}\n```\nVERDICT: FAIL - Device acceptance missing.',
    );
    expect(task()).toMatchObject({
      status: "blocked",
      repairStop: { reason: "external" },
    });
    expect(task().repairAttempts).toBeUndefined();
    expect(task("dependent").status).toBe("queued");
    expect(task("independent").status).toBe("running");
  });

  it("still repairs code defects when the review also requires external acceptance", async () => {
    const { reviewing, task, finish } = setup();
    await reviewing({ goalId: "goal" });
    await finish(
      task().reviewer!.sessionId!,
      '```json\n{"reviewNotes":[{"finding":"Reset is broken."},{"finding":"TalkBack acceptance missing.","category":"external","suggestion":"Test on Android."}]}\n```\nVERDICT: FAIL - Reset is broken.',
    );
    expect(task()).toMatchObject({ status: "running", repairAttempts: 1 });
    expect(task().repairStop).toBeUndefined();
    const fixedId = task().reviewNotes!.find((note) => note.finding === "Reset is broken.")!.id;
    await finish(task().sessionId!, "Fixed reset and checked its behavior.");
    await finish(
      task().reviewer!.sessionId!,
      "```json\n" +
        JSON.stringify({
          reviewNotes: [
            {
              finding: "TalkBack acceptance missing.",
              category: "external",
              suggestion: "Test on Android.",
            },
          ],
          resolvedNoteIds: [fixedId],
        }) +
        "\n```\nVERDICT: FAIL - TalkBack acceptance missing.",
    );
    expect(task()).toMatchObject({
      status: "blocked",
      repairStop: { reason: "external" },
    });
    expect(task().reviewNotes!.find((note) => note.id === fixedId)!.resolvedAt).toBeDefined();
  });

  it("rechecks a failed review without another worker, even when the review still fails", async () => {
    const { reviewing, task, finish, tasks, turns } = setup();
    await reviewing();
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
    const worker = task().sessionId;
    const before = turns.length;
    tasks.save({
      ...task(),
      status: undefined,
      prompt: `${task().prompt}\nFriday evidence is now available.`,
    });
    tasks.recheckReview("main");
    await tasks.idle();
    expect(task().sessionId).toBe(worker);
    expect(turns).toHaveLength(before + 1);
    expect(turns.at(-1)!.input.text).toContain("You are reviewing");
    await finish(task().reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
    expect(task().status).toBe("blocked");
    expect(turns).toHaveLength(before + 1);
    expect(task().needsInput).toBeUndefined();
    expect(() => tasks.recheckReview("main")).toThrow("Automatic AI takeover is pending");
    tasks.save({
      ...task(),
      status: undefined,
      prompt: `${task().prompt}\nFriday's evidence is now available; inspect it.`,
    });
    tasks.recheckReview("main");
    await tasks.idle();
    await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
    expect(task().status).toBe("done");
    expect(task().reviewOnly).toBeUndefined();
  });

  it("refuses review recheck of unfinished or owner-stopped work", async () => {
    const { tasks, run } = setup();
    await run();
    expect(() => tasks.recheckReview("main")).toThrow("Only a blocked task");
    await tasks.move("main", "blocked");
    expect(() => tasks.recheckReview("main")).toThrow("Only a blocked task");
  });

  it.each(["missing verdict", "runtime failure", "owner stop"])(
    "does not auto-repair a goal review with %s",
    async (failure) => {
      const { tasks, reviewing, task, turns, finish, settled, advance } = setup();
      const original = await reviewing({ goalId: "goal" });
      if (failure === "owner stop") {
        await tasks.move("main", "blocked");
        await settled(original.reviewer!.sessionId!);
        await advance();
      } else if (failure === "runtime failure") {
        turns.at(-1)!.fail(new Error("Not signed in"));
        await settled(original.reviewer!.sessionId!);
        await advance();
      } else await finish(original.reviewer!.sessionId!, "Could not review.");
      expect(task().status).toBe("blocked");
      expect(task().repairAttempts).toBeUndefined();
    },
  );

  it("recovers a legacy goal review failure once and refuses a stopped task", async () => {
    const { tasks, store, reviewing, task, finish } = setup();
    const original = await reviewing();
    await finish(original.reviewer!.sessionId!, "VERDICT: FAIL - Friday is missing.");
    const takeover = { ...task(), goalId: "goal" };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(takeover), "main");
    // A task with a worker is recovered by the independent takeover scheduler.
    expect(tasks.recoverGoalReview("main", "goal")!.status).toBe("blocked");
    const legacy = { ...takeover, sessionId: undefined };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(legacy), "main");
    expect(tasks.recoverGoalReview("main", "other")!.status).toBe("blocked");
    expect(tasks.recoverGoalReview("main", "goal")).toMatchObject({
      status: "queued",
      repairAttempts: 1,
    });
    expect(tasks.recoverGoalReview("main", "goal")!.repairAttempts).toBe(1);
    store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ ...legacy, error: "Stopped by you." }), "main");
    expect(tasks.recoverGoalReview("main", "goal")!.status).toBe("blocked");
  });

  it("persists review notes across retries, read updates and successful verification", async () => {
    const { tasks, store, engine, clock, reviewing, task, turns, finish } = setup();
    await reviewing();
    const firstReviewer = task().reviewer!.sessionId!;
    const finding =
      '```json\n{"reviewNotes":[{"finding":"Friday is missing.","suggestion":"Include the Friday totals."}]}\n```';
    // Some providers emit the findings and verdict as separate assistant messages.
    turns.at(-1)!.input.onEvent({ type: "message.delta", text: finding });
    turns.at(-1)!.input.onEvent({ type: "message.completed" });
    await finish(firstReviewer, "VERDICT: FAIL - Friday is missing.");
    expect(task().reviewNotes).toHaveLength(1);
    const id = task().reviewNotes![0].id;
    expect(task().reviewNotes![0]).toMatchObject({
      suggestion: "Include the Friday totals.",
      sessionId: firstReviewer,
    });
    tasks.readNotes("main", [id]);
    const recreated = new HostTasks(store, engine, () => clock.now);
    expect(recreated.get("main")!.reviewNotes![0].readAt).toBe(clock.now);
    expect(() => tasks.readNotes("main", ["unknown"])).toThrow("Review note not found");
    expect(() => tasks.resolveNote("main", id, "yes")).toThrow("Invalid review note status");
    tasks.resolveNote("main", id, true);
    expect(task().status).toBe("blocked");
    tasks.resolveNote("main", id, false);
    await tasks.move("main", "queued");
    await tasks.tick();
    expect(turns.at(-1)!.input.text).toContain("bycoda.blocked-handoff.v1");
    expect(turns.at(-1)!.input.text).toContain("Include the Friday totals.");
    await finish(task().sessionId!);
    await finish(task().reviewer!.sessionId!, `${finding}\nVERDICT: FAIL - Friday is missing.`);
    expect(task().reviewNotes).toHaveLength(1);
    expect(task().reviewNotes![0]).toMatchObject({ id, occurrences: 2 });
    expect(task().reviewNotes![0].sessionIds).toHaveLength(2);
    tasks.save({
      ...task(),
      status: undefined,
      prompt: `${task().prompt}\nFriday totals are in the new input.`,
    });
    await tasks.move("main", "queued");
    await tasks.tick();
    await finish(task().sessionId!);
    await finish(
      task().reviewer!.sessionId!,
      '```json\n{"reviewNotes":[{"finding":"Consider a shortcut.","kind":"suggestion"}]}\n```\nVERDICT: PASS',
    );
    expect(task().status).toBe("done");
    expect(task().reviewNotes).toHaveLength(2);
    expect(task().reviewNotes![0].resolvedAt).toBe(clock.now);
    expect(task().reviewNotes![1].resolvedAt).toBeUndefined();
    // A read action based on an older snapshot must not acknowledge new notes.
    tasks.readNotes("main", [id]);
    expect(task().reviewNotes![1].readAt).toBeUndefined();
  });

  it("backfills available legacy review findings once without changing task status", async () => {
    const { tasks, store, reviewing, task, finish } = setup();
    const original = await reviewing();
    await finish(
      original.reviewer!.sessionId!,
      "file.ts:42 skips Friday.\nVERDICT: FAIL - Friday is missing.",
    );
    const { reviewNotes, ...legacy } = task();
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(legacy), "main");
    const migrated = tasks.list()[0];
    expect(migrated.status).toBe("blocked");
    expect(migrated.reviewNotes![0]).toMatchObject({
      finding: "Friday is missing.",
      details: "file.ts:42 skips Friday.",
    });
    expect(tasks.list()[0].reviewNotes).toEqual(migrated.reviewNotes);
    expect(tasks.get("main")!.updatedAt).toBe(legacy.updatedAt);
  });

  it(
    "automatically corrects a goal check failure with the command output",
    async () => {
      const { run, task, turns, finish } = setup();
      const original = await run({
        goalId: "goal",
        review: false,
        verifyCommand: 'node -e "console.log(123456); process.exit(1)"',
      });
      await finish(original.sessionId!);
      expect(task()).toMatchObject({ status: "queued", repairAttempts: 1 });
      // Verification runs asynchronously; the next scheduler tick starts the correction.
      expect(task().retryFeedback).toContain("123456");
      expect(task().retryFeedback).toContain("Check command:");
      expect(turns).toHaveLength(1);
    },
    SHELL_TEST_MS,
  );

  it("reads a verdict followed by another short message", async () => {
    const { reviewing, task, turns, settled, advance } = setup();
    const verifying = await reviewing();
    const turn = turns.at(-1)!;
    turn.input.onEvent({
      type: "message.delta",
      text: "Looked at it.\nVERDICT: FAIL - The report skips Friday.",
    });
    turn.input.onEvent({ type: "message.completed" });
    turn.input.onEvent({ type: "message.delta", text: "Done." });
    turn.input.onEvent({ type: "message.completed" });
    turn.finish();
    await settled(verifying.reviewer!.sessionId!);
    await advance();
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Review failed: The report skips Friday.",
    });
  });

  it.each([false, true])(
    "passes failed review details to the retry worker (isolated: %s)",
    async (isolated) => {
      const { tasks, reviewing, task, turns, finish, addRepo, store } = setup();
      const repo = isolated ? addRepo("repo") : undefined;
      const verifying = await reviewing(repo ? { projectId: repo.id } : {});
      const reviewer = verifying.reviewer!.sessionId!;
      await finish(
        reviewer,
        "package.ts:42 keeps the old selection after rollback.\nVERDICT: FAIL - Package versions disagree.",
      );
      const originalPrompt = task().prompt;
      // Going through To do must preserve the finding after verification is cleared.
      const todo = await tasks.move("main", "todo");
      expect(todo.verification).toBeUndefined();
      expect(todo.retryFeedback).toContain("package.ts:42");
      expect(todo.retryFeedback!.length).toBeLessThanOrEqual(12_000);
      await tasks.move("main", "queued");
      await tasks.tick();
      expect(task().prompt).toBe(originalPrompt);
      expect(task().sessionId).not.toBe(verifying.sessionId);
      expect(task().branch).toBe(verifying.branch);
      expect(store.session(task().sessionId!).session.cwd).toBe(
        verifying.worktreeCwd ?? store.project(verifying.projectId).cwd,
      );
      const retry = turns.at(-1)!.input.text;
      expect(retry).toContain(originalPrompt);
      expect(retry).toContain("Package versions disagree.");
      expect(retry).toContain("package.ts:42 keeps the old selection after rollback.");
      expect(retry).toContain("fix the findings");
      await finish(task().sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task().status).toBe(isolated ? "review" : "done");
      expect(task().retryFeedback).toBeUndefined();
    },
  );

  it("retries a failed review even when its session is unavailable", async () => {
    const { tasks, reviewing, task, turns, finish, store } = setup();
    const verifying = await reviewing();
    const reviewer = verifying.reviewer!.sessionId!;
    await finish(reviewer, "VERDICT: FAIL - Friday is missing.");
    store.deleteSession(reviewer);
    await tasks.move("main", "queued");
    await tasks.tick();
    expect(task().status).toBe("running");
    expect(turns.at(-1)!.input.text).toContain("Friday is missing.");
  });

  it("carries a failed check's output into retry and bounds the feedback", async () => {
    const { tasks, run, task, turns, store, advance } = setup();
    await run();
    await tasks.move("main", "blocked");
    await advance();
    const failed = {
      ...task(),
      error: "The check command failed (exit code 1).",
      verifyCommand: "pnpm test",
      verification: {
        command: {
          exitCode: 1,
          timedOut: false,
          output: "rollback selection failed\n" + "x".repeat(20_000),
        },
      },
    };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(failed), failed.id);
    const queued = await tasks.move("main", "queued");
    expect(queued.retryFeedback!.length).toBe(12_000);
    await tasks.tick();
    expect(turns.at(-1)!.input.text).toContain("Check command: pnpm test");
    expect(turns.at(-1)!.input.text).toContain("rollback selection failed");
  });

  it("blocks a task whose reviewer gave no verdict", async () => {
    const { reviewing, task, finish } = setup();
    const verifying = await reviewing();
    await finish(verifying.reviewer!.sessionId!, "Looks fine to me.");
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Review failed: Reviewer gave no verdict",
      verification: { review: { verdict: "fail" } },
    });
  });

  it("holds the reviewer to the task's time limit", async () => {
    const { tasks, reviewing, task, provider, settled, clock, advance } = setup();
    const verifying = await reviewing({ maxRunMinutes: 30 });
    clock.now += 29 * MINUTE;
    await tasks.tick();
    expect(provider.cancel).not.toHaveBeenCalled();
    clock.now += MINUTE;
    await tasks.tick();
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(verifying.reviewer!.sessionId!);
    await advance();
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Review failed: Stopped: reached the 30-minute time limit.",
    });
  });

  it("stops a task that is being verified", async () => {
    const { tasks, reviewing, task, provider, settled, advance } = setup();
    const verifying = await reviewing();
    expect(await tasks.move("main", "blocked")).toMatchObject({
      status: "blocked",
      error: "Stopped by you.",
    });
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    await settled(verifying.reviewer!.sessionId!);
    await advance();
    expect(task().status).toBe("blocked");
  });
});

describe("merging without waiting for approval", () => {
  const PASSING_CHECK = 'node -e "process.exit(0)"';

  it(
    "merges a task once its check command passes",
    async () => {
      const { review, addRepo, task } = setup();
      const repo = addRepo("repo");
      const merged = await review(
        { projectId: repo.id, autoMerge: true, verifyCommand: PASSING_CHECK },
        { "report.md": "# Report\n" },
      );
      expect(merged).toMatchObject({
        status: "done",
        merged: true,
        autoMerged: true,
        mergedAt: expect.any(Number),
      });
      expect(task().mergeError).toBeUndefined();
      expect(readFileSync(join(repo.cwd, "report.md"), "utf8")).toBe("# Report\n");
      expect(git(repo.cwd, "branch", "--list", "mc/*")).toBe("");
      expect(git(repo.cwd, "rev-list", "--parents", "-1", "HEAD").split(" ")).toHaveLength(3);
    },
    SHELL_TEST_MS,
  );

  it("merges a task once the reviewer passes it", async () => {
    const { reviewing, finish, task, addRepo } = setup();
    const repo = addRepo("repo");
    const verifying = await reviewing({ projectId: repo.id, autoMerge: true });
    await finish(verifying.reviewer!.sessionId!, "Looks right.\n\nVERDICT: PASS");
    expect(task()).toMatchObject({ status: "done", autoMerged: true });
  });

  it("corrects a task the reviewer fails while leaving it unmerged", async () => {
    const { reviewing, finish, task, addRepo } = setup();
    const repo = addRepo("repo");
    const verifying = await reviewing({ projectId: repo.id, autoMerge: true });
    await finish(verifying.reviewer!.sessionId!, "VERDICT: FAIL - missing");
    expect(task()).toMatchObject({ status: "running", repairAttempts: 1 });
    expect(task().autoMerged).toBeUndefined();
  });

  it("honors automatic merge when the owner disables checks", async () => {
    const { review, task, addRepo } = setup();
    const repo = addRepo("repo");
    const reviewed = await review(
      { projectId: repo.id, autoMerge: true },
      { "report.md": "# Report\n" },
    );
    expect(reviewed.status).toBe("done");
    expect(reviewed.mergeError).toBeUndefined();
    expect(existsSync(join(repo.cwd, "report.md"))).toBe(true);
    expect(task()).toMatchObject({ status: "done", merged: true });
    expect(task().autoMerged).toBe(true);
    expect(task().mergeError).toBeUndefined();
  });

  it(
    "delivers into a dirty checkout and keeps the owner's unrelated edits",
    async () => {
      const { review, addRepo, task, turns } = setup();
      const repo = addRepo("repo");
      writeFileSync(join(repo.cwd, "file.txt"), "edited by the owner\n");
      const reviewed = await review(
        { projectId: repo.id, autoMerge: true, verifyCommand: PASSING_CHECK },
        { "report.md": "# Report\n" },
      );
      // The worker was told which files other sessions are editing.
      expect(turns[0].input.text).toContain("uncommitted edits by other sessions");
      expect(turns[0].input.text).toContain("file.txt");
      expect(reviewed.status).toBe("done");
      expect(task()).toMatchObject({ merged: true, autoMerged: true });
      expect(task().mergeError).toBeUndefined();
      expect(task().deliveryNote).toBeUndefined();
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("edited by the owner\n");
      expect(readFileSync(join(repo.cwd, "report.md"), "utf8")).toBe("# Report\n");
      // The owner's file is still their uncommitted edit, not stashed or reverted.
      expect(git(repo.cwd, "status", "--porcelain")).toContain("file.txt");
      expect(git(repo.cwd, "stash", "list")).toBe("");
    },
    SHELL_TEST_MS,
  );

  it(
    "blocks delivery when the owner's uncommitted edits overlap the task's files",
    async () => {
      const { review, addRepo, task } = setup();
      const repo = addRepo("repo");
      writeFileSync(join(repo.cwd, "file.txt"), "owner version\n");
      const head = git(repo.cwd, "rev-parse", "HEAD");
      const reviewed = await review(
        { projectId: repo.id, autoMerge: true, verifyCommand: PASSING_CHECK },
        { "file.txt": "task version\n" },
      );
      expect(reviewed.status).toBe("review");
      expect(reviewed.autoMerged).toBeUndefined();
      expect(task().mergeError).toContain("overlap files this task changes (file.txt)");
      expect(task().mergeError).toContain("Commit or stash them, then merge again.");
      // Nothing moved: no merge, no stash, and the owner's edit is still in place.
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
      expect(git(repo.cwd, "stash", "list")).toBe("");
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("owner version\n");
      expect(git(repo.cwd, "status", "--porcelain")).toContain("file.txt");
    },
    SHELL_TEST_MS,
  );

  it(
    "blocks delivery when an untracked owner file would be overwritten by the merge",
    async () => {
      const { review, addRepo, task } = setup();
      const repo = addRepo("repo");
      writeFileSync(join(repo.cwd, "report.md"), "owner notes\n");
      const head = git(repo.cwd, "rev-parse", "HEAD");
      const reviewed = await review(
        { projectId: repo.id, autoMerge: true, verifyCommand: PASSING_CHECK },
        { "report.md": "# Report\n" },
      );
      expect(reviewed.status).toBe("review");
      expect(task().mergeError).toContain("overlap files this task changes (report.md)");
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
      expect(readFileSync(join(repo.cwd, "report.md"), "utf8")).toBe("owner notes\n");
      expect(git(repo.cwd, "stash", "list")).toBe("");
    },
    SHELL_TEST_MS,
  );

  it(
    "keeps a task in review with the error when the merge conflicts",
    async () => {
      const { run, finish, addRepo, task } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        verifyCommand: PASSING_CHECK,
      });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "from the agent\n");
      writeFileSync(join(repo.cwd, "file.txt"), "from the owner\n");
      git(repo.cwd, "commit", "-q", "-am", "owner");
      const head = git(repo.cwd, "rev-parse", "HEAD");
      await finish(started.sessionId!);
      expect(task().status).toBe("review");
      expect(task().mergeError).toContain("conflicts with main in file.txt");
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
      expect(git(repo.cwd, "status", "--porcelain")).toBe("");
    },
    SHELL_TEST_MS,
  );

  it(
    "never merges a task that ran in the project folder",
    async () => {
      const { review } = setup();
      const reviewed = await review({
        autoMerge: true,
        verifyCommand: PASSING_CHECK,
      });
      expect(reviewed).toMatchObject({ status: "done" });
      expect(reviewed.autoMerged).toBeUndefined();
      expect(reviewed.mergeError).toBeUndefined();
    },
    SHELL_TEST_MS,
  );

  it("keeps owner-cancelled auto-merge review work stopped", async () => {
    const { reviewing, task, finish, tasks, store, turns, advance } = setup();
    await reviewing({ autoMerge: true });
    await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
    // Older non-isolated runs could leave a review card instead of completing.
    const legacy = { ...task(), status: "review" };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(legacy), legacy.id);
    await tasks.cancel(task().id, "Goal cancelled");
    await advance();
    expect(task()).toMatchObject({
      status: "blocked",
      error: "Goal cancelled",
    });
    expect(turns).toHaveLength(2);
  });

  it("does not recover legacy review cards belonging to a cancelled goal", async () => {
    const { reviewing, task, finish, tasks, store, turns } = setup();
    await reviewing({ autoMerge: true, goalId: "cancelled-owner" });
    await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
    store.db.exec("CREATE TABLE goals (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    store.db
      .prepare("INSERT INTO goals VALUES (?, ?)")
      .run("cancelled-owner", JSON.stringify({ status: "cancelled" }));
    const legacy = {
      ...task(),
      status: "review",
      isolate: true,
      branch: "mc/retained",
      baseBranch: "main",
    };
    store.db.prepare("UPDATE tasks SET value=? WHERE id=?").run(JSON.stringify(legacy), legacy.id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await tasks.tick();
      expect(errors).not.toHaveBeenCalled();
      expect(task().status).toBe("review");
      expect(turns).toHaveLength(2);
    } finally {
      errors.mockRestore();
    }
  });

  it(
    "recreates a missing committed task worktree and respects the persisted integration limit",
    async () => {
      const { run, task, finish, advance, tasks, store, turns, addRepo } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        review: true,
      });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "task feature\n");
      writeFileSync(join(repo.cwd, "file.txt"), "base feature\n");
      git(repo.cwd, "commit", "-q", "-am", "base feature");
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      git(repo.cwd, "worktree", "remove", "--", started.worktreeCwd!);
      await advance();
      expect(task().status).toBe("running");
      expect(existsSync(task().worktreeCwd!)).toBe(true);
      expect(readFileSync(join(task().worktreeCwd!, "file.txt"), "utf8")).toContain("task feature");
      // Model another already-verified attempt at the integration ceiling.
      await tasks.move(task().id, "blocked");
      git(task().worktreeCwd!, "merge", "--abort");
      const limited = {
        ...task(),
        status: "review",
        verification: {
          review: { verdict: "pass", note: "", sessionId: "reviewer" },
        },
        mergeRepair: { ...task().mergeRepair!, attempts: MAX_REPAIR_ATTEMPTS },
        mergeRetry: undefined,
      };
      store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify(limited), limited.id);
      const turnCount = turns.length;
      await advance();
      expect(task()).toMatchObject({
        status: "blocked",
        repairStop: { reason: "limit" },
      });
      expect(turns).toHaveLength(turnCount);
      expect(existsSync(task().worktreeCwd!)).toBe(true);
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("base feature\n");
    },
    SHELL_TEST_MS,
  );

  it("corrects manually created auto-merge tasks using structured findings without repeating the review transcript", async () => {
    const { reviewing, finish, task, turns } = setup();
    await reviewing({ autoMerge: true });
    await finish(
      task().reviewer!.sessionId!,
      'Long review narrative that need not be repeated.\n```json\n{"reviewNotes":[{"finding":"Friday totals are missing.","suggestion":"Add Friday totals."}]}\n```\nVERDICT: FAIL - Friday totals are missing.',
    );
    expect(task()).toMatchObject({ status: "running", repairAttempts: 1 });
    const prompt = turns.at(-1)!.input.text;
    expect(prompt).toContain("Add Friday totals.");
    expect(prompt).not.toContain("Long review narrative");
  });

  it(
    "does not abort a merge the owner already has in progress",
    async () => {
      const { run, finish, task, addRepo, advance, turns } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        review: true,
      });
      git(repo.cwd, "checkout", "-q", "-b", "owner-change");
      writeFileSync(join(repo.cwd, "file.txt"), "owner branch\n");
      git(repo.cwd, "commit", "-q", "-am", "owner branch");
      git(repo.cwd, "checkout", "-q", "main");
      writeFileSync(join(repo.cwd, "file.txt"), "main branch\n");
      git(repo.cwd, "commit", "-q", "-am", "main branch");
      expect(() => git(repo.cwd, "merge", "owner-change")).toThrow();
      const pending = git(repo.cwd, "rev-parse", "MERGE_HEAD");
      const content = readFileSync(join(repo.cwd, "file.txt"), "utf8");
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      await advance();
      expect(task().status).toBe("review");
      expect(task().mergeError).toContain("merge in progress");
      expect(turns).toHaveLength(2);
      expect(git(repo.cwd, "rev-parse", "MERGE_HEAD")).toBe(pending);
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe(content);
    },
    SHELL_TEST_MS,
  );

  it(
    "automatically resolves integration in the retained checkout and releases dependencies only after review",
    async () => {
      const { run, finish, task, tasks, turns, advance, addRepo, input } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        review: true,
      });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "task feature\n");
      writeFileSync(join(started.worktreeCwd!, "task.txt"), "completed work\n");
      writeFileSync(join(repo.cwd, "file.txt"), "base feature\n");
      git(repo.cwd, "commit", "-q", "-am", "base update");
      const baseHead = git(repo.cwd, "rev-parse", "HEAD");
      tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: [started.id] }));
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task().status).toBe("review");
      const retainedHead = git(started.worktreeCwd!, "rev-parse", "HEAD");
      await advance();
      expect(task()).toMatchObject({
        status: "running",
        branch: started.branch,
        worktreeCwd: started.worktreeCwd,
        mergeRepair: { baseHead, attempts: 1 },
      });
      expect(task("dependent").status).toBe("queued");
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(baseHead);
      expect(git(started.worktreeCwd!, "rev-parse", "MERGE_HEAD")).toBe(baseHead);
      expect(turns.at(-1)!.input.text).toContain("Do not restart the task");
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "base feature\ntask feature\n");
      git(started.worktreeCwd!, "add", "file.txt");
      const repairSession = task().sessionId!;
      await finish(repairSession);
      expect(task().status).toBe("verifying");
      expect(task("dependent").status).toBe("queued");
      expect(git(started.worktreeCwd!, "merge-base", "--is-ancestor", retainedHead, "HEAD")).toBe(
        "",
      );
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task()).toMatchObject({
        status: "done",
        merged: true,
        autoMerged: true,
      });
      expect(task("dependent").status).toBe("running");
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("base feature\ntask feature\n");
      expect(readFileSync(join(repo.cwd, "task.txt"), "utf8")).toBe("completed work\n");
    },
    SHELL_TEST_MS,
  );

  it.each([
    { autoMerge: true, artifactOnly: false },
    { autoMerge: false, artifactOnly: false },
    { autoMerge: true, artifactOnly: true },
    { autoMerge: false, artifactOnly: true },
  ])(
    "replays completed work onto replacement history, reviews it, and releases dependencies (auto=$autoMerge, artifacts=$artifactOnly)",
    async ({ autoMerge, artifactOnly }) => {
      const { run, finish, task, tasks, turns, advance, addRepo, input } = setup();
      const repo = addRepo("replaced");
      writeFileSync(join(repo.cwd, ".gitignore"), "/temp/\n");
      git(repo.cwd, "add", ".gitignore");
      git(repo.cwd, "commit", "-q", "-m", "ignore local outputs");
      const started = await run({ projectId: repo.id, autoMerge, review: true });
      if (!artifactOnly) writeFileSync(join(started.worktreeCwd!, "task.txt"), "completed task\n");
      mkdirSync(join(started.worktreeCwd!, "temp/local/task-output"), { recursive: true });
      writeFileSync(
        join(started.worktreeCwd!, "temp/local/task-output/inventory.txt"),
        "reviewed inventory\n",
      );
      // Replace main's history while preserving its current snapshot.
      const replacement = git(repo.cwd, "commit-tree", "HEAD^{tree}", "-m", "replacement root");
      git(repo.cwd, "update-ref", "refs/heads/main", replacement);
      tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: [started.id] }));
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task().status).toBe("review");
      if (autoMerge) expect(task().mergeError).toContain("no common history");
      const originalHead = git(started.worktreeCwd!, "rev-parse", "HEAD");
      if (autoMerge) await advance();
      else {
        await tasks.move(started.id, "done");
        await tasks.idle();
      }
      expect(task().status).toBe("verifying");
      expect(task().branch).not.toBe(started.branch);
      expect(task().historyRecovery).toEqual([
        {
          branch: started.branch,
          worktreeCwd: started.worktreeCwd,
          baseCommit: started.baseCommit,
          head: originalHead,
        },
      ]);
      expect(task("dependent").status).toBe("queued");
      expect(
        readFileSync(join(task().worktreeCwd!, "temp/local/task-output/inventory.txt"), "utf8"),
      ).toBe("reviewed inventory\n");
      expect(turns).toHaveLength(3); // Original worker, original review, recovery review.
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(replacement);
      expect(git(started.worktreeCwd!, "rev-parse", "HEAD")).toBe(originalHead);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task()).toMatchObject({ status: "done", merged: true });
      expect(Boolean(task().autoMerged)).toBe(autoMerge);
      expect(task("dependent").status).toBe("running");
      if (!artifactOnly)
        expect(readFileSync(join(repo.cwd, "task.txt"), "utf8")).toBe("completed task\n");
      expect(task().artifactPaths).toEqual(["temp/local/task-output/inventory.txt"]);
      expect(
        readFileSync(
          join(task("dependent").worktreeCwd!, "temp/local/task-output/inventory.txt"),
          "utf8",
        ),
      ).toBe("reviewed inventory\n");
      expect(() => git(repo.cwd, "merge-base", "--is-ancestor", originalHead, "HEAD")).toThrow();
      expect(existsSync(started.worktreeCwd!)).toBe(false);
      expect(git(repo.cwd, "rev-parse", started.branch!)).toBe(originalHead);
    },
    SHELL_TEST_MS,
  );

  it(
    "repairs replay conflicts without changing the original result or delivery checkout",
    async () => {
      const { run, finish, task, tasks, advance, addRepo, input, turns } = setup();
      const repo = addRepo("replay-conflict");
      const started = await run({ projectId: repo.id, autoMerge: true, review: true });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "task feature\n");
      writeFileSync(join(repo.cwd, "file.txt"), "new base feature\n");
      git(repo.cwd, "add", "file.txt");
      const tree = git(repo.cwd, "write-tree");
      const replacement = git(repo.cwd, "commit-tree", tree, "-m", "replacement root");
      git(repo.cwd, "update-ref", "refs/heads/main", replacement);
      tasks.save(input({ id: "dependent", projectId: repo.id, dependsOn: [started.id] }));
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      const originalHead = git(started.worktreeCwd!, "rev-parse", "HEAD");
      await advance();
      expect(task()).toMatchObject({
        status: "running",
        mergeRepair: { conflicts: ["file.txt"], prepared: true, attempts: 1 },
      });
      expect(turns.at(-1)!.input.text).toContain("replayed only the recorded task changes");
      expect(task("dependent").status).toBe("queued");
      expect(git(repo.cwd, "status", "--porcelain")).toBe("");
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(replacement);
      expect(git(started.worktreeCwd!, "rev-parse", "HEAD")).toBe(originalHead);
      writeFileSync(join(task().worktreeCwd!, "file.txt"), "new base feature\ntask feature\n");
      git(task().worktreeCwd!, "add", "file.txt");
      await finish(task().sessionId!);
      expect(task().status).toBe("verifying");
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      expect(task().status).toBe("done");
      expect(task("dependent").status).toBe("running");
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe(
        "new base feature\ntask feature\n",
      );
    },
    SHELL_TEST_MS,
  );

  it.each(["missing base", "dirty original", "foreign base"])(
    "retains the original work when recovery encounters a %s",
    async (condition) => {
      const { run, finish, task, advance, addRepo, store, turns } = setup();
      const repo = addRepo("missing-base");
      const started = await run({ projectId: repo.id, autoMerge: true, review: true });
      const replacement = git(repo.cwd, "commit-tree", "HEAD^{tree}", "-m", "replacement root");
      git(repo.cwd, "update-ref", "refs/heads/main", replacement);
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      const originalHead = git(started.worktreeCwd!, "rev-parse", "HEAD");
      if (condition === "dirty original")
        writeFileSync(join(started.worktreeCwd!, "owner.txt"), "owner draft\n");
      const legacy = {
        ...task(),
        baseCommit:
          condition === "missing base"
            ? undefined
            : condition === "foreign base"
              ? replacement
              : task().baseCommit,
      };
      store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify(legacy), legacy.id);
      await advance();
      expect(task()).toMatchObject({ status: "blocked", repairStop: { reason: "external" } });
      if (condition === "missing base")
        expect(task().error).toContain("recorded task base is missing");
      if (condition === "dirty original") {
        expect(task().error).toContain("checkout changed after review");
        expect(readFileSync(join(started.worktreeCwd!, "owner.txt"), "utf8")).toBe("owner draft\n");
      }
      expect(turns).toHaveLength(2);
      expect(task().branch).toBe(started.branch);
      expect(git(started.worktreeCwd!, "rev-parse", "HEAD")).toBe(originalHead);
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(replacement);
    },
    SHELL_TEST_MS,
  );

  it(
    "resumes an interrupted history replay from its retained conflict index",
    async () => {
      const { run, finish, task, tasks, advance, addRepo, store, engine, clock, turns } = setup();
      const repo = addRepo("interrupted-replay");
      const started = await run({ projectId: repo.id, autoMerge: true, review: true });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "task feature\n");
      writeFileSync(join(repo.cwd, "file.txt"), "new base feature\n");
      git(repo.cwd, "add", "file.txt");
      const replacement = git(
        repo.cwd,
        "commit-tree",
        git(repo.cwd, "write-tree"),
        "-m",
        "replacement root",
      );
      git(repo.cwd, "update-ref", "refs/heads/main", replacement);
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      await advance();
      expect(task().status).toBe("running");
      const recoveryCwd = task().worktreeCwd!;
      const conflicts = readFileSync(join(recoveryCwd, "file.txt"), "utf8");
      await tasks.move(task().id, "blocked");
      // Model a restart after cherry-pick updated the index but before preparation
      // was persisted. The durable replayStarted marker must allow resumption.
      const interrupted = {
        ...task(),
        status: "queued",
        sessionId: undefined,
        runId: undefined,
        error: undefined,
        needsInput: undefined,
        awaitingOwnerRestart: undefined,
        mergeRepair: { ...task().mergeRepair!, prepared: false },
        updatedAt: ++clock.now,
      };
      store.db
        .prepare("UPDATE tasks SET value=? WHERE id=?")
        .run(JSON.stringify(interrupted), interrupted.id);
      const restarted = new HostTasks(store, engine, () => clock.now);
      await restarted.tick();
      expect(task()).toMatchObject({ status: "running", worktreeCwd: recoveryCwd });
      expect(readFileSync(join(recoveryCwd, "file.txt"), "utf8")).toBe(conflicts);
      expect(turns.at(-1)!.input.text).toContain("replayed only the recorded task changes");
      expect(git(repo.cwd, "rev-parse", "HEAD")).toBe(replacement);
    },
    SHELL_TEST_MS,
  );

  it(
    "retries dirty checkout delivery without a model and keeps backoff across restarts",
    async () => {
      const { run, finish, task, advance, turns, store, engine, clock, addRepo } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        review: true,
      });
      writeFileSync(join(started.worktreeCwd!, "task.txt"), "task\n");
      writeFileSync(join(repo.cwd, "file.txt"), "owner draft\n");
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      await advance();
      const retry = task().mergeRetry;
      const turnCount = turns.length;
      const restarted = new HostTasks(store, engine, () => clock.now);
      await restarted.tick();
      expect(task().mergeRetry).toEqual(retry);
      expect(turns).toHaveLength(turnCount);
      expect(readFileSync(join(repo.cwd, "file.txt"), "utf8")).toBe("owner draft\n");
      git(repo.cwd, "commit", "-q", "-am", "save owner draft");
      await restarted.tick();
      expect(task()).toMatchObject({ status: "done", autoMerged: true });
      expect(turns).toHaveLength(turnCount);
      expect(readFileSync(join(repo.cwd, "task.txt"), "utf8")).toBe("task\n");
    },
    SHELL_TEST_MS,
  );

  it(
    "never stages unresolved integration conflicts as a completed result",
    async () => {
      const { run, finish, task, advance, addRepo } = setup();
      const repo = addRepo("repo");
      const started = await run({
        projectId: repo.id,
        autoMerge: true,
        review: true,
      });
      writeFileSync(join(started.worktreeCwd!, "file.txt"), "task\n");
      writeFileSync(join(repo.cwd, "file.txt"), "owner\n");
      git(repo.cwd, "commit", "-q", "-am", "owner");
      await finish(started.sessionId!);
      await finish(task().reviewer!.sessionId!, "VERDICT: PASS");
      await advance();
      const head = git(started.worktreeCwd!, "rev-parse", "HEAD");
      await finish(task().sessionId!);
      expect(task()).toMatchObject({ status: "queued", repairAttempts: 1 });
      expect(task().retryFeedback).toContain("Unresolved merge conflicts");
      expect(git(started.worktreeCwd!, "rev-parse", "HEAD")).toBe(head);
      expect(git(started.worktreeCwd!, "diff", "--name-only", "--diff-filter=U")).toBe("file.txt");
    },
    SHELL_TEST_MS,
  );

  it(
    "keeps the location of a worktree with post-review changes after delivery",
    async () => {
      const { review, tasks, task, addRepo } = setup();
      const repo = addRepo("repo");
      const reviewed = await review({ projectId: repo.id }, { "task.txt": "task\n" });
      writeFileSync(join(reviewed.worktreeCwd!, "draft.txt"), "later draft\n");
      await tasks.move(reviewed.id, "done");
      expect(task()).toMatchObject({
        status: "done",
        worktreeCwd: reviewed.worktreeCwd,
      });
      expect(task().cleanupError).toContain("changes made after delivery");
      expect(readFileSync(join(reviewed.worktreeCwd!, "draft.txt"), "utf8")).toBe("later draft\n");
    },
    SHELL_TEST_MS,
  );

  it("retries cleanup of a delivered task after its worktree is unlocked", async () => {
    const { review, tasks, task, advance, addRepo } = setup();
    const repo = addRepo("cleanup-retry");
    const result = await review({ projectId: repo.id }, { "task.txt": "task\n" });
    git(repo.cwd, "worktree", "lock", result.worktreeCwd!);
    await tasks.move(result.id, "done");
    expect(task().status).toBe("done");
    expect(task().cleanupError).toContain("locked");
    expect(existsSync(result.worktreeCwd!)).toBe(true);
    git(repo.cwd, "worktree", "unlock", result.worktreeCwd!);
    await advance();
    await advance();
    expect(existsSync(result.worktreeCwd!)).toBe(false);
    expect(task().worktreeCwd).toBeUndefined();
    expect(task().cleanupError).toBeUndefined();
  });

  it("preserves a delivered checkout referenced by another task and cleans it when released", async () => {
    const { review, tasks, task, input, advance, addRepo } = setup();
    const repo = addRepo("cleanup-use");
    const result = await review({ projectId: repo.id }, { "task.txt": "task\n" });
    tasks.save(
      input({
        id: "owner-task",
        projectId: repo.id,
        status: "todo",
        isolate: false,
        workspace: { checkoutCwd: result.worktreeCwd },
      }),
    );
    await tasks.move(result.id, "done");
    expect(task().cleanupError).toContain("still in use");
    expect(existsSync(result.worktreeCwd!)).toBe(true);
    await tasks.delete("owner-task");
    await advance();
    await advance();
    expect(existsSync(result.worktreeCwd!)).toBe(false);
    expect(task().cleanupError).toBeUndefined();
  });

  it("saves autoMerge, drops it when an edit turns it off, and rejects other values", () => {
    const { tasks, input } = setup();
    expect(tasks.save(input({ autoMerge: true }))).toMatchObject({
      autoMerge: true,
    });
    expect(tasks.save(input({ autoMerge: false })).autoMerge).toBeUndefined();
    expect(tasks.save(input({ id: "other" })).autoMerge).toBeUndefined();
    expect(() => tasks.save(input({ id: "bad", autoMerge: "yes" }))).toThrow(
      "Invalid task options",
    );
  });
});

describe("host work limits", () => {
  it("defaults to two tasks at once and no daily limit", () => {
    const { tasks } = setup();
    expect(tasks.limits.settings()).toEqual({
      maxRunningTasks: MAX_RUNNING_TASKS,
      dailyAgentMinutes: 0,
    });
    expect(tasks.limits.state()).toMatchObject({
      usedMinutes: 0,
      limitReached: false,
    });
  });

  it("validates settings and keeps fields that were not sent", () => {
    const { tasks } = setup();
    for (const bad of [
      { maxRunningTasks: 0 },
      { maxRunningTasks: 9 },
      { maxRunningTasks: 1.5 },
      { maxRunningTasks: "2" },
      { dailyAgentMinutes: -1 },
      { dailyAgentMinutes: Number.MAX_SAFE_INTEGER + 1 },
      { dailyAgentMinutes: 2.5 },
    ])
      expect(() => tasks.limits.save(bad)).toThrow();
    expect(() => tasks.limits.save(null)).toThrow("Invalid settings");
    expect(tasks.limits.save({ maxRunningTasks: 8 })).toEqual({
      maxRunningTasks: 8,
      dailyAgentMinutes: 0,
    });
    expect(tasks.limits.save({ dailyAgentMinutes: 2880 })).toEqual({
      maxRunningTasks: 8,
      dailyAgentMinutes: 2880,
    });
  });

  it("uses the saved cap on how many tasks run at once", async () => {
    const { tasks, input, task, turns, clock, addProject } = setup();
    for (const id of ["a", "b", "c"]) {
      tasks.save(input({ id, projectId: addProject(id).id }));
      clock.now += 1;
    }
    tasks.limits.save({ maxRunningTasks: 1 });
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(["a", "b", "c"].map((id) => task(id).status)).toEqual(["running", "queued", "queued"]);
    tasks.limits.save({ maxRunningTasks: 3 });
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect(["a", "b", "c"].map((id) => task(id).status)).toEqual(["running", "running", "running"]);
  });

  it("starts nothing new once the day is used up, lets running work finish, and resumes tomorrow", async () => {
    const { tasks, input, run, task, turns, settled, clock, advance, addProject } = setup();
    tasks.limits.save({ dailyAgentMinutes: 5 });
    const first = await run({ id: "a", projectId: addProject("a").id });
    tasks.save(input({ id: "b", projectId: addProject("b").id }));
    clock.now += 1;

    // The run still going counts as it goes.
    clock.now += 5 * MINUTE;
    await tasks.tick();
    expect(tasks.limits.state()).toMatchObject({ limitReached: true });
    expect(tasks.limits.usedMinutes()).toBeCloseTo(5, 1);
    expect(task("a").status).toBe("running");
    expect(task("b").status).toBe("queued");
    expect(turns).toHaveLength(1);

    // Finishing is allowed; the next task still waits.
    turns[0].finish();
    await settled(first.sessionId!);
    await advance();
    expect(task("a").status).toBe("done");
    expect(task("b").status).toBe("queued");
    expect(tasks.limits.usedMinutes()).toBeCloseTo(6, 1);
    expect(turns).toHaveLength(1);

    // A new local day starts a fresh total.
    clock.now += 24 * 60 * MINUTE;
    expect(tasks.limits.state()).toMatchObject({
      limitReached: false,
      usedMinutes: 0,
    });
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(task("b").status).toBe("running");
  });

  it("resumes queued work today when the daily limit is raised", async () => {
    const { tasks, input, task, turns, clock, addProject } = setup();
    // Keep the recorded 721 minutes in today's calendar-day budget.
    clock.now = new Date("2026-10-05T14:00:00").getTime();
    tasks.limits.save({ dailyAgentMinutes: 720 });
    tasks.limits.record(clock.now - 721 * MINUTE);
    expect(tasks.limits.usedMinutes()).toBe(721);
    tasks.save(input({ id: "custom-limit", projectId: addProject("custom-limit").id }));
    await tasks.tick();
    expect(tasks.limits.reached()).toBe(true);
    expect(task("custom-limit").status).toBe("queued");
    expect(turns).toHaveLength(0);
    tasks.limits.save({ dailyAgentMinutes: 2880 });
    expect(tasks.limits.reached()).toBe(false);
    await tasks.tick();
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(task("custom-limit").status).toBe("running");
  });

  it("keeps the total and the settings across a host restart", async () => {
    const { tasks, store, engine, run, turns, settled, clock, advance } = setup();
    tasks.limits.save({ maxRunningTasks: 3, dailyAgentMinutes: 120 });
    const started = await run();
    clock.now += 10 * MINUTE;
    turns[0].finish();
    await settled(started.sessionId!);
    await advance();
    const used = tasks.limits.usedMinutes();
    expect(used).toBeCloseTo(11, 1);

    const restarted = new HostTasks(store, engine, () => clock.now);
    expect(restarted.limits.settings()).toEqual({
      maxRunningTasks: 3,
      dailyAgentMinutes: 120,
    });
    expect(restarted.limits.usedMinutes()).toBeCloseTo(used, 5);
  });

  it("counts the reviewer time too", async () => {
    const { tasks, reviewing, finish, clock } = setup();
    const verifying = await reviewing();
    clock.now += 4 * MINUTE;
    await finish(verifying.reviewer!.sessionId!, "VERDICT: PASS");
    // The run took a minute, and the reviewer the minutes after it.
    expect(tasks.limits.usedMinutes()).toBeGreaterThan(4);
  });
});

it("caches unchanged lists and filters projects before JSON parsing", () => {
  const { store, tasks, input } = setup();
  tasks.save(input());
  const other = store.addProject(join(tmpdir(), "other-task-list"), "Other");
  tasks.save(input({ id: "other", projectId: other.id }));
  const parse = vi.spyOn(JSON, "parse");
  const first = tasks.list();
  parse.mockClear();
  expect(tasks.list()).toEqual(first);
  expect(parse).not.toHaveBeenCalled();
  const filtered = tasks.list(first[0].projectId);
  expect(filtered).toHaveLength(1);
  expect(parse).toHaveBeenCalledTimes(1);
  parse.mockClear();
  filtered.pop();
  expect(tasks.list(first[0].projectId)).toHaveLength(1);
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
  tasks.save(input({ title: "Changed" }));
  expect(tasks.list(first[0].projectId)[0].title).toBe("Changed");
});

it(
  "stops a real verification tree and holds retry/delete until it exits",
  async () => {
    const { tasks, run, turns, settled, store, task } = setup();
    const started = await run({ verifyCommand: 'node "check.cjs"' });
    const cwd = store.project(started.projectId).cwd;
    const output = join(cwd, "writes.txt");
    writeFileSync(
      join(cwd, "writer.cjs"),
      `setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(output)}, 'x'), 20);`,
    );
    writeFileSync(
      join(cwd, "check.cjs"),
      `require('node:child_process').spawn(process.execPath, ['writer.cjs'], { stdio: 'inherit', windowsHide: true }); setInterval(() => {}, 1000);`,
    );
    turns[0].finish();
    await settled(started.sessionId!);
    await tasks.tick();
    await vi.waitFor(() => expect(existsSync(output)).toBe(true), { timeout: 15000 });
    expect(task().status).toBe("verifying");
    await tasks.move("main", "blocked");
    await expect(tasks.move("main", "queued")).rejects.toThrow("still stopping");
    await expect(tasks.delete("main", true)).rejects.toThrow("still stopping");
    await tasks.idle();
    const stopped = readFileSync(output, "utf8");
    await new Promise((done) => setTimeout(done, 200));
    expect(readFileSync(output, "utf8")).toBe(stopped);
    expect((await tasks.move("main", "queued")).status).toBe("queued");
  },
  SHELL_TEST_MS,
);
