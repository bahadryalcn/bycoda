import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { hostGitExec } from "./git-exec-pool";
import {
  createHostWorktree,
  hostWorktrees,
  hostWorktreesWithState,
  invalidateHostWorktrees,
  renameHostWorktreeBranch,
  resolveHostWorktreeAsync,
} from "./git-worktrees";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each([false, true])(
  "applies generated worktree names only to retained sessions (deleted: %s)",
  async (deleted) => {
    const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-names-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd });
    git("init", "-q");
    git("checkout", "-q", "-b", "main");
    writeFileSync(join(cwd, "file.txt"), "initial\n");
    git("add", "file.txt");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "-m",
      "initial",
    );
    const store = new HostStore(join(cwd, "host.db"));
    const title = vi.fn(async () => ({
      title: "Fix remote naming",
      workItem: null,
    }));
    let finishBranch!: (branch: string) => void;
    const branch = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishBranch = resolve;
        }),
    );
    const engine = new HostEngine(store, {
      codex: {
        send: async () => {},
        cancel: async () => {},
        stop: async () => {},
        bind: () => {},
        approve: () => {},
        answer: () => {},
        generateTitle: title,
        generateBranchName: branch,
      },
    });
    await engine.ready;
    const project = await store.addProject(cwd, "Test");
    const root = (await hostWorktrees(cwd)).defaultRoot;
    cleanups.push(async () => {
      await engine.close();
      await store.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    });
    const tree = await createHostWorktree(cwd, "by/12345678", "HEAD", false);
    const { sessionId } = await engine.command({
      type: "create",
      commandId: "create-named",
      projectId: project.id,
      worktreeCwd: tree.path,
      autoWorktreeBranch: tree.branch!,
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    });
    await engine.command({
      type: "send",
      commandId: "first",
      sessionId,
      text: "Fix remote session and worktree naming",
    });
    await vi.waitFor(() => expect(branch).toHaveBeenCalledTimes(1), { timeout: 20_000 });
    // Settling a turn includes real Git checkpoints; Windows process startup
    // can exceed waitFor's default one-second deadline.
    const waitForIdle = () =>
      vi.waitFor(async () => expect((await store.session(sessionId)).status).toBe("idle"), {
        timeout: 20_000,
      });
    if (deleted) {
      await waitForIdle();
      await store.deleteSession(sessionId);
      const logged = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        finishBranch("remote-naming");
        await vi.waitFor(
          () =>
            expect(logged).toHaveBeenCalledWith(
              "[bycoda] retained provider hint",
              expect.any(Error),
            ),
          { timeout: 20_000 },
        );
        expect(
          (await hostWorktrees(cwd)).worktrees.find((item) => item.path === tree.path)?.branch,
        ).toBe("by/12345678");
      } finally {
        logged.mockRestore();
      }
      return;
    }
    finishBranch("remote-naming");
    await vi.waitFor(
      async () => {
        expect((await store.session(sessionId)).session).toMatchObject({
          title: "codex · Fix remote naming",
          branch: "by/remote-naming",
          worktreeCwd: tree.path,
        });
      },
      { timeout: 20_000 },
    );
    expect(
      (await hostWorktrees(cwd)).worktrees.find((item) => item.path === tree.path)?.branch,
    ).toBe("by/remote-naming");
    expect(title).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledTimes(1);
    await waitForIdle();
    await engine.command({
      type: "send",
      commandId: "second",
      sessionId,
      text: "More work",
    });
    await waitForIdle();
    expect(title).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledTimes(1);
    await expect(
      renameHostWorktreeBranch(cwd, tree.path, "by/12345678", "by/other"),
    ).rejects.toThrow("changed");
  },
  90_000,
);

it("creates registered host worktrees and binds new sessions to the selected checkout", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-worktrees-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  git("add", "file.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "initial");
  git("branch", "existing");
  const store = new HostStore(join(cwd, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      cancel: async () => {},
      stop: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  await engine.ready;
  const project = await store.addProject(cwd, "Test");
  const root = (await hostWorktrees(cwd)).defaultRoot;
  cleanups.push(async () => {
    await engine.close();
    await store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  const tree = await createHostWorktree(cwd, "feature/task", "HEAD", false);
  expect(tree).toMatchObject({
    branch: "feature/task",
    isMain: false,
    missing: false,
  });
  expect(await resolveHostWorktreeAsync(cwd, tree.path)).toBe(tree.path);
  const listed = await hostWorktrees(cwd);
  expect(listed.worktrees.map((item) => item.branch)).toEqual(["main", "feature/task"]);
  const receipt = await engine.command({
    type: "create",
    commandId: "worktree-session",
    projectId: project.id,
    worktreeCwd: tree.path,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  expect((await store.session(receipt.sessionId)).session.cwd).toBe(tree.path);
  await expect(
    engine.command({
      type: "create",
      commandId: "outside",
      projectId: project.id,
      worktreeCwd: tmpdir(),
      harness: "codex",
      model: "codex:test",
      runtimeMode: "supervised",
    }),
  ).rejects.toThrow("Choose an available worktree");
  await expect(createHostWorktree(cwd, "feature/task", "HEAD", false)).rejects.toThrow(
    "already has a working copy",
  );
  const existing = await createHostWorktree(cwd, "existing", "HEAD", true);
  expect(existing.branch).toBe("existing");
});

it("reuses a worktree list briefly and refreshes it after this host changes worktrees", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-wt-cache-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, windowsHide: true });
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  git("add", "file.txt");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "initial");
  // Cache age is the behavior under test, independent of real Git process startup time.
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
  cleanups.push(() => {
    clock.mockRestore();
  });
  const root = (await hostWorktrees(cwd)).defaultRoot;
  cleanups.push(() => {
    invalidateHostWorktrees();
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
  const first = await hostWorktrees(cwd);
  const [second, third] = await Promise.all([hostWorktrees(cwd), hostWorktrees(cwd)]);
  expect(second).toBe(first);
  expect(third).toBe(first);

  // A change this host did not make is only seen after the short cache lapses
  // or is dropped, but resolving refuses nothing until it has looked again.
  const outside = join(root, "outside");
  git("worktree", "add", "-q", "-b", "outside", outside);
  expect((await hostWorktrees(cwd)).worktrees).toHaveLength(1);
  expect(await resolveHostWorktreeAsync(cwd, outside)).toContain("outside");
  expect((await hostWorktrees(cwd)).worktrees).toHaveLength(2);

  // Creating one through the host is visible at once.
  const created = await createHostWorktree(cwd, "inside", "HEAD", false);
  expect((await hostWorktrees(cwd)).worktrees.map((tree) => tree.path)).toContain(created.path);

  git("worktree", "remove", "--force", outside);
  git("init", "-q", outside);
  await expect(resolveHostWorktreeAsync(cwd, outside)).rejects.toThrow(
    "Choose an available worktree",
  );
  invalidateHostWorktrees(cwd);
  expect((await hostWorktrees(cwd)).worktrees.map((tree) => tree.branch)).not.toContain("outside");
  await expect(resolveHostWorktreeAsync(cwd, outside)).rejects.toThrow(
    "Choose an available worktree",
  );
});

it("lists dirty and unpushed state for every worktree so remote clients see what the desktop does", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-host-state-"));
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd });
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  git("add", "file.txt");
  git("-c", "user.name=Test", "-c", "user.email=t@example.com", "commit", "-q", "-m", "initial");
  const side = `${cwd}-side`;
  cleanups.push(() => rmSync(side, { recursive: true, force: true }));
  git("worktree", "add", "-q", "-b", "side", side);
  writeFileSync(join(side, "new.txt"), "x\n");
  invalidateHostWorktrees();
  const listed = await hostWorktreesWithState(cwd);
  const byBranch = Object.fromEntries(listed.worktrees.map((tree) => [tree.branch, tree]));
  // No remote: both commits are on no remote, and only the side worktree has an untracked file.
  expect(byBranch.main).toMatchObject({ dirty: false, unpushed: 1 });
  expect(byBranch.side).toMatchObject({ dirty: true, unpushed: 1 });
  // Host-internal callers keep the cheap list without per-checkout Git state.
  expect((await hostWorktrees(cwd)).worktrees[0]).not.toHaveProperty("dirty");
});

it("shares pending worktree state and starts the cache lifetime at completion", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-worktree-state-flight-"));
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const now = vi.spyOn(Date, "now");
  const exec = vi.spyOn(hostGitExec, "exec").mockImplementation(async (_file, [command]) => {
    if (command === "worktree")
      return { stdout: `worktree ${cwd}\0HEAD ${"f".repeat(40)}\0\0`, stderr: "" };
    started.resolve();
    await release.promise;
    return { stdout: command === "rev-list" ? "0\n" : "", stderr: "" };
  });
  const initialTime = Date.now();
  const calls: Promise<unknown>[] = [];
  try {
    const first = hostWorktreesWithState(cwd, true);
    calls.push(first);
    await started.promise;
    now.mockReturnValue(initialTime + 2_200);
    const pending = hostWorktreesWithState(cwd, true);
    calls.push(pending);
    release.resolve();
    await Promise.all(calls);
    expect(pending).toBe(first);
    expect(exec.mock.calls.map(([, [command]]) => command)).toEqual([
      "worktree",
      "status",
      "rev-list",
    ]);

    now.mockReturnValue(initialTime + 4_100);
    expect(hostWorktreesWithState(cwd)).toBe(first);
    now.mockReturnValue(initialTime + 4_201);
    const expired = hostWorktreesWithState(cwd);
    calls.push(expired);
    expect(expired).not.toBe(first);
    await expired;
    expect(exec.mock.calls.map(([, [command]]) => command)).toEqual([
      "worktree",
      "status",
      "rev-list",
      "status",
      "rev-list",
    ]);
  } finally {
    release.resolve();
    await Promise.allSettled(calls);
    exec.mockRestore();
    now.mockRestore();
    invalidateHostWorktrees(cwd);
  }
});

it("keeps interactive worktree reads out of the pending background lane", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bycoda-worktree-state-priority-"));
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
  const release = Promise.withResolvers<void>();
  const backgroundStarted = Promise.withResolvers<void>();
  const exec = vi
    .spyOn(hostGitExec, "exec")
    .mockImplementation(async (_file, [command], options) => {
      if (command === "worktree")
        return { stdout: `worktree ${cwd}\0HEAD ${"f".repeat(40)}\0\0`, stderr: "" };
      if (options.lane === "background") {
        backgroundStarted.resolve();
        await release.promise;
      }
      return { stdout: command === "rev-list" ? "0\n" : "", stderr: "" };
    });
  const background = hostWorktreesWithState(cwd, true);
  try {
    await backgroundStarted.promise;
    const interactive = hostWorktreesWithState(cwd);
    expect(interactive).not.toBe(background);
    expect(hostWorktreesWithState(cwd, true)).toBe(interactive);
    expect((await interactive).worktrees[0]).toMatchObject({ dirty: false, unpushed: 0 });
    invalidateHostWorktrees(cwd);
    const refreshed = hostWorktreesWithState(cwd);
    expect(refreshed).not.toBe(interactive);
    await refreshed;
    release.resolve();
    await background;
    expect(hostWorktreesWithState(cwd)).toBe(refreshed);
  } finally {
    release.resolve();
    await Promise.allSettled([background]);
    exec.mockRestore();
    invalidateHostWorktrees(cwd);
  }
});
