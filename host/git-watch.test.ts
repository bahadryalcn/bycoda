import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyGitPath,
  GitWatches,
  gitWatchPlan,
  normGitPath,
  type GitWatchFactory,
} from "./git-watch";

const GIT = "/r/.git";
const change = (index: boolean, refs: boolean) => ({ index, refs });
const any = (path: string, gitDir = GIT, commonDir = GIT) => {
  const c = classifyGitPath(path, gitDir, commonDir);
  return c.index || c.refs;
};

describe("classifyGitPath", () => {
  it("classifies checkout files", () => {
    expect(classifyGitPath("/r/.git/index", GIT, GIT)).toEqual(change(true, false));
    expect(classifyGitPath("/r/.git/HEAD", GIT, GIT)).toEqual(change(true, true));
    expect(classifyGitPath("/r/.git/rebase-merge", GIT, GIT)).toEqual(change(true, true));
    expect(classifyGitPath("/r/.git/refs/heads/main", GIT, GIT)).toEqual(change(false, true));
    expect(classifyGitPath("/r/.git/refs/stash", GIT, GIT)).toEqual(change(false, true));
    expect(classifyGitPath("/r/.git/logs/refs/stash", GIT, GIT)).toEqual(change(false, true));
    expect(classifyGitPath("/r/.git/packed-refs", GIT, GIT)).toEqual(change(false, true));
  });

  it("ignores locks, objects and fetch head", () => {
    for (const path of [
      "/r/.git/index.lock",
      "/r/.git/packed-refs.lock",
      "/r/.git/refs/heads/main.lock",
      "/r/.git/objects/ab/cdef",
      "/r/.git/FETCH_HEAD",
      "/r/.git/logs/HEAD",
      "/r/src/main.rs",
      "/other/.git/HEAD",
    ])
      expect(any(path), path).toBe(false);
  });

  it("separates a linked worktree from its repository", () => {
    const tree = "/r/.git/worktrees/feature";
    expect(classifyGitPath("/r/.git/worktrees/feature/HEAD", tree, GIT)).toEqual(
      change(true, true),
    );
    expect(any("/r/.git/HEAD", tree, GIT)).toBe(false);
    expect(any("/r/.git/index", tree, GIT)).toBe(false);
    expect(classifyGitPath("/r/.git/refs/heads/feature", tree, GIT).refs).toBe(true);
    expect(any("/r/.git/worktrees/feature/HEAD", GIT, GIT)).toBe(false);
    expect(classifyGitPath("/r/.git/worktrees/feature", GIT, GIT).refs).toBe(true);
  });

  it("normalizes separators and verbatim prefixes", () => {
    const expected = process.platform === "win32" ? "c:/repo/.git" : "C:/repo/.git";
    expect(normGitPath("\\\\?\\C:\\repo\\.git\\")).toBe(expected);
  });

  it("plans required and optional paths", () => {
    const same = gitWatchPlan("/r/.git", "/r/.git");
    expect(same.map((p) => p.required)).toEqual([true, true, false, false]);
    const linked = gitWatchPlan("/r/.git/worktrees/w", "/r/.git");
    expect(linked.map((p) => p.required)).toEqual([true, true, true, false, false]);
    expect(linked[2].recursive).toBe(true);
  });
});

describe("GitWatches with injected watchers", () => {
  type Fake = {
    path: string;
    recursive: boolean;
    closed: boolean;
    emit: (type: string, name?: string) => void;
    fail: () => void;
  };
  let fakes: Fake[];
  let failPaths: Set<string>;
  let watches: GitWatches;
  const watchFactory: GitWatchFactory = (path, recursive, onEvent, onError) => {
    if (failPaths.has(join(path))) throw new Error("ENOENT");
    const fake: Fake = {
      path,
      recursive,
      closed: false,
      emit: (type, name) => onEvent(type, name === undefined ? undefined : join(path, name)),
      fail: onError,
    };
    fakes.push(fake);
    return { close: () => void (fake.closed = true) };
  };
  const resolve = async (cwd: string) => {
    if (cwd.includes("nogit")) throw new Error("not a checkout");
    return { gitDir: "/r/.git", commonDir: "/r/.git" };
  };
  const normalize = normGitPath;
  const at = (path: string) =>
    fakes.find((f) => normalize(f.path) === normalize(path) && !f.closed)!;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = [];
    failPaths = new Set();
    // The fake git dirs do not exist on disk.
    watches = new GitWatches({
      watch: watchFactory,
      resolve,
      exists: (path) => normalize(path).startsWith("/r/") || existsSync(path),
    });
  });
  afterEach(() => {
    watches.close();
    vi.useRealTimers();
  });

  it("watches the planned paths and starts from 0.0", async () => {
    expect(await watches.read("/r")).toEqual({ etag: "0.0", watching: true });
    expect(fakes.map((f) => [normalize(f.path), f.recursive])).toEqual([
      [normalize("/r/.git"), false],
      [normalize("/r/.git/refs"), true],
      [normalize("/r/.git/logs/refs"), false],
      [normalize("/r/.git/worktrees"), false],
    ]);
  });

  it("coalesces a burst into one bump after 300 ms of quiet", async () => {
    await watches.read("/r");
    at("/r/.git").emit("change", "index");
    at("/r/.git/refs").emit("rename", "heads/main");
    await vi.advanceTimersByTimeAsync(299);
    expect(watches.etag("/r")).toBe("0.0");
    await vi.advanceTimersByTimeAsync(2);
    expect(watches.etag("/r")).toBe("1.1");
  });

  it("reports a steady stream at least once a second", async () => {
    await watches.read("/r");
    const main = at("/r/.git");
    for (let i = 0; i < 12; i++) {
      main.emit("change", "index");
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(watches.etag("/r")).not.toBe("0.0");
  });

  it("ignores locks, objects and unrelated names", async () => {
    await watches.read("/r");
    const main = at("/r/.git");
    main.emit("change", "index.lock");
    main.emit("change", "FETCH_HEAD");
    main.emit("change", "objects");
    at("/r/.git/refs").emit("change", "heads/main.lock");
    await vi.advanceTimersByTimeAsync(2000);
    expect(watches.etag("/r")).toBe("0.0");
  });

  it("counts an unnamed event or a watcher error as everything changed", async () => {
    await watches.read("/r");
    at("/r/.git").emit("rename");
    await vi.advanceTimersByTimeAsync(400);
    expect(watches.etag("/r")).toBe("1.1");
    at("/r/.git").fail();
    expect(watches.etag("/r")).toBe("2.2");
    expect(watches.watching("/r")).toBe(false);
    // The next touch resolves it again and keeps the counters.
    expect(await watches.read("/r")).toEqual({ etag: "2.2", watching: true });
  });

  it("adopts optional folders once they exist, and tolerates missing ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "git-watch-adopt-"));
    try {
      const gitDir = join(dir, ".git");
      mkdirSync(join(gitDir, "refs"), { recursive: true });
      mkdirSync(join(gitDir, "logs", "refs"), { recursive: true });
      const local = new GitWatches({
        watch: (path, recursive, onEvent, onError) => {
          if (path.endsWith("worktrees") && !mkdirExists(path)) throw new Error("ENOENT");
          return watchFactory(path, recursive, onEvent, onError);
        },
        resolve: async () => ({ gitDir, commonDir: gitDir }),
      });
      expect((await local.read("c")).watching).toBe(true);
      expect(fakes.some((f) => f.path.endsWith("worktrees"))).toBe(false);
      mkdirSync(join(gitDir, "worktrees"));
      fakes.find((f) => f.path === gitDir)!.emit("rename", "worktrees");
      await vi.advanceTimersByTimeAsync(400);
      expect(local.etag("c")).toBe("0.1");
      expect(fakes.some((f) => f.path.endsWith("worktrees"))).toBe(true);
      local.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports watching false when a required path fails, and retries later", async () => {
    failPaths.add(join("/r/.git/refs"));
    expect(await watches.read("/r")).toEqual({ etag: "0.0", watching: false });
    expect(fakes.every((f) => f.closed)).toBe(true);
    failPaths.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await watches.read("/r")).watching).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await watches.read("/r")).watching).toBe(true);
  });

  it("reports watching false for a directory that is not a checkout", async () => {
    expect(await watches.read("/nogit")).toEqual({ etag: "0.0", watching: false });
  });

  it("drops a watch 60 s after the last touch and keeps touched ones", async () => {
    await watches.read("/r");
    await watches.read("/other");
    await vi.advanceTimersByTimeAsync(40_000);
    watches.touch("/r");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(watches.watching("/r")).toBe(true);
    expect(watches.etag("/other")).toBe("");
    expect(watches.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(watches.size).toBe(0);
    expect(fakes.every((f) => f.closed)).toBe(true);
  });

  it("never lets a new watch reuse the etag of an expired one", async () => {
    await watches.read("/r");
    at("/r/.git").emit("rename");
    await vi.advanceTimersByTimeAsync(400);
    expect(watches.etag("/r")).toBe("1.1");
    await vi.advanceTimersByTimeAsync(70_000);
    expect((await watches.read("/r")).etag).toBe("2.2");
  });

  it("caps watches at 128, evicting only idle ones", async () => {
    for (let i = 0; i < 128; i++) watches.touch(`/c${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(watches.size).toBe(128);
    expect(await watches.read("/over")).toEqual({ etag: "", watching: false });
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await watches.read("/over")).watching).toBe(true);
    expect(watches.size).toBe(128);
    expect(watches.etag("/c0")).toBe("");
  });

  it("close stops everything", async () => {
    await watches.read("/r");
    watches.close();
    expect(fakes.every((f) => f.closed)).toBe(true);
    expect(await watches.read("/r")).toEqual({ etag: "", watching: false });
  });
});

function mkdirExists(path: string): boolean {
  try {
    execFileSync(process.execPath, ["-e", "require('fs').statSync(process.argv[1])", path], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("GitWatches on a real repository", () => {
  let base: string;
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        // As the host runs its own reads.
        GIT_OPTIONAL_LOCKS: "0",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
  const revs = (watches: GitWatches, cwd = repo) =>
    watches.etag(cwd).split(".").map(Number) as [number, number];

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "git-watch-real-")));
    repo = join(base, "repo");
    mkdirSync(repo);
    git("init", "-q");
    writeFileSync(join(repo, "a.txt"), "one\n");
    git("add", "a.txt");
    git("commit", "-q", "-m", "init");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("bumps for writes and not for the app's own reads", async () => {
    const watches = new GitWatches();
    try {
      expect((await watches.read(repo)).watching).toBe(true);
      // A stale stat cache: a read that refreshed it would rewrite the index
      // (`git diff` does even with GIT_OPTIONAL_LOCKS=0, so it is not used here).
      await settle(1100);
      writeFileSync(join(repo, "a.txt"), "two\n");
      writeFileSync(join(repo, "a.txt"), "one\n");
      await settle();
      const quiet = revs(watches);
      git("status");
      git("log", "--oneline");
      git("stash", "list");
      git("for-each-ref");
      git("branch", "--list");
      await settle();
      expect(revs(watches)).toEqual(quiet);

      const [index, refs] = quiet;
      writeFileSync(join(repo, "b.txt"), "b\n");
      git("add", "b.txt");
      await settle();
      expect(revs(watches)[0]).toBeGreaterThan(index);
      expect(revs(watches)[1]).toBe(refs);

      git("commit", "-q", "-m", "second");
      await settle();
      expect(revs(watches)[1]).toBeGreaterThan(refs);
    } finally {
      watches.close();
    }
  });

  it("sees a new branch and watches a linked worktree", async () => {
    const watches = new GitWatches();
    try {
      await watches.read(repo);
      const before = revs(watches);
      git("branch", "feature");
      await settle();
      expect(revs(watches)[1]).toBeGreaterThan(before[1]);
      const tree = join(base, "tree");
      git("worktree", "add", "-q", tree);
      expect((await watches.read(tree)).watching).toBe(true);
      await settle();
      const mid = revs(watches, tree);
      await settle();
      expect(revs(watches, tree)).toEqual(mid);
    } finally {
      watches.close();
    }
  });

  it("is not watching a folder outside any checkout", async () => {
    const watches = new GitWatches();
    try {
      expect((await watches.read(base)).watching).toBe(false);
    } finally {
      watches.close();
    }
  });
});
