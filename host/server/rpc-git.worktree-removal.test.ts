import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { hostGitExec } from "../git/git-exec-pool";
import { DesktopLive } from "../desktop/desktopLive";
import { handleGitRpc } from "./rpc-git";
import type { OwnerRpcRequest } from "./owner-rpc-context";

async function fixture(headless?: (path: string, project: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-remote-removal-"));
  const cwd = join(root, "main");
  const path = join(root, "worktree");
  const git = (...args: string[]) => hostGitExec.exec("git", args, { cwd, timeout: 10_000 });
  await mkdir(cwd);
  await git("init", "-q");
  await writeFile(join(cwd, "file"), "original");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-qm",
    "base",
  );
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("worktree", "add", "-qb", "linked", path);
  const startupStates = vi.fn<() => Promise<{ id: string; cwd: string; running?: boolean }[]>>(
    async () => [],
  );
  const runningInWorkspace = vi.fn<() => unknown[]>(() => []);
  let clockOffset = 0;
  const live = new DesktopLive(() => Date.now() + clockOffset, false, headless);
  const deps = {
    engine: {
      store: { project: async () => ({ cwd }), startupStates },
      hasActiveRun: () => false,
      withIdleProject: (_: string, work: () => Promise<unknown>) => work(),
    },
    terminals: {
      runningInWorkspace,
      withWorktreeRemoval: (_: string, work: () => Promise<unknown>) => work(),
    },
    managed: { list: async () => [] },
    desktop: {
      listSnapshotAsync: async () => ({ sessions: [] }),
      live,
    },
    runLeases: { holder: () => undefined },
  };
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const request = {
      input: { method },
      params: { projectId: "project", path, ...params },
      tokenHash: "owner",
      domainContext: { authorized: async () => true },
    } as unknown as OwnerRpcRequest;
    await handleGitRpc(deps as unknown as Parameters<typeof handleGitRpc>[0], request);
    return request.result as {
      token: string;
      status: string;
      ignoredEntryCount: number;
      ignoredEntryPaths: string[];
      unpushed: number;
      sessionIds: string[];
    };
  };
  const remove = (token: string, params?: Record<string, unknown>) =>
    rpc("git.worktreeRemove", { token, ...params });
  return {
    cwd,
    path,
    git,
    startupStates,
    runningInWorkspace,
    live,
    review: (params?: Record<string, unknown>) => rpc("git.worktreeRemovalReview", params),
    remove,
    async removeWithLease(token: string, params?: Record<string, unknown>) {
      const beat = { clientId: "desktop", sessions: [] };
      live.beat(beat);
      const removal = remove(token, params);
      await vi.waitFor(
        () => {
          const job = live.removalLeaseBeat(beat).jobs.find((entry) => entry.path);
          expect(job).toBeDefined();
          live.removalLeaseBeat({
            ...beat,
            removalLeaseReplies: [
              { id: job!.id, granted: true, release: false, checks: ["editors"] },
            ],
          });
        },
        { timeout: 10_000 },
      );
      return removal;
    },
    expireHeartbeat: (ms = 60_000) => {
      clockOffset += ms;
    },
    close: () => rm(root, { recursive: true, force: true }),
  };
}

it("uses the dedicated Host's verified checkout and repository for a reviewed removal", async () => {
  const verify = vi.fn(async () => {});
  const f = await fixture(verify);
  try {
    const { token } = await f.review();
    const [checkout, repository] = await Promise.all([realpath(f.path), realpath(f.cwd)]);
    await f.remove(token);
    expect(verify).toHaveBeenCalledWith(checkout, repository);
    expect((await f.git("worktree", "list", "--porcelain")).stdout).not.toContain(
      "refs/heads/linked",
    );
  } finally {
    await f.close();
  }
});

it("keeps a stale desktop's native fence on a declared dedicated Host", async () => {
  const verify = vi.fn(async () => {});
  const f = await fixture(verify);
  try {
    f.live.beat({ clientId: "desktop", sessions: [] });
    f.expireHeartbeat();
    const { token } = await f.review();
    await expect(f.remove(token)).rejects.toThrow("Reconnect the execution Host desktop");
    expect(verify).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

const worktreeListed = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await f.git("worktree", "list", "--porcelain")).stdout.includes("refs/heads/linked");

it("removes a clean worktree without any desktop ever connected", async () => {
  const f = await fixture();
  try {
    // The Host has been up past the grace period, so no desktop is still reconnecting.
    f.expireHeartbeat(3 * 60_000);
    const { token } = await f.review();
    await expect(f.remove(token)).resolves.toMatchObject({ sessionIds: [] });
    expect(await worktreeListed(f)).toBe(false);
  } finally {
    await f.close();
  }
}, 30_000);

it("removes a clean worktree when the desktop left more than two minutes ago", async () => {
  const f = await fixture();
  try {
    f.live.beat({ clientId: "old-desktop", sessions: [] });
    f.expireHeartbeat(3 * 60_000);
    const { token } = await f.review();
    await expect(f.remove(token)).resolves.toMatchObject({ sessionIds: [] });
    expect(await worktreeListed(f)).toBe(false);
  } finally {
    await f.close();
  }
}, 30_000);

it("still refuses without a desktop for a forced, dirty or untracked worktree", async () => {
  const g = await fixture();
  try {
    await writeFile(join(g.path, "untracked"), "x");
    const dirty = await g.review();
    await expect(g.remove(dirty.token)).rejects.toThrow("uncommitted changes");
    await expect(g.remove(dirty.token, { force: true })).rejects.toThrow(
      "Reconnect the execution Host desktop and retry",
    );
    expect(await worktreeListed(g)).toBe(true);
  } finally {
    await g.close();
  }
}, 60_000);

it.each(["stale", "stale alongside a live client"])(
  "preserves the checkout when desktop liveness is %s",
  async (state) => {
    const f = await fixture();
    try {
      f.live.beat({ clientId: "old-desktop", sessions: [] });
      f.expireHeartbeat();
      if (state === "stale alongside a live client")
        f.live.beat({ clientId: "desktop", sessions: [] });
      const { token } = await f.review();
      await expect(f.remove(token)).rejects.toThrow(
        "Reconnect the execution Host desktop and retry",
      );
      expect((await f.git("worktree", "list", "--porcelain")).stdout).toContain(
        "refs/heads/linked",
      );
    } finally {
      await f.close();
    }
  },
  30_000,
);

it("waits for the execution desktop lease and requests release after removal", async () => {
  const f = await fixture();
  try {
    const beat = { clientId: "desktop", sessions: [] };
    f.live.beat(beat);
    const { token } = await f.review();
    const removal = f.remove(token);
    const [job] = await vi.waitFor(
      () => {
        const { jobs } = f.live.removalLeaseBeat(beat);
        expect(jobs).toHaveLength(1);
        return jobs;
      },
      { timeout: 10_000 },
    );
    if (!job) throw new Error("Missing desktop removal job");
    const reply = { id: job.id, granted: true, release: false, checks: ["editors"] };
    expect(
      f.live.removalLeaseBeat({ ...beat, clientId: "other", removalLeaseReplies: [reply] }).acked,
    ).toEqual([]);
    expect(f.live.removalLeaseBeat({ ...beat, removalLeaseReplies: [reply] }).acked).toEqual([
      job.id,
    ]);
    await expect(removal).resolves.toMatchObject({ sessionIds: [] });
    expect(f.live.removalLeaseBeat(beat).jobs).toEqual([{ id: job.id, clientId: beat.clientId }]);
  } finally {
    await f.close();
  }
}, 30_000);

it("preserves the checkout when the open desktop never acknowledges the lease", async () => {
  const f = await fixture();
  try {
    const beat = { clientId: "desktop", sessions: [] };
    f.live.beat(beat);
    const { token } = await f.review();
    await expect(f.remove(token)).rejects.toThrow("Cannot verify native terminal usage");
    const [release] = f.live.removalLeaseBeat(beat).jobs;
    expect(release).toMatchObject({ clientId: beat.clientId, path: undefined });
    expect(
      f.live.removalLeaseBeat({
        ...beat,
        removalLeaseReplies: [{ id: release?.id, granted: true, release: false }],
      }).jobs,
    ).toEqual([release]);
    expect((await f.git("worktree", "list", "--porcelain")).stdout).toContain("refs/heads/linked");
  } finally {
    await f.close();
  }
}, 30_000);

it("refuses the main checkout and binds force to hidden, untracked and changed file content", async () => {
  const f = await fixture();
  try {
    await expect(f.review({ path: f.cwd })).rejects.toThrow("Main cannot be removed");
    await f.git("-C", f.path, "config", "status.showUntrackedFiles", "no");
    await f.git("-C", f.path, "update-index", "--assume-unchanged", "file");
    await writeFile(join(f.path, "file"), "hidden change");
    await writeFile(join(f.path, "untracked"), "untracked");
    const review = await f.review();
    expect(review.status).toContain(" M file");
    expect(review.status).toContain("?? untracked");
    await expect(f.remove(review.token)).rejects.toThrow("uncommitted changes");
    await writeFile(join(f.path, "untracked"), "different");
    await expect(f.remove(review.token, { force: true })).rejects.toThrow("Worktree changed");
    const current = await f.review();
    await expect(f.removeWithLease(current.token, { force: true })).resolves.toMatchObject({
      sessionIds: [],
    });
  } finally {
    await f.close();
  }
}, 60_000);

it("checks linked sessions, terminals, unpublished commits and unknown usage", async () => {
  const f = await fixture();
  try {
    const alias = join(f.cwd, "..", "session-alias");
    await symlink(f.path, alias, process.platform === "win32" ? "junction" : "dir");
    f.startupStates.mockResolvedValue([{ id: "linked-session", cwd: alias, running: true }]);
    f.runningInWorkspace.mockReturnValue([{}]);
    const busy = await f.review();
    expect(busy).toMatchObject({
      sessionIds: ["linked-session"],
      hasTerminals: true,
      hasAgents: true,
    });
    await expect(f.remove(busy.token, { force: true })).rejects.toThrow(
      "Stop active terminals and agents",
    );
    f.startupStates.mockRejectedValueOnce(new Error("Usage is unavailable"));
    await expect(f.remove(busy.token)).rejects.toThrow("Usage is unavailable");
    f.startupStates.mockResolvedValue([]);
    f.runningInWorkspace.mockReturnValue([]);
    await f.git(
      "-C",
      f.path,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "unpublished",
    );
    const unpublished = await f.review();
    expect(unpublished.unpushed).toBe(1);
    await expect(f.remove(unpublished.token, { force: true })).rejects.toThrow(
      "unpublished commits",
    );
  } finally {
    await f.close();
  }
}, 60_000);

it("leaves both registrations intact when two checkout directories are missing", async () => {
  const f = await fixture();
  try {
    const other = join(f.cwd, "..", "other");
    await f.git("worktree", "add", "-qb", "other", other);
    const review = await f.review();
    await rm(f.path, { recursive: true });
    await rm(other, { recursive: true });
    await expect(f.remove(review.token)).resolves.toMatchObject({ sessionIds: [] });
    const { stdout } = await f.git("worktree", "list", "--porcelain");
    expect(stdout.match(/^worktree /gm)).toHaveLength(3);
    expect(stdout).toContain("branch refs/heads/other");
    expect(stdout).toContain("branch refs/heads/linked");
  } finally {
    await f.close();
  }
}, 60_000);

it("lists ignored local data and requires force even when Git status is clean", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, ".git", "info", "exclude"), ".env\n");
    await writeFile(join(f.path, ".env"), "fixture");
    const review = await f.review();
    expect(review).toMatchObject({
      status: "",
      ignoredEntryCount: 1,
      ignoredEntryPaths: [".env"],
    });
    await expect(f.remove(review.token)).rejects.toThrow("ignored local files");
    await writeFile(join(f.path, ".env"), "changed");
    await expect(f.remove(review.token, { force: true })).rejects.toThrow("Worktree changed");
    const current = await f.review();
    await expect(f.removeWithLease(current.token, { force: true })).resolves.toMatchObject({
      sessionIds: [],
    });
  } finally {
    await f.close();
  }
}, 60_000);

it.each([
  {
    reply: { granted: false, reason: "editors", checks: ["editors"] },
    message: "Save or close unsaved files",
  },
  {
    reply: { granted: true },
    message: "Update the desktop app to remove worktrees from this Host.",
  },
])("keeps the worktree when the lease returns $message", async ({ reply, message }) => {
  const f = await fixture();
  try {
    const { token } = await f.review();
    const beat = { clientId: "desktop", sessions: [] };
    f.live.beat(beat);
    const removal = f.remove(token);
    const refused = expect(removal).rejects.toThrow(message);
    await vi.waitFor(
      () => {
        const job = f.live.removalLeaseBeat(beat).jobs.find((entry) => entry.path);
        expect(job).toBeDefined();
        f.live.removalLeaseBeat({
          ...beat,
          removalLeaseReplies: [{ id: job!.id, release: false, ...reply }],
        });
      },
      { timeout: 10_000 },
    );
    await refused;
    expect(await worktreeListed(f)).toBe(true);
  } finally {
    await f.close();
  }
});

const branchExists = async (f: Awaited<ReturnType<typeof fixture>>, branch: string) =>
  (await f.git("branch", "--list", branch)).stdout.trim() !== "";

it("keeps the branch by default and deletes a merged branch only on request", async () => {
  const kept = await fixture();
  try {
    kept.expireHeartbeat(3 * 60_000);
    const { token } = await kept.review();
    const result = await kept.remove(token);
    expect(result).not.toHaveProperty("branchNotice");
    expect(await branchExists(kept, "linked")).toBe(true);
  } finally {
    await kept.close();
  }
  const deleted = await fixture();
  try {
    deleted.expireHeartbeat(3 * 60_000);
    const { token } = await deleted.review();
    const result = await deleted.remove(token, { deleteBranch: true });
    expect(result).not.toHaveProperty("branchNotice");
    expect(await worktreeListed(deleted)).toBe(false);
    expect(await branchExists(deleted, "linked")).toBe(false);
  } finally {
    await deleted.close();
  }
}, 60_000);

it("keeps an unmerged branch, reports it and still removes the worktree", async () => {
  const f = await fixture();
  try {
    f.expireHeartbeat(3 * 60_000);
    await writeFile(join(f.path, "work"), "unmerged");
    await hostGitExec.exec("git", ["add", "."], { cwd: f.path, timeout: 10_000 });
    await hostGitExec.exec(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=f@example.com", "commit", "-qm", "work"],
      { cwd: f.path, timeout: 10_000 },
    );
    // Publish the commit so the review allows removal, yet it stays unmerged into HEAD.
    await f.git("update-ref", "refs/remotes/origin/linked", "linked");
    const { token } = await f.review();
    const result = await f.remove(token, { deleteBranch: true });
    expect(result).toMatchObject({ branchNotice: expect.stringContaining("linked") });
    expect(await worktreeListed(f)).toBe(false);
    expect(await branchExists(f, "linked")).toBe(true);
  } finally {
    await f.close();
  }
}, 60_000);
