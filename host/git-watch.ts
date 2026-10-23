import { existsSync, statSync, watch as fsWatch } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";

// Mirrors src-tauri/src/git_watch.rs for checkouts on this host. Only `.git`
// metadata is watched (gitdir, common dir, `refs/`, the stash reflog), never
// `objects/` or the working tree. Changes bump two counters per checkout that
// `machine.changes` compares with the client's cursor.

/** Quiet time that ends a burst, such as a commit writing several files. */
const SETTLE_MS = 300;
/** A steady stream of changes still reports at least this often. */
const MAX_DELAY_MS = 1000;
/** A watch nobody has asked about for this long is dropped. */
const IDLE_MS = 60_000;
const SWEEP_MS = 10_000;
const MAX_WATCHES = 128;
/** Only watches idle this long may be evicted for a new checkout. */
const EVICTABLE_IDLE_MS = 15_000;
/** A checkout that failed to resolve or watch is not retried sooner. */
const RETRY_MS = 5000;

export type GitChange = { index: boolean; refs: boolean };

const NONE: GitChange = { index: false, refs: false };
const ALL: GitChange = { index: true, refs: true };

/** Forward slashes, no trailing slash; case-folded on Windows. */
export function normGitPath(path: string): string {
  let text = path.replace(/\\/g, "/").replace(/^\/\/\?\//, "");
  text = text.replace(/\/+$/, "");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

function relative(path: string, dir: string): string | undefined {
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : undefined;
}

/** What a change to `path` means for the checkout with these (normalized) git dirs. */
export function classifyGitPath(path: string, gitDir: string, commonDir: string): GitChange {
  if (path.slice(path.lastIndexOf("/") + 1).endsWith(".lock")) return NONE;
  let index = false;
  let refs = false;
  const name = relative(path, gitDir);
  if (name !== undefined && !name.includes("/")) {
    switch (name) {
      case "index":
        index = true;
        break;
      case "HEAD":
      case "ORIG_HEAD":
      case "MERGE_HEAD":
      case "CHERRY_PICK_HEAD":
      case "REVERT_HEAD":
      case "REBASE_HEAD":
      case "rebase-merge":
      case "rebase-apply":
        index = refs = true;
        break;
    }
  }
  const rest = relative(path, commonDir);
  // Checkpoint snapshots write and delete these on every agent turn; no
  // branch, tag or view depends on them.
  if (rest === "refs/bycoda" || rest?.startsWith("refs/bycoda/")) return { index, refs };
  if (rest !== undefined) {
    const worktreeEntry =
      rest.startsWith("worktrees/") && !rest.slice("worktrees/".length).includes("/");
    if (
      rest === "packed-refs" ||
      rest === "config" ||
      rest === "refs" ||
      rest === "worktrees" ||
      rest === "logs/refs/stash" ||
      rest.startsWith("refs/") ||
      worktreeEntry
    )
      refs = true;
  }
  return { index, refs };
}

export type GitWatchPlan = { path: string; recursive: boolean; required: boolean };

/** The paths to watch for a checkout. */
export function gitWatchPlan(gitDir: string, commonDir: string): GitWatchPlan[] {
  const plan: GitWatchPlan[] = [{ path: gitDir, recursive: false, required: true }];
  if (normGitPath(gitDir) !== normGitPath(commonDir))
    plan.push({ path: commonDir, recursive: false, required: true });
  plan.push({ path: join(commonDir, "refs"), recursive: true, required: true });
  plan.push({ path: join(commonDir, "logs", "refs"), recursive: false, required: false });
  plan.push({ path: join(commonDir, "worktrees"), recursive: false, required: false });
  return plan;
}

/** The checkout's gitdir and common dir, absolute. */
async function resolveGitDirs(cwd: string): Promise<{ gitDir: string; commonDir: string }> {
  let stdout: string;
  try {
    ({ stdout } = await exec(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      {
        cwd,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      },
    ));
  } catch {
    throw new Error(`${cwd} is not a Git checkout`);
  }
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("git rev-parse gave no directory");
  return {
    gitDir: resolvePath(cwd, lines[0]),
    commonDir: resolvePath(cwd, lines[1]),
  };
}

export type GitWatchHandle = { close(): void };
/** Starts watching `path`; `onEvent` gets the changed path (absent: unknown). */
export type GitWatchFactory = (
  path: string,
  recursive: boolean,
  onEvent: (eventType: string, changed: string | undefined) => void,
  onError: () => void,
) => GitWatchHandle;

const nodeWatch: GitWatchFactory = (path, recursive, onEvent, onError) => {
  const watcher = fsWatch(path, { recursive, persistent: false }, (type, name) =>
    onEvent(type, name ? join(path, name.toString()) : undefined),
  );
  watcher.on("error", onError);
  return watcher;
};

export type GitWatchOptions = {
  onChange?: () => void;
  watch?: GitWatchFactory;
  resolve?: (cwd: string) => Promise<{ gitDir: string; commonDir: string }>;
  now?: () => number;
  exists?: (path: string) => boolean;
};

type Entry = {
  cwd: string;
  state: "resolving" | "ready" | "failed";
  /** Resolves once `state` is no longer "resolving". */
  ready: Promise<void>;
  touchedAt: number;
  failedAt: number;
  indexRev: number;
  refsRev: number;
  gitDir: string;
  commonDir: string;
  watchers: GitWatchHandle[];
  /** Optional folders that did not exist yet (no stash, no worktrees). */
  missing: GitWatchPlan[];
  pending: GitChange | null;
  firstAt: number;
  timer: NodeJS.Timeout | undefined;
};

export class GitWatches {
  private readonly entries = new Map<string, Entry>();
  private sweeper: NodeJS.Timeout | undefined;
  private closed = false;
  /** New watches count up from above every dropped one, so an old cursor never matches. */
  private floor = 0;
  private readonly watchPath: GitWatchFactory;
  private readonly resolveDirs: NonNullable<GitWatchOptions["resolve"]>;
  private readonly now: () => number;
  private readonly exists: (path: string) => boolean;

  constructor(private readonly options: GitWatchOptions = {}) {
    this.watchPath = options.watch ?? nodeWatch;
    this.resolveDirs = options.resolve ?? resolveGitDirs;
    this.now = options.now ?? Date.now;
    this.exists = options.exists ?? existsSync;
  }

  /** Starts watching `cwd`, or keeps its watch alive. */
  touch(cwd: string): void {
    if (this.closed) return;
    const now = this.now();
    let entry = this.entries.get(cwd);
    if (entry) {
      entry.touchedAt = now;
      if (entry.state === "failed" && now - entry.failedAt >= RETRY_MS) this.start(entry);
      return;
    }
    if (this.entries.size >= MAX_WATCHES && !this.evictOne(now)) return;
    entry = {
      cwd,
      state: "resolving",
      ready: Promise.resolve(),
      touchedAt: now,
      failedAt: 0,
      indexRev: this.floor,
      refsRev: this.floor,
      gitDir: "",
      commonDir: "",
      watchers: [],
      missing: [],
      pending: null,
      firstAt: 0,
      timer: undefined,
    };
    this.entries.set(cwd, entry);
    this.start(entry);
    this.sweeper ??= setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  /** `touch`, then waits until the checkout is resolved and its watches are set. */
  async read(cwd: string): Promise<{ etag: string; watching: boolean }> {
    this.touch(cwd);
    await this.entries.get(cwd)?.ready;
    return { etag: this.etag(cwd), watching: this.watching(cwd) };
  }

  /** "<indexRev>.<refsRev>"; empty when `cwd` is not tracked. */
  etag(cwd: string): string {
    const entry = this.entries.get(cwd);
    return entry ? `${entry.indexRev}.${entry.refsRev}` : "";
  }

  /** True once the checkout is fully watched. */
  watching(cwd: string): boolean {
    return this.entries.get(cwd)?.state === "ready";
  }

  /** Number of tracked checkouts, for tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  close(): void {
    this.closed = true;
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    for (const entry of [...this.entries.values()]) this.drop(entry);
  }

  private start(entry: Entry) {
    entry.state = "resolving";
    entry.ready = this.resolveDirs(entry.cwd).then(
      ({ gitDir, commonDir }) => {
        if (this.entries.get(entry.cwd) !== entry) return;
        entry.gitDir = normGitPath(gitDir);
        entry.commonDir = normGitPath(commonDir);
        this.closeWatchers(entry);
        entry.missing = [];
        for (const plan of gitWatchPlan(gitDir, commonDir)) {
          try {
            entry.watchers.push(this.open(entry, plan));
          } catch {
            // Watched once git creates it.
            if (!plan.required && !this.exists(plan.path)) {
              entry.missing.push(plan);
              continue;
            }
            // A partial watch would look complete while missing changes, so
            // the client keeps its own refresh triggers instead.
            this.fail(entry);
            return;
          }
        }
        entry.state = "ready";
      },
      () => {
        if (this.entries.get(entry.cwd) === entry) this.fail(entry);
      },
    );
  }

  private open(entry: Entry, plan: GitWatchPlan): GitWatchHandle {
    return this.watchPath(
      plan.path,
      plan.recursive,
      (type, changed) => this.onEvent(entry, type, changed),
      () => this.onError(entry),
    );
  }

  private fail(entry: Entry) {
    this.options.onChange?.();
    this.closeWatchers(entry);
    entry.state = "failed";
    entry.failedAt = this.now();
  }

  private closeWatchers(entry: Entry) {
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch {
        // Already gone.
      }
    }
    entry.watchers = [];
  }

  private drop(entry: Entry) {
    clearTimeout(entry.timer);
    this.closeWatchers(entry);
    this.floor = Math.max(this.floor, entry.indexRev + 1, entry.refsRev + 1);
    this.entries.delete(entry.cwd);
  }

  private onEvent(entry: Entry, type: string, changed: string | undefined) {
    if (entry.state !== "ready") return;
    let change: GitChange;
    if (changed === undefined) change = ALL;
    else {
      // Reading a folder can update its access time, which is reported as a
      // change to the folder itself; a real ref change also reports the file.
      if (type === "change" && isDirectory(changed)) return;
      change = classifyGitPath(normGitPath(changed), entry.gitDir, entry.commonDir);
    }
    if (change.index || change.refs) this.queue(entry, change);
  }

  /** The OS dropped events or the watch broke: anything may have changed. */
  private onError(entry: Entry) {
    if (this.entries.get(entry.cwd) !== entry || entry.state !== "ready") return;
    this.closeWatchers(entry);
    entry.state = "failed";
    // No wait before the next touch re-resolves it.
    entry.failedAt = Number.NEGATIVE_INFINITY;
    this.bump(entry, ALL);
  }

  private queue(entry: Entry, change: GitChange) {
    const now = this.now();
    if (!entry.pending) {
      entry.pending = { index: false, refs: false };
      entry.firstAt = now;
    }
    entry.pending.index ||= change.index;
    entry.pending.refs ||= change.refs;
    clearTimeout(entry.timer);
    const delay = Math.max(0, Math.min(SETTLE_MS, MAX_DELAY_MS - (now - entry.firstAt)));
    entry.timer = setTimeout(() => this.flush(entry), delay);
    entry.timer.unref();
  }

  private flush(entry: Entry) {
    const change = entry.pending;
    entry.pending = null;
    entry.timer = undefined;
    if (!change || this.entries.get(entry.cwd) !== entry) return;
    // A removed linked worktree: resolve again on the next touch.
    if (entry.state === "ready" && !this.exists(entry.gitDir)) {
      this.closeWatchers(entry);
      entry.state = "failed";
      entry.failedAt = Number.NEGATIVE_INFINITY;
      change.index = change.refs = true;
    }
    this.adoptCreated(entry);
    this.bump(entry, change);
  }

  private bump(entry: Entry, change: GitChange) {
    if (change.index) entry.indexRev++;
    if (change.refs) entry.refsRev++;
    this.options.onChange?.();
  }

  /** Starts watching optional folders that git has created since. */
  private adoptCreated(entry: Entry) {
    if (entry.state !== "ready" || !entry.missing.length) return;
    const still: GitWatchPlan[] = [];
    for (const plan of entry.missing) {
      if (!this.exists(plan.path)) {
        still.push(plan);
        continue;
      }
      try {
        entry.watchers.push(this.open(entry, plan));
      } catch {
        still.push(plan);
      }
    }
    entry.missing = still;
  }

  /** Drops the least recently used watch that has been idle a while. */
  private evictOne(now: number): boolean {
    let oldest: Entry | undefined;
    for (const entry of this.entries.values()) {
      if (now - entry.touchedAt < EVICTABLE_IDLE_MS) continue;
      if (!oldest || entry.touchedAt < oldest.touchedAt) oldest = entry;
    }
    if (!oldest) return false;
    this.drop(oldest);
    return true;
  }

  private sweep() {
    const now = this.now();
    for (const entry of [...this.entries.values()])
      if (now - entry.touchedAt >= IDLE_MS) this.drop(entry);
    if (!this.entries.size && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = undefined;
    }
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
