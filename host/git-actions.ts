import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import {
  gitMutationScope,
  isHostGitMutation,
  isManagedWorkspaceBranch,
  MANAGED_DELIVERY_REVIEW_REQUIRED,
  withHostGitMutation,
} from "./git-mutations";
import { relative, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  hostConflictStages,
  hostConflictStageSet,
  hostOperationState,
  hostUnmerged,
  unmergedMessage,
} from "./git-conflicts";
import { hostGitAction, invalidateHostGitIndex, safeGitPath } from "./workspace";

/** Source-control commands beyond staging and committing: branches, tags,
 * remotes, stashes, history rewriting, conflicts, blame. They take the same
 * names, arguments and results as this app's Tauri commands (see the
 * `git_*_for` functions in src-tauri/src/fs.rs, which are the reference for
 * git invocations and input validation). Advertised as `git.actions`. */
export const GIT_ACTION_COMMANDS = [
  "git_management_snapshot",
  "git_trust_repository",
  "git_stash",
  "git_stash_list",
  "git_stash_action",
  "git_stash_clear",
  "git_checkout_commit",
  "git_create_branch_at",
  "git_create_branch_from",
  "git_create_tag",
  "git_tags",
  "git_delete_tag",
  "git_cherry_pick",
  "git_revert",
  "git_reset",
  "git_undo_last_commit",
  "git_operation_state",
  "git_operation_abort",
  "git_operation_continue",
  "git_operation_status",
  "git_delete_branch",
  "git_rename_branch",
  "git_delete_remote_branch",
  "git_merge",
  "git_rebase",
  "git_fetch",
  "git_remotes",
  "git_remote_add",
  "git_remote_remove",
  "git_conflicts",
  "git_resolve_conflict",
  "git_conflict_stages",
  "git_file_history",
  "git_blame",
  "git_commit_message",
] as const;
export type GitActionCommand = (typeof GIT_ACTION_COMMANDS)[number];

/** Commands that move HEAD or rewrite the working tree under a running agent;
 * like a branch switch, they wait until the project's sessions are idle. */
export const GIT_ACTIONS_NEEDING_IDLE: ReadonlySet<string> = new Set<GitActionCommand>([
  "git_stash",
  "git_stash_action",
  "git_resolve_conflict",
  "git_checkout_commit",
  "git_create_branch_at",
  "git_create_branch_from",
  "git_cherry_pick",
  "git_revert",
  "git_reset",
  "git_undo_last_commit",
  "git_merge",
  "git_rebase",
  "git_operation_abort",
  "git_operation_continue",
]);

const QUICK_MS = 30_000;
// Fetching or deleting on a remote crosses the network.
const NETWORK_MS = 120_000;
const HISTORY_DEFAULT = 200;
const HISTORY_MAX = 5000;
const MAX_BLAME_LINES = 50_000;

/** Runs git, failing with its own message (stderr, else stdout), as the local
 * commands do. Never prompts and never opens a pager or editor. */
async function git(
  root: string,
  args: string[],
  {
    timeout = [
      "stash",
      "checkout",
      "branch",
      "tag",
      "reset",
      "revert",
      "cherry-pick",
      "merge",
      "rebase",
      "commit",
      "rm",
      "add",
    ].includes(args[0] === "-c" ? args[2] : args[0])
      ? NETWORK_MS
      : QUICK_MS,
    maxBuffer = 8 * 1024 * 1024,
  } = {},
): Promise<string> {
  try {
    return (
      await exec(
        "git",
        [...(args.includes("--") ? ["--literal-pathspecs"] : []), "--no-pager", ...args],
        {
          cwd: root,
          timeout,
          maxBuffer,
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            LC_ALL: "C",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
      )
    ).stdout;
  } catch (reason) {
    const failure = reason as { stderr?: string; stdout?: string; killed?: boolean };
    if (failure.killed) throw new Error(`git ${args[0]} timed out`);
    throw new Error(failure.stderr?.trim() || failure.stdout?.trim() || `git ${args[0]} failed`);
  }
}

const gitOrNull = (root: string, args: string[]) =>
  git(root, args).then(
    (out) => out.trim() || null,
    () => null,
  );

async function ensureWorkTree(root: string): Promise<void> {
  if ((await gitOrNull(root, ["rev-parse", "--is-inside-work-tree"])) !== "true")
    throw new Error("Not a git repository");
}

const refExists = (root: string, spec: string) =>
  git(root, ["show-ref", "--verify", "--quiet", spec]).then(
    () => true,
    () => false,
  );

const text = (value: unknown, what: string, max = 4096): string => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${what}`);
  return value.trim();
};

/** A commit id from the UI: hex only, so it can never be read as an option,
 * and resolved to a commit that exists. */
async function commitArg(root: string, input: unknown): Promise<string> {
  const sha = text(input, "commit", 64);
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) throw new Error("Invalid commit");
  const resolved = await gitOrNull(root, ["rev-parse", "--verify", `${sha}^{commit}`]);
  if (!resolved || !/^[0-9a-f]{40,64}$/i.test(resolved)) throw new Error("Unknown commit");
  return resolved;
}

/** A branch name git accepts, exactly as typed: no option, no `@{-1}` style
 * expansion. */
async function branchName(root: string, input: unknown): Promise<string> {
  const name = text(input, "branch name", 255);
  if (!name) throw new Error("Branch name cannot be empty");
  const normalized = name.startsWith("-")
    ? null
    : await gitOrNull(root, ["check-ref-format", "--branch", name]);
  if (normalized !== name) throw new Error(`'${name}' is not a valid branch name`);
  return name;
}

/** A local or remote branch to merge, rebase onto, or branch from. */
async function branchRef(root: string, input: unknown): Promise<string> {
  const reference = text(input, "branch", 255);
  if (!reference || reference.startsWith("-")) throw new Error("Invalid branch");
  for (const prefix of ["refs/heads/", "refs/remotes/"]) {
    const qualified = `${prefix}${reference}`;
    if (await refExists(root, qualified)) return qualified;
  }
  throw new Error(`Branch ${reference} does not exist`);
}

async function tagName(root: string, input: unknown): Promise<string> {
  const name = text(input, "tag name", 255);
  if (!name) throw new Error("Tag name cannot be empty");
  if (
    name.startsWith("-") ||
    !(await git(root, ["check-ref-format", `refs/tags/${name}`]).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(`${name} is not a valid tag name`);
  return name;
}

const remoteNames = async (root: string) =>
  (await gitOrNull(root, ["remote"]))
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean) ?? [];

async function newRemoteName(root: string, input: unknown): Promise<string> {
  const name = text(input, "remote name", 255);
  if (!name) throw new Error("Remote name cannot be empty");
  if (
    name.startsWith("-") ||
    /[\s\p{Cc}]/u.test(name) ||
    !(await git(root, ["check-ref-format", `refs/remotes/${name}`]).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(`${name} is not a valid remote name`);
  return name;
}

async function knownRemote(root: string, input: unknown): Promise<string> {
  const name = text(input, "remote name", 255);
  if (name.startsWith("-") || !(await remoteNames(root)).includes(name))
    throw new Error(`Remote ${name} does not exist`);
  return name;
}

/** A file path inside the project, relative to its root with `/` separators. */
async function repoPath(root: string, input: unknown): Promise<string> {
  return relative(root, await safeGitPath(root, input))
    .split(sep)
    .join("/");
}

/** A checkout blocked by local changes gets the same advice as locally. */
async function switching(root: string, args: string[]): Promise<void> {
  try {
    await git(root, args);
  } catch (reason) {
    const message = (reason as Error).message;
    if (
      /would be overwritten|commit your changes or stash|please move or remove them before/i.test(
        message,
      )
    )
      throw new Error("Your local changes would be overwritten. Commit or stash them first.");
    throw reason;
  }
}

export type HostHistoryCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: { name: string; kind: string }[];
  head: boolean;
};

/** Format for `git log` records that `parseHistoryLog` reads. */
export const HISTORY_FORMAT = "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%s%x1e";
export const HISTORY_REFS_FORMAT =
  "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(symref)";

export function parseHistoryLog(
  output: string,
  headSha: string | null,
  refsBySha: ReadonlyMap<string, HostHistoryCommit["refs"]>,
): HostHistoryCommit[] {
  return output.split("\x1e").flatMap((record) => {
    const [sha, shortSha, parents, author, timestamp, subject] = record.trim().split("\0");
    if (!sha || !/^[0-9a-f]{40,64}$/i.test(sha)) return [];
    return [
      {
        sha,
        shortSha: shortSha || sha.slice(0, 7),
        parents: parents ? parents.split(" ") : [],
        author,
        timestamp: Number(timestamp),
        subject,
        refs: refsBySha.get(sha) ?? [],
        head: sha === headSha,
      },
    ];
  });
}

/** Structured refs avoid ambiguous decoration delimiters and work on older Git. */
export function parseHistoryRefs(output: string): Map<string, HostHistoryCommit["refs"]> {
  const result = new Map<string, HostHistoryCommit["refs"]>();
  for (const line of output.split("\n")) {
    const [object, peeled, ref, symbolic] = line.replace(/\r$/, "").split("\0");
    if (!ref || (symbolic && ref.startsWith("refs/remotes/") && ref.endsWith("/HEAD"))) continue;
    const prefix = ref.startsWith("refs/heads/")
      ? "refs/heads/"
      : ref.startsWith("refs/tags/")
        ? "refs/tags/"
        : ref.startsWith("refs/remotes/")
          ? "refs/remotes/"
          : null;
    if (!prefix) continue;
    const sha = peeled || object;
    const refs = result.get(sha) ?? [];
    refs.push({
      name: ref.slice(prefix.length),
      kind: prefix === "refs/heads/" ? "local" : prefix === "refs/tags/" ? "tag" : "remote",
    });
    result.set(sha, refs);
  }
  return result;
}

const operationState = hostOperationState;

async function conflicts(root: string): Promise<string[]> {
  const out = await gitOrNull(root, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-only",
    "--relative",
    "--diff-filter=U",
  ]);
  return (
    out
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

function parseBlame(output: string) {
  const lines: {
    line: number;
    sha: string;
    shortSha: string;
    author: string;
    timestamp: number;
    summary: string;
  }[] = [];
  let current: (typeof lines)[number] | undefined;
  for (const line of output.split("\n")) {
    // The source line itself, tab-prefixed, closes each record.
    if (line.startsWith("\t")) {
      if (current) lines.push(current);
      current = undefined;
      continue;
    }
    if (current) {
      if (line.startsWith("author ")) current.author = line.slice(7);
      else if (line.startsWith("author-time ")) current.timestamp = Number(line.slice(12)) || 0;
      else if (line.startsWith("summary ")) current.summary = line.slice(8);
      continue;
    }
    const [sha, , number] = line.split(" ");
    if (sha && number)
      current = {
        line: Number(number) || 0,
        sha,
        shortSha: sha.slice(0, 7),
        author: "",
        timestamp: 0,
        summary: "",
      };
  }
  return lines;
}

function stashMessage(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input !== "string" || input.length > 1000) throw new Error("Invalid stash message");
  return input.trim() || undefined;
}

function stashIndex(input: unknown): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0 || (input as number) > 100_000)
    throw new Error("Invalid stash");
  return input as number;
}

function historyLimit(input: unknown): string {
  const count = Number.isSafeInteger(input) ? (input as number) : HISTORY_DEFAULT;
  return String(Math.min(HISTORY_MAX, Math.max(1, count)));
}

/** Current branch per folder for the polled session list: one `git` spawn per
 * folder per TTL, shared by concurrent callers. */
export class BranchCache {
  private entries = new Map<string, { promise: Promise<string>; settledAt?: number }>();
  private aliases = new Map<
    string,
    {
      key: string;
      entry: { promise: Promise<string>; settledAt?: number };
    }
  >();
  private resolving = new Map<string, { version: number; promise: Promise<string> }>();

  constructor(
    private readonly lookup: (cwd: string) => Promise<string>,
    private readonly ttlMs = 4_000,
    private readonly maxEntries = 256,
    private readonly now: () => number = Date.now,
  ) {}

  get(cwd: string): Promise<string> {
    // A binding belongs to a specific lookup, not just a canonical string: a
    // refreshed entry for real A must not refresh an alias that now points at B.
    const input = this.pathKey(cwd);
    const binding = this.aliases.get(input);
    const found = binding?.entry;
    if (
      binding &&
      found &&
      this.entries.get(binding.key) === found &&
      (found.settledAt === undefined || this.now() - found.settledAt < this.ttlMs)
    )
      return found.promise;
    const previous = this.resolving.get(input);
    if (previous?.version === this.version) return previous.promise;
    const pending = { version: this.version, promise: this.resolve(cwd, input, this.version) };
    this.resolving.set(input, pending);
    while (this.resolving.size > this.maxEntries)
      this.resolving.delete(this.resolving.keys().next().value!);
    const release = () => {
      if (this.resolving.get(input) === pending) this.resolving.delete(input);
    };
    void pending.promise.then(release, release);
    return pending.promise;
  }

  private pathKey(path: string): string {
    const value = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    return process.platform === "win32" ? value.toLowerCase() : value;
  }

  private rememberAlias(
    input: string,
    key: string,
    entry: { promise: Promise<string>; settledAt?: number },
  ) {
    this.aliases.delete(input);
    this.aliases.set(input, { key, entry });
    while (this.aliases.size > this.maxEntries)
      this.aliases.delete(this.aliases.keys().next().value!);
  }

  private async resolve(cwd: string, input: string, version: number): Promise<string> {
    let physical = cwd;
    try {
      physical = await realpath(cwd);
    } catch {
      // A missing/unreadable folder keeps the existing empty-branch behavior.
      // Its raw path is not allowed to poison a previously resolved identity.
    }
    const key = this.pathKey(physical);
    const read = () =>
      Promise.resolve()
        .then(() => this.lookup(physical))
        .catch(() => "");
    // clear() can run while realpath is pending. The earlier caller may finish,
    // but it cannot repopulate the cache after that invalidation.
    if (version !== this.version) return read();
    const found = this.entries.get(key);
    if (found && (found.settledAt === undefined || this.now() - found.settledAt < this.ttlMs)) {
      this.rememberAlias(input, key, found);
      return found.promise;
    }
    this.entries.delete(key);
    this.prune();
    const entry: { promise: Promise<string>; settledAt?: number } = {
      promise: read(),
    };
    // Counted from when the answer arrived, so a slow spawn is not born stale.
    // A cleared entry is detached from the map and just dies.
    void entry.promise.then(() => {
      entry.settledAt = this.now();
    });
    this.entries.set(key, entry);
    this.rememberAlias(input, key, entry);
    return entry.promise;
  }

  /** Bumped by `clear()`, so cached lists built from older branches rebuild. */
  version = 0;

  /** A branch change this host just made must show on the next list. */
  clear(cwd?: string): void {
    this.version++;
    if (cwd === undefined) {
      this.entries.clear();
      this.aliases.clear();
      this.resolving.clear();
    } else {
      const input = this.pathKey(cwd);
      const previous = this.aliases.get(input);
      if (previous) this.entries.delete(previous.key);
      this.aliases.delete(input);
      this.entries.delete(input);
      try {
        // Mutations must invalidate the alias's current target as well as its
        // possibly stale path hint. This is deliberately fresh and synchronous.
        this.entries.delete(this.pathKey(realpathSync.native(cwd)));
      } catch {
        /* absent folder: the hint/raw entries above are still invalidated */
      }
    }
  }

  private prune(): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries)
      if (entry.settledAt !== undefined && this.now() - entry.settledAt >= this.ttlMs)
        this.entries.delete(key);
    // Still full of live entries: drop the oldest inserted.
    while (this.entries.size >= this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
  }
}

export const branchCache = new BranchCache((cwd) =>
  exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd,
    timeout: 2_000,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  }).then(({ stdout }) => stdout.trim()),
);

/** Runs one command in `root`, a validated working copy. */
export async function runGitAction(
  command: GitActionCommand,
  root: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  // A managed source cannot be integrated through the old reference-only API,
  // even when a caller bypasses WorkspaceCommands and invokes this helper.
  if (command === "git_merge" && isManagedWorkspaceBranch(input.reference))
    throw new Error(MANAGED_DELIVERY_REVIEW_REQUIRED);
  const run = () => runGitActionSerialized(command, root, input);
  return isHostGitMutation(command) || command === "git_management_snapshot"
    ? withHostGitMutation(root, run, undefined, gitMutationScope(command))
    : run();
}

async function runGitActionSerialized(
  command: GitActionCommand,
  root: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (command === "git_merge" && input.expectedTargetSha !== undefined) {
    const sha = await commitArg(root, input.expectedTargetSha);
    const managedSources = await git(root, [
      "for-each-ref",
      `--points-at=${sha}`,
      "--format=%(refname)",
      "refs/heads/bycoda/s/",
      "refs/heads/bycoda/t/",
    ]);
    if (managedSources.trim()) throw new Error(MANAGED_DELIVERY_REVIEW_REQUIRED);
  }
  if (command === "git_trust_repository") {
    if (input.confirmed !== true) throw new Error("Repository trust requires owner confirmation");
    const path = (await realpath(root)).split(sep).join("/");
    if (path.includes("*")) throw new Error("Wildcard repository trust is not allowed");
    try {
      await git(path, ["rev-parse", "--show-toplevel"]);
      return;
    } catch (error) {
      if (!String(error).includes("dubious ownership")) throw error;
    }
    const top = (
      await git(path, ["-c", `safe.directory=${path}`, "rev-parse", "--show-toplevel"])
    ).trim();
    if ((await realpath(top)) !== (await realpath(root)))
      throw new Error("Trust must target the repository root");
    await git(path, ["config", "--global", "--add", "safe.directory", path]);
    return;
  }
  try {
    if (input.expectedSnapshot !== undefined)
      await verifyGitManagementSnapshot(root, input.expectedSnapshot);
    return await runGitActionUncached(command, root, input);
  } finally {
    if (isHostGitMutation(command)) invalidateHostGitIndex(root);
    // A rename can change the label of another checked-out worktree. Ordinary
    // checkout/commit/reset work only invalidates this checkout's label input.
    if (!HEAD_PRESERVING.has(command))
      branchCache.clear(command === "git_rename_branch" ? undefined : root);
  }
}

/** Reads (some polled) that never move HEAD. */
const HEAD_PRESERVING: ReadonlySet<string> = new Set<GitActionCommand>([
  "git_management_snapshot",
  "git_commit_message",
  "git_stash_list",
  "git_tags",
  "git_operation_state",
  "git_operation_status",
  "git_remotes",
  "git_conflicts",
  "git_conflict_stages",
  "git_file_history",
  "git_blame",
  "git_fetch",
]);

/** An opaque receipt: credentials in remote configuration never leave the host. */
export async function gitManagementSnapshot(
  root: string,
): Promise<{ token: string; refs: Record<string, string> }> {
  await ensureWorkTree(root);
  const read = (args: string[]) =>
    git(root, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }).catch(() => {
      throw new Error(
        "Git management snapshot is unavailable or exceeds the safe size/time limit. No action was executed.",
      );
    });
  const parts = await Promise.all([
    realpath(root),
    gitOrNull(root, ["rev-parse", "--verify", "HEAD"]),
    gitOrNull(root, ["symbolic-ref", "--quiet", "HEAD"]),
    read(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)"]),
    read(["config", "--list", "--null", "--includes"]),
    read(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    read(["diff", "--no-ext-diff", "--binary", "--"]),
    read(["diff", "--cached", "--no-ext-diff", "--binary", "--"]),
    read(["remote", "-v"]),
    read(["ls-files", "--stage", "-z"]),
  ]);
  const refs: Record<string, string> = Object.fromEntries(
    (parts[3] ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha] = line.split("\0");
        return [name, sha];
      }),
  );
  if (Object.keys(refs).length > 10000)
    throw new Error("Git management snapshot has too many references. No action was executed.");
  return { token: createHash("sha256").update(JSON.stringify(parts)).digest("hex"), refs };
}

export async function verifyGitManagementSnapshot(root: string, expected: unknown): Promise<void> {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Invalid Git management snapshot");
  if ((await gitManagementSnapshot(root)).token !== expected)
    throw new Error("Repository state changed. Reload and review this action again.");
}

async function runGitActionUncached(
  command: GitActionCommand,
  root: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  // Cheap, polled reads skip the work-tree check: they return "nothing" in a
  // folder that is not a repository.
  switch (command) {
    case "git_management_snapshot":
      return gitManagementSnapshot(root);
    case "git_operation_state":
      return operationState(root);
    case "git_conflicts":
      return conflicts(root);
    case "git_operation_status": {
      const [operation, files] = await Promise.all([operationState(root), conflicts(root)]);
      return { operation, conflicts: files };
    }
    case "git_tags":
      return (
        (
          await gitOrNull(root, [
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:lstrip=2)",
            "refs/tags",
          ])
        )
          ?.split("\n")
          .map((line) => line.trim())
          .filter(Boolean) ?? []
      );
    case "git_remotes":
      return ((await gitOrNull(root, ["remote", "-v"])) ?? "").split("\n").flatMap((line) => {
        const [name, rest] = line.split("\t");
        const url = rest
          ?.trim()
          .match(/^(.*)\(fetch\)$/)?.[1]
          ?.trim();
        return name && url !== undefined ? [{ name: name.trim(), url }] : [];
      });
    case "git_stash_list": {
      const output = await gitOrNull(root, [
        "stash",
        "list",
        "--format=%gd%x00%H%x00%gs%x00%ct%x1e",
      ]);
      return (output ?? "").split("\x1e").flatMap((record) => {
        const [name, sha, message, time] = record.trim().split("\0");
        const index = name?.match(/^stash@\{(\d+)\}$/)?.[1];
        return index === undefined || !sha || message === undefined
          ? []
          : [{ index: Number(index), sha, message, timestamp: Number(time) || 0 }];
      });
    }
  }

  await ensureWorkTree(root);
  switch (command) {
    case "git_stash": {
      const flags = new Map([
        ["tracked", []],
        ["untracked", ["--include-untracked"]],
        ["staged", ["--staged"]],
      ]);
      const mode = flags.get(String(input.mode ?? "untracked"));
      if (!mode || (input.mode != null && typeof input.mode !== "string"))
        throw new Error("Invalid stash mode");
      const message = stashMessage(input.message);
      await git(root, ["stash", "push", ...mode, ...(message ? ["-m", message] : [])]);
      return;
    }
    case "git_stash_action": {
      if (input.action !== "apply" && input.action !== "pop" && input.action !== "drop")
        throw new Error("Invalid stash action");
      const selector = `stash@{${stashIndex(input.index)}}`;
      if (typeof input.expectedSha !== "string" || !/^[a-f0-9]{40,64}$/i.test(input.expectedSha))
        throw new Error("Expected stash SHA is required");
      const check = async () => {
        if (
          (await gitOrNull(root, ["rev-parse", "--verify", selector]))?.trim() !== input.expectedSha
        )
          throw new Error("Stash list changed; refresh and select the stash again");
      };
      await check();
      if (input.action !== "drop") await git(root, ["stash", "apply", input.expectedSha]);
      if (input.action !== "apply") {
        await check();
        await git(root, ["stash", "drop", selector]);
      }
      return;
    }
    case "git_stash_clear":
      if (input.expectedShas !== undefined) {
        if (
          !Array.isArray(input.expectedShas) ||
          input.expectedShas.length > 1000 ||
          !input.expectedShas.every(
            (sha: unknown) =>
              typeof sha === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha),
          )
        )
          throw new Error("Invalid expected stash snapshot");
        const current = (await git(root, ["stash", "list", "--format=%H"]))
          .trim()
          .split("\n")
          .filter(Boolean);
        if (JSON.stringify(current) !== JSON.stringify(input.expectedShas))
          throw new Error("Stash list changed; refresh and review the list again");
        // Compare-and-swap also protects against Git clients outside the host's mutation queue.
        if (current.length) await git(root, ["update-ref", "-d", "refs/stash", current[0]!]);
        return;
      }
      await git(root, ["stash", "clear"]);
      return;
    case "git_checkout_commit":
      await switching(root, ["checkout", "--detach", await commitArg(root, input.sha)]);
      return;
    case "git_create_branch_at": {
      const sha = await commitArg(root, input.sha);
      const name = await branchName(root, input.name);
      if (await refExists(root, `refs/heads/${name}`))
        throw new Error(`Branch ${name} already exists`);
      await switching(root, ["checkout", "-b", name, sha]);
      return name;
    }
    case "git_create_branch_from": {
      const name = await branchName(root, input.name);
      const reference = await branchRef(root, input.reference);
      if (await refExists(root, `refs/heads/${name}`))
        throw new Error(`Branch ${name} already exists`);
      await switching(root, ["checkout", "-b", name, reference]);
      return name;
    }
    case "git_create_tag": {
      const sha = await commitArg(root, input.sha);
      const name = await tagName(root, input.name);
      if (await refExists(root, `refs/tags/${name}`)) throw new Error(`Tag ${name} already exists`);
      await git(root, ["tag", name, sha]);
      return;
    }
    case "git_delete_tag": {
      const name = await tagName(root, input.name);
      if (!(await refExists(root, `refs/tags/${name}`)))
        throw new Error(`Tag ${name} does not exist`);
      if (input.expectedTargetSha !== undefined) {
        if (
          typeof input.expectedTargetSha !== "string" ||
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(input.expectedTargetSha)
        )
          throw new Error("Invalid expected tag object");
        await git(root, ["update-ref", "-d", `refs/tags/${name}`, input.expectedTargetSha]);
      } else await git(root, ["tag", "-d", name]);
      return;
    }
    case "git_cherry_pick":
      await git(root, ["cherry-pick", await commitArg(root, input.sha)]);
      return;
    case "git_revert":
      await git(root, ["revert", "--no-edit", await commitArg(root, input.sha)]);
      return;
    case "git_reset": {
      const flag = new Map([
        ["soft", "--soft"],
        ["mixed", "--mixed"],
        ["hard", "--hard"],
      ]).get(String(input.mode));
      if (!flag || typeof input.mode !== "string") throw new Error("Invalid reset mode");
      await git(root, ["reset", flag, await commitArg(root, input.sha)]);
      return;
    }
    case "git_undo_last_commit": {
      // `<sha> <parent>...`: one parent for an ordinary commit.
      const line = await gitOrNull(root, ["rev-list", "--parents", "-n", "1", "HEAD"]);
      if (!line) throw new Error("No commits yet");
      const count = line.split(/\s+/).length;
      if (count === 1) throw new Error("The first commit has no parent to go back to");
      if (count > 2) throw new Error("Cannot undo a merge commit");
      await git(root, ["reset", "--soft", "HEAD~1"]);
      return;
    }
    case "git_operation_abort": {
      const operation = await operationState(root);
      if (!operation) throw new Error("No operation in progress");
      await git(root, [operation, "--abort"]);
      return;
    }
    case "git_operation_continue": {
      // `core.editor=true` accepts the prepared message instead of opening an editor.
      const operation = await operationState(root);
      if (!operation) throw new Error("No operation in progress");
      const unresolved = await hostUnmerged(root);
      if (unresolved.length) throw new Error(unmergedMessage(unresolved));
      try {
        await git(
          root,
          operation === "merge"
            ? ["-c", "core.editor=true", "commit", "--no-edit"]
            : ["-c", "core.editor=true", operation, "--continue"],
        );
      } catch (reason) {
        // A rebase that reaches a conflicting commit exits non-zero but is
        // working: the panel then shows the next conflicts.
        if (!(await operationState(root)) || !(await hostUnmerged(root)).length) throw reason;
      }
      return;
    }
    case "git_delete_branch": {
      const name = await branchName(root, input.name);
      if ((await gitOrNull(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])) === name)
        throw new Error("Cannot delete the current branch");
      await git(root, ["branch", input.force === true ? "-D" : "-d", name]);
      return;
    }
    case "git_rename_branch": {
      const from = await branchName(root, input.from);
      const to = await branchName(root, input.to);
      if (await refExists(root, `refs/heads/${to}`)) throw new Error(`Branch ${to} already exists`);
      await git(root, ["branch", "-m", from, to]);
      return to;
    }
    case "git_delete_remote_branch": {
      const remote = await knownRemote(root, input.remote);
      const name = await branchName(root, input.name);
      if (input.expectedTargetSha !== undefined) {
        const sha = await commitArg(root, input.expectedTargetSha);
        await git(
          root,
          ["push", `--force-with-lease=refs/heads/${name}:${sha}`, remote, `:refs/heads/${name}`],
          { timeout: NETWORK_MS },
        );
      } else await git(root, ["push", remote, "--delete", name], { timeout: NETWORK_MS });
      return;
    }
    case "git_merge":
      await git(
        root,
        [
          "merge",
          "--no-edit",
          input.expectedTargetSha === undefined
            ? await branchRef(root, input.reference)
            : await commitArg(root, input.expectedTargetSha),
        ],
        {
          timeout: NETWORK_MS,
        },
      );
      return;
    case "git_rebase":
      await git(
        root,
        [
          "rebase",
          input.expectedTargetSha === undefined
            ? await branchRef(root, input.reference)
            : await commitArg(root, input.expectedTargetSha),
        ],
        {
          timeout: NETWORK_MS,
        },
      );
      return;
    case "git_fetch": {
      if (!(await remoteNames(root)).length) throw new Error("No git remote to fetch from");
      // Explicit either way: a user's `fetch.prune` config must not decide this.
      await git(root, ["fetch", "--all", input.prune === true ? "--prune" : "--no-prune"], {
        timeout: NETWORK_MS,
      });
      return;
    }
    case "git_remote_add": {
      const name = await newRemoteName(root, input.name);
      const url = text(input.url, "remote URL", 4096);
      if (!url) throw new Error("Remote URL cannot be empty");
      if (url.startsWith("-") || /\p{Cc}/u.test(url)) throw new Error("Invalid remote URL");
      if ((await remoteNames(root)).includes(name))
        throw new Error(`Remote ${name} already exists`);
      await git(root, ["remote", "add", name, url]);
      return;
    }
    case "git_remote_remove":
      await git(root, ["remote", "remove", await knownRemote(root, input.name)]);
      return;
    case "git_resolve_conflict": {
      const path = await repoPath(root, input.relative);
      if (input.contents !== undefined) {
        if (input.side !== "reviewed") throw new Error("Invalid reviewed conflict side");
        return hostGitAction(
          root,
          "resolveContents",
          path,
          undefined,
          input.contents,
          undefined,
          input.expectedCurrent,
          () => verifyGitManagementSnapshot(root, input.expectedSnapshot),
        );
      }
      if (input.side !== "ours" && input.side !== "theirs") throw new Error("Invalid side");
      const stages = await hostConflictStageSet(root, path);
      if (!stages.size) throw new Error("This file has no merge conflict");
      // `checkout --ours/--theirs` fails when that side deleted the file;
      // taking the deletion is `git rm`.
      if (!stages.has(input.side === "ours" ? 2 : 3)) {
        await git(root, ["rm", "-f", "--", path]);
        return;
      }
      await git(root, ["checkout", input.side === "ours" ? "--ours" : "--theirs", "--", path]);
      await git(root, ["add", "--", path]);
      return;
    }
    case "git_conflict_stages":
      return hostConflictStages(root, await repoPath(root, input.relative));
    case "git_file_history": {
      const path = await repoPath(root, input.relative);
      const [head, refs, output] = await Promise.all([
        gitOrNull(root, ["rev-parse", "HEAD"]),
        git(root, ["for-each-ref", HISTORY_REFS_FORMAT, "refs/heads", "refs/tags", "refs/remotes"]),
        gitOrNull(root, [
          "log",
          "--follow",
          "--max-count",
          historyLimit(input.limit),
          HISTORY_FORMAT,
          "--",
          path,
        ]),
      ]);
      return parseHistoryLog(output ?? "", head, parseHistoryRefs(refs));
    }
    case "git_blame": {
      const path = await repoPath(root, input.relative);
      const revision = input.sha === undefined ? [] : [await commitArg(root, input.sha)];
      const output = await git(root, ["blame", "--line-porcelain", ...revision, "--", path], {
        timeout: NETWORK_MS,
        maxBuffer: 64 * 1024 * 1024,
      }).catch(() => {
        throw new Error("Could not blame this file");
      });
      const lines = parseBlame(output);
      if (lines.length > MAX_BLAME_LINES) throw new Error("File is too large to blame");
      return lines;
    }
    case "git_commit_message":
      return git(root, ["show", "-s", "--format=%B", await commitArg(root, input.sha), "--"]);
  }
}
