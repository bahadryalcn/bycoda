import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyGitPath, GitWatches, normGitPath, type GitWatchFactory } from "./git-watch";

// Idle-cost contracts for the host's `.git` watcher: what must not wake the
// client's checkout refresh, and that idle watches release their resources.

const GIT = "/r/.git";
const any = (path: string, gitDir = GIT, commonDir = GIT) => {
  const c = classifyGitPath(path, gitDir, commonDir);
  return c.index || c.refs;
};

describe("git watch classification (perf)", () => {
  it("ignores noise git writes without any user-visible change", () => {
    for (const path of [
      "/r/.git/index.lock",
      "/r/.git/HEAD.lock",
      "/r/.git/refs/heads/main.lock",
      "/r/.git/packed-refs.lock",
      "/r/.git/shallow.lock",
      "/r/.git/FETCH_HEAD",
      "/r/.git/gc.log",
      "/r/.git/gc.pid",
      "/r/.git/objects",
      "/r/.git/objects/pack/pack-1.pack",
      "/r/.git/objects/ab/cdef",
      "/r/.git/objects/info/commit-graph",
    ])
      expect(any(path), path).toBe(false);
    // Linked worktree: the same noise under its own git dir.
    const tree = "/r/.git/worktrees/w";
    for (const path of [`${tree}/index.lock`, `${tree}/FETCH_HEAD`, `${tree}/gc.log`])
      expect(any(path, tree), path).toBe(false);
  });

  // perf P8: classify must ignore refs/bycoda/** (checkpoint refs written twice per turn); remove .fails when fixed.
  it.fails("does not treat checkpoint refs as a branch or ref change", () => {
    // Precondition: ordinary refs still count.
    expect(any("/r/.git/refs/heads/main")).toBe(true);
    expect(any("/r/.git/refs/tags/v1")).toBe(true);
    for (const path of [
      "/r/.git/refs/bycoda",
      "/r/.git/refs/bycoda/checkpoints",
      "/r/.git/refs/bycoda/checkpoints/session-1",
      "/r/.git/refs/bycoda/checkpoints/session-1/turn-1/before",
      "/r/.git/refs/bycoda/checkpoints/session-1/turn-1/after",
    ])
      expect(any(path), path).toBe(false);
    // Same through a linked worktree, whose refs live in the common dir.
    expect(any("/r/.git/refs/bycoda/checkpoints/s/t/after", "/r/.git/worktrees/w", "/r/.git")).toBe(
      false,
    );
  });
});

describe("GitWatches idle behavior (perf)", () => {
  type Fake = { path: string; closed: boolean; emit: (type: string, name?: string) => void };
  let fakes: Fake[];
  let watches: GitWatches;
  const watchFactory: GitWatchFactory = (path, _recursive, onEvent) => {
    const fake: Fake = {
      path,
      closed: false,
      emit: (type, name) => onEvent(type, name === undefined ? undefined : join(path, name)),
    };
    fakes.push(fake);
    return { close: () => void (fake.closed = true) };
  };
  const at = (path: string) =>
    fakes.find((f) => normGitPath(f.path) === normGitPath(path) && !f.closed)!;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = [];
    watches = new GitWatches({
      watch: watchFactory,
      resolve: async () => ({ gitDir: "/r/.git", commonDir: "/r/.git" }),
      exists: (path) => normGitPath(path).startsWith("/r/") || existsSync(path),
    });
  });
  afterEach(() => {
    watches.close();
    vi.useRealTimers();
  });

  it("does not bump the etag for lock, FETCH_HEAD, gc.log or object writes", async () => {
    await watches.read("/r");
    const main = at("/r/.git");
    for (const name of ["index.lock", "HEAD.lock", "FETCH_HEAD", "gc.log", "objects"])
      main.emit("rename", name);
    at("/r/.git/refs").emit("rename", "heads/main.lock");
    await vi.advanceTimersByTimeAsync(5000);
    expect(watches.etag("/r")).toBe("0.0");
  });

  it("releases every OS watcher and its timers once nobody asks for a checkout", async () => {
    await watches.read("/r");
    expect(fakes.some((f) => !f.closed)).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(watches.size).toBe(0);
    expect(fakes.every((f) => f.closed)).toBe(true);
    // No sweeper or settle timer is left to wake an idle host.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a checkout watched only while the client keeps asking", async () => {
    await watches.read("/r");
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      watches.touch("/r");
    }
    expect(watches.watching("/r")).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(watches.watching("/r")).toBe(false);
  });
});

describe("GitWatches checkpoint refs on a real repository (perf)", () => {
  let base: string;
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
  const revs = (watches: GitWatches) =>
    watches.etag(repo).split(".").map(Number) as [number, number];

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "git-watch-perf-")));
    repo = join(base, "repo");
    mkdirSync(repo);
    git("init", "-q");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "init");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  // perf P8: writing refs/bycoda/checkpoints/** must not bump the refs revision; remove .fails when fixed.
  it.fails("does not report a refs change when a checkpoint ref is written", async () => {
    const watches = new GitWatches();
    try {
      expect((await watches.read(repo)).watching).toBe(true);
      // Precondition: the watcher does see a real branch.
      const start = revs(watches);
      git("branch", "feature");
      await settle();
      const afterBranch = revs(watches);
      expect(afterBranch[1]).toBeGreaterThan(start[1]);

      const tree = git("rev-parse", "HEAD^{tree}").trim();
      git("update-ref", "refs/bycoda/checkpoints/session-1/turn-1/before", tree);
      git("update-ref", "refs/bycoda/checkpoints/session-1/turn-1/after", tree);
      await settle();
      expect(revs(watches)).toEqual(afterBranch);
    } finally {
      watches.close();
    }
  });
});
