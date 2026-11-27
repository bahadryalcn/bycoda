import { hostGitExec } from "./git-exec-pool";
import { StringDecoder } from "node:string_decoder";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, open, readFile, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { WorktreeRemovalReview } from "../../src/features/source-control/model/worktrees";
import {
  entryMissing,
  inside,
  inventoryWorkspaceLinks,
  validateWorkspaceCleanupPaths,
} from "../workspaces/workspace-cleanup-paths";
import type { ManagedWorkspace, WorkspaceNames } from "../workspaces/workspace-contracts";
import { managedWorkspaceNames } from "../managed/workspace-branch-naming";
import {
  canonicalWorkspaceDirectory,
  canonicalWorkspaceEntry,
  canonicalWorkspacePath,
  canonicalWorkspacePathSync,
  workspacePathKey,
} from "../workspaces/workspace-paths";

const gitEnv = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const bufferedOptions = (cwd: string, mutation = false) => ({
  cwd,
  windowsHide: true,
  env: gitEnv,
  timeout: mutation ? 120_000 : 10_000,
  maxBuffer: 1024 * 1024,
});
const options = (cwd: string, mutation = false) => ({
  ...bufferedOptions(cwd, mutation),
  env: { ...process.env, ...gitEnv },
});

/** S1 portion of the frozen naming service; S2 supplies turnRef and rewindRef. */
export const workspaceNames: Pick<WorkspaceNames, "directory"> = {
  directory(id) {
    return managedWorkspaceNames({ kind: "session", id: "naming" }, "work", id)
      .directory as ReturnType<WorkspaceNames["directory"]>;
  },
};

export async function managedWorkspaceBase(cwd: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
    throw new Error("Invalid committed workspace base");
  return (
    await hostGitExec.exec(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      options(cwd),
    )
  ).stdout.trim();
}

/** Resolve the root once; later materialization refuses path redirection. */
export async function managedWorkspaceRoot(
  cwd: string,
  configured: string | null,
): Promise<string> {
  const root = resolve(configured ?? (await listCached(cwd, true)).defaultRoot);
  return canonicalWorkspaceDirectory(root);
}

/** Caller holds the common-repository mutation gate and a durable operation reservation. */
export async function materializeManagedWorkspace(
  cwd: string,
  workspace: ManagedWorkspace,
  creating: boolean,
  observer: CreationObserver = {},
): Promise<void> {
  const root = await canonicalWorkspaceEntry(dirname(workspace.path));
  const path = join(root, basename(workspace.path));
  if ((await hostGitRepositoryKey(cwd)) !== workspace.repositoryId)
    throw new Error("Managed project repository identity changed");
  if (workspacePathKey(await canonicalWorkspaceDirectory(root)) !== workspacePathKey(root))
    throw new Error("Managed workspace root changed");
  await mkdir(dirname(path), { recursive: true });
  if (workspacePathKey(await canonicalWorkspacePath(root)) !== workspacePathKey(root))
    throw new Error("Managed workspace root changed");
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (info?.isSymbolicLink()) throw new Error("Managed workspace path is a link");
  const marker = `refs/bycoda/workspaces/${workspace.id}`;
  const branch = workspace.branchRef.replace(/^refs\/heads\//, "");
  if (creating) {
    const owner = await managedWorkspaceBase(cwd, marker).catch(() => null);
    if (owner === null) {
      // update-ref transactions atomically reserve the branch and its complete owner ID.
      const input = `start\ncreate ${workspace.branchRef} ${workspace.baseCommit}\ncreate ${marker} ${workspace.baseCommit}\nprepare\ncommit\n`;
      const decoder = new StringDecoder("utf8");
      let stderr = "";
      await hostGitExec
        .exec("git", ["update-ref", "--stdin"], {
          ...options(cwd, true),
          input,
          onOutput: (stream, chunk) => {
            if (stream === "stderr" && stderr.length < 2000)
              stderr += decoder.write(chunk).slice(0, 2000 - stderr.length);
          },
        })
        .catch((error: { code?: string | number | null; killed?: boolean }) => {
          if (error.killed || error.code === "ETIMEDOUT")
            throw new Error("Workspace branch reservation timed out");
          if (typeof error.code !== "number" && error.code !== null) throw error;
          throw new Error(
            `Workspace branch reservation failed: ${(stderr + decoder.end()).slice(0, 2000)}`,
          );
        });
    } else if (owner !== workspace.baseCommit)
      throw new Error("Workspace branch ownership changed");
    if ((await managedWorkspaceBase(cwd, workspace.branchRef)) !== workspace.baseCommit)
      throw new Error("Workspace creation branch moved; recovery required");
  } else if ((await managedWorkspaceBase(cwd, marker)) !== workspace.baseCommit) {
    throw new Error("Workspace branch ownership is missing");
  }
  const listed = await listCached(cwd, true);
  const verify = async () => {
    if (
      (await hostGitRepositoryKey(path)) !== workspace.repositoryId ||
      (await hostGitRepositoryKey(cwd)) !== workspace.repositoryId
    )
      throw new Error("Managed workspace repository changed");
    const actual = (
      await hostGitExec.exec("git", ["symbolic-ref", "HEAD"], options(path))
    ).stdout.trim();
    if (actual !== workspace.branchRef) throw new Error("Managed workspace branch changed");
    if (creating && (await managedWorkspaceBase(path, "HEAD")) !== workspace.baseCommit)
      throw new Error("Managed workspace HEAD changed during creation");
  };
  const registered = listed.worktrees.find(
    (tree) => workspacePathKey(tree.path) === workspacePathKey(path),
  );
  // A killed `git worktree add` leaves an "initializing" lock and a partial checkout. While
  // creating, the marker above proves this workspace owns the path, so clear it and add again.
  if (creating && registered && !registered.isMain && registered.branch === branch) {
    if (registered.locked) {
      await clearBrokenCheckout(cwd, path);
      return materializeManagedWorkspace(cwd, workspace, creating, observer);
    }
  }
  if (registered) {
    if (registered.isMain || registered.branch !== branch || registered.locked)
      throw new Error("Managed worktree registration changed");
    if (!creating && !info && workspace.directoryState === "removed") {
      if (listed.worktrees.some((tree) => tree !== registered && tree.branch === branch))
        throw new Error("Managed branch is checked out elsewhere");
      // Restore only this absent, owned registration. Git refuses an existing path;
      // never prune other missing worktrees or bypass a locked registration.
      try {
        await hostGitExec.exec(
          "git",
          ["worktree", "add", "--force", "--", path, branch],
          options(cwd, true),
        );
        await verify();
        return;
      } finally {
        invalidateHostWorktrees();
      }
    }
    if (registered.missing || !info) throw new Error("Managed worktree registration changed");
    await verify();
    return;
  }
  if (info) throw new Error("Managed workspace directory already exists without registration");
  if (listed.worktrees.some((tree) => tree.branch === branch))
    throw new Error("Managed branch is checked out elsewhere");
  try {
    await hostGitExec.exec("git", ["worktree", "add", "--", path, branch], {
      ...options(cwd, true),
      signal: observer.signal,
    });
    await verify();
  } finally {
    invalidateHostWorktrees();
  }
}

/** Cancels a running creation. Git reports no checkout percent without a terminal, so none is relayed. */
export type CreationObserver = { signal?: AbortSignal };

function available(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export type HostWorktree = {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  missing: boolean;
  locked?: boolean;
  /** Uncommitted files exist; `null` when Git could not say (never read as clean). Set by `hostWorktrees`. */
  dirty?: boolean | null;
  /** Commits on no remote; `null` when Git could not count them. Set by `hostWorktrees`. */
  unpushed?: number | null;
};
export type HostWorktrees = { worktrees: HostWorktree[]; defaultRoot: string };

function parse(text: string): HostWorktree[] {
  const trees: HostWorktree[] = [];
  let tree: HostWorktree | undefined;
  for (const field of text.split("\0")) {
    if (field.startsWith("worktree ")) {
      tree = {
        path: field.slice(9),
        branch: null,
        head: "",
        isMain: trees.length === 0,
        missing: false,
      };
      trees.push(tree);
    } else if (tree && (field === "locked" || field.startsWith("locked "))) {
      tree.locked = true;
    } else if (tree && field.startsWith("HEAD ")) {
      tree.head = field.slice(5);
    } else if (tree && field.startsWith("branch refs/heads/")) {
      tree.branch = field.slice("branch refs/heads/".length);
    }
  }
  return trees;
}

const LIST_TTL_MS = 5_000;
const LIST_CACHE_LIMIT = 32;
const LIST_ARGS = ["worktree", "list", "--porcelain", "-z"];

type CachedList = {
  lane: "default" | "background";
  at: number;
  generation: number;
  promise: Promise<HostWorktrees>;
  /** Set once the list is known, for callers that cannot await. */
  value?: HostWorktrees;
};
const listCache = new Map<string, CachedList>();
let listGeneration = 0;

/**
 * Forget cached worktree lists after this host adds, removes or renames a
 * worktree. Without a project path, every list is dropped.
 */
export function invalidateHostWorktrees(cwd?: string): void {
  listGeneration++;
  if (cwd === undefined) listCache.clear();
  else listCache.delete(cwd);
}

// Asynchronous and parallel: a project lists dozens of worktrees, and synchronous stat/realpath for each held
// the Host main thread for 1.75 s on Windows (file-system filter drivers inspect every call).
async function build(text: string): Promise<HostWorktrees> {
  const worktrees = await Promise.all(
    parse(text).map(async (tree) => {
      const present = await stat(tree.path).then(
        (info) => info.isDirectory(),
        () => false,
      );
      const path = present
        ? await canonicalWorkspacePath(tree.path).catch(() => undefined)
        : undefined;
      return { ...tree, path: path ?? tree.path, missing: path === undefined };
    }),
  );
  const main = worktrees[0];
  if (!main) throw new Error("No working copies found");
  return {
    worktrees,
    defaultRoot: join(dirname(main.path), `${basename(main.path)}-worktrees`),
  };
}

function remember(cwd: string, entry: CachedList) {
  listCache.delete(cwd);
  listCache.set(cwd, entry);
  while (listCache.size > LIST_CACHE_LIMIT)
    listCache.delete(listCache.keys().next().value as string);
}

function fresh(cwd: string): CachedList | undefined {
  const hit = listCache.get(cwd);
  return hit && hit.generation === listGeneration && Date.now() - hit.at < LIST_TTL_MS
    ? hit
    : undefined;
}

/** Share fresh lists and compatible in-flight reads for a few seconds. */
function listCached(
  cwd: string,
  force = false,
  lane: CachedList["lane"] = "default",
): Promise<HostWorktrees> {
  const hit = force ? undefined : fresh(cwd);
  // Interactive callers can reuse completed inventory without waiting behind its lane.
  if (hit && (hit.value || hit.lane === "default" || lane === "background")) return hit.promise;
  const entry: CachedList = {
    lane,
    at: Date.now(),
    generation: listGeneration,
    promise: hostGitExec
      .exec("git", LIST_ARGS, { ...bufferedOptions(cwd), lane })
      .then(async ({ stdout }) => {
        const value = await build(stdout);
        entry.value = value;
        return value;
      }),
  };
  remember(cwd, entry);
  // Failures are not cached.
  entry.promise.catch(() => {
    if (listCache.get(cwd) === entry) listCache.delete(cwd);
  });
  return entry.promise;
}

/** The real path of a requested working copy, or null for the project itself. */
function requestedPath(projectCwd: string, requested: unknown): string | null {
  if (requested == null || requested === "" || requested === projectCwd) return null;
  if (typeof requested !== "string" || requested.includes("\0") || requested.length > 4096)
    throw new Error("Invalid working copy");
  const actual = available(requested) ? canonicalWorkspacePathSync(requested) : requested;
  return actual === projectCwd ? null : actual;
}

/** Bounded reads of Git's small text pointers, including relative-worktree pointers. */
async function readGitPointer(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 8192) return "";
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(8193);
    const { bytesRead } = await file.read(bytes);
    return bytesRead > 8192 ? "" : bytes.toString("utf8", 0, bytesRead).trimEnd();
  } finally {
    await file.close();
  }
}

/** A listed checkout still belongs to this project only while Git points back to it. */
export async function isCurrentProjectWorktree(root: string, project: string): Promise<boolean> {
  const marker = resolve(root, ".git");
  try {
    const common = await hostGitRepositoryKey(project);
    const info = await stat(marker);
    const target = info.isDirectory()
      ? marker
      : /^gitdir: (.+)$/.exec(await readGitPointer(marker))?.[1];
    if (!target) return false;
    const admin = await realpath(resolve(root, target));
    // Primary checkouts have no admin backlink. Confirm Git's primary path even with --separate-git-dir.
    if (!relative(common, admin)) {
      const [main] = (await listCached(project, true)).worktrees;
      return !!main && !main.missing && !relative(root, await realpath(main.path));
    }
    if (relative(resolve(common, "worktrees"), dirname(admin))) return false;
    const owner = await readGitPointer(join(admin, "commondir"));
    if (!owner || relative(common, await realpath(resolve(admin, owner)))) return false;
    const back = await readGitPointer(join(admin, "gitdir"));
    const backMarker = resolve(admin, back);
    return (
      !!back &&
      basename(backMarker) === ".git" &&
      !relative(root, await realpath(dirname(backMarker)))
    );
  } catch {
    return false;
  }
}

/** A cached list may predate a worktree made outside this host: look again before refusing. */
export async function resolveHostWorktreeAsync(
  projectCwd: string,
  requested: unknown,
): Promise<string> {
  const actual = requestedPath(projectCwd, requested);
  if (actual === null) return projectCwd;
  const listed = (trees: HostWorktrees) =>
    trees.worktrees.some((tree) => tree.path === actual && !tree.missing);
  if (
    (listed(await listCached(projectCwd)) || listed(await listCached(projectCwd, true))) &&
    (await isCurrentProjectWorktree(actual, projectCwd))
  )
    return actual;
  throw new Error("Choose an available worktree of this project");
}

const STATE_PARALLELISM = 4;
const STATE_TTL_MS = 2_000;
type CachedState = {
  lane: CachedList["lane"];
  completedAt?: number;
  generation: number;
  promise: Promise<HostWorktrees>;
};
const stateCache = new Map<string, CachedState>();

/** Same read-only probe as the desktop listing: a failed Git read stays unknown, never clean. */
async function probeWorktree(tree: HostWorktree, lane: CachedList["lane"]): Promise<HostWorktree> {
  if (tree.missing) return { ...tree, dirty: null, unpushed: null };
  const git = (args: string[]) =>
    hostGitExec
      .exec("git", args, { ...bufferedOptions(tree.path), lane })
      .then(({ stdout }) => stdout)
      .catch(() => undefined);
  const [status, count] = await Promise.all([
    git(["status", "--porcelain", "--untracked-files=normal", "--no-renames"]),
    git(["rev-list", "--count", "HEAD", "--not", "--remotes"]),
  ]);
  const unpushed = count === undefined ? Number.NaN : Number.parseInt(count.trim(), 10);
  return {
    ...tree,
    dirty: status === undefined ? null : status.length > 0,
    unpushed: Number.isFinite(unpushed) ? unpushed : null,
  };
}

async function withState(list: HostWorktrees, lane: CachedList["lane"]): Promise<HostWorktrees> {
  const worktrees = list.worktrees.slice();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(STATE_PARALLELISM, worktrees.length) }, async () => {
      while (next < worktrees.length) {
        const index = next++;
        worktrees[index] = await probeWorktree(list.worktrees[index], lane);
      }
    }),
  );
  return { ...list, worktrees };
}

/**
 * The client-facing worktree list with `dirty` and `unpushed` per checkout, so a connected machine's
 * clients see what the desktop's own listing shows. Probing is bounded and cached briefly;
 * path resolution keeps using the cheap list.
 */
export function hostWorktreesWithState(
  cwd: string,
  background = false,
  light = false,
): Promise<HostWorktrees> {
  const lane = background ? "background" : "default";
  // Light callers need path/branch/head/missing only: the cheap list has them, without probes.
  if (light) return listCached(cwd, false, lane);
  const hit = stateCache.get(cwd);
  if (hit?.generation === listGeneration) {
    const reusable =
      hit.completedAt === undefined
        ? hit.lane === "default" || lane === "background"
        : Date.now() - hit.completedAt < STATE_TTL_MS;
    if (reusable) return hit.promise;
  }
  // Share pending probes with compatible callers, even if they spend longer
  // in the queue than a completed snapshot stays fresh.
  const entry: CachedState = {
    lane,
    generation: listGeneration,
    promise: listCached(cwd, false, lane)
      .then((list) => withState(list, lane))
      .then((state) => {
        entry.completedAt = Date.now();
        return state;
      }),
  };
  stateCache.set(cwd, entry);
  while (stateCache.size > LIST_CACHE_LIMIT)
    stateCache.delete(stateCache.keys().next().value as string);
  // Failures are not cached.
  entry.promise.catch(() => {
    if (stateCache.get(cwd) === entry) stateCache.delete(cwd);
  });
  return entry.promise;
}

type RemovalUsage = Pick<WorktreeRemovalReview, "sessionIds" | "hasTerminals" | "hasAgents">;

export async function inspectHostWorktreeRemoval(
  cwd: string,
  requested: unknown,
  usage: (path: string) => Promise<RemovalUsage>,
  fingerprint: (input: Record<string, unknown>) => Promise<string>,
  allowMissing = false,
) {
  if (
    typeof requested !== "string" ||
    requested.length > 4096 ||
    requested.includes("\0") ||
    !isAbsolute(requested)
  )
    throw new Error("Choose an absolute worktree path");
  const path = await canonicalWorkspaceEntry(requested);
  const git = async (args: string[], directory = path) =>
    (await hostGitExec.exec("git", args, bufferedOptions(directory))).stdout;
  // Use the raw registration. The picker resolves aliases for display.
  const trees = parse(await git(LIST_ARGS, cwd));
  const main = trees[0];
  if (!main) throw new Error("No working copies found");
  const projectCwd = await canonicalWorkspacePath(main.path);
  const commonDir = await hostGitRepositoryKey(cwd);
  const tree = trees.find((entry) => workspacePathKey(entry.path) === workspacePathKey(path));
  if (tree?.isMain || workspacePathKey(projectCwd) === workspacePathKey(path))
    throw new Error("Main cannot be removed.");
  if (tree?.locked) throw new Error("The worktree is locked.");
  if (await entryMissing(path)) {
    if (allowMissing) return { path, projectCwd, commonDir, gone: true as const };
    throw new Error("The worktree directory is missing.");
  }
  if (!tree) throw new Error("Choose a registered worktree of this project.");
  await validateWorkspaceCleanupPaths(path, path);
  const metadata = await lstat(join(path, ".git"));
  if (!metadata.isFile() || (await hostGitRepositoryKey(path)) !== commonDir)
    throw new Error("Worktree repository identity changed.");
  const top = (await git(["rev-parse", "--show-toplevel"])).trim();
  if (workspacePathKey(top) !== workspacePathKey(path)) throw new Error("Worktree root changed.");
  const admin = (await git(["rev-parse", "--absolute-git-dir"])).trim();
  if (
    workspacePathKey(dirname(admin)) !== workspacePathKey(join(commonDir, "worktrees")) ||
    workspacePathKey(resolve(admin, (await readFile(join(admin, "gitdir"), "utf8")).trim())) !==
      workspacePathKey(join(path, ".git"))
  )
    throw new Error("Worktree registration changed.");
  const links = await inventoryWorkspaceLinks(path);

  let status = await git([
    "-c",
    "status.showUntrackedFiles=normal",
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
    "--ignore-submodules=none",
  ]);
  const refs = await git(["rev-list", "HEAD", "--not", "--remotes"]);
  const unpushed = refs.trim() ? refs.trim().split("\n").length : 0;
  const indexEntries = (await git(["ls-files", "--stage", "-v", "-z"])).split("\0");
  const blockers: string[] = [];
  let submodule = false;
  const sparse =
    (await git(["config", "--type=bool", "--default=false", "core.sparseCheckout"])).trim() ===
    "true";
  for (const entry of indexEntries) {
    const match = /^(\S) (\d+) ([0-9a-f]+) \d\t(.*)$/s.exec(entry);
    if (!match) continue;
    const [, flag, mode, id, file] = match;
    const full = resolve(path, file);
    if (!inside(path, full)) throw new Error("Unsafe Git index path.");
    if (mode === "160000") {
      submodule = true;
      if (!(await entryMissing(join(full, ".git")))) {
        if (
          links.some(
            (link) =>
              workspacePathKey(link.path) === workspacePathKey(full) || inside(link.path, full),
          )
        )
          throw new Error("Cannot verify a linked submodule.");
        const privateCommit = await git(
          ["rev-list", "--max-count=1", "HEAD", "--all", "--reflog", "--not", "--remotes"],
          full,
        );
        if (privateCommit.trim()) blockers.push(`Submodule has unpublished commits: ${file}`);
      }
      continue;
    }
    if (!/^[a-zS]$/.test(flag)) continue;
    if (links.some((link) => inside(link.path, full)))
      throw new Error("Cannot inspect a tracked file through a symbolic link.");
    const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!info && sparse && flag.toUpperCase() === "S") continue;
    const actual =
      mode === "120000" && info?.isSymbolicLink()
        ? (
            await hostGitExec.exec("git", ["hash-object", "--stdin"], {
              ...bufferedOptions(path),
              input: await readlink(full),
            })
          ).stdout.trim()
        : info?.isFile() && mode !== "120000"
          ? (await git(["hash-object", "--", file])).trim()
          : "";
    if (
      actual !== id ||
      (process.platform !== "win32" &&
        info?.isFile() &&
        Boolean(info.mode & 0o100) !== (mode === "100755"))
    )
      status += ` M ${file}\0`;
  }
  if (submodule) blockers.push("Submodule history requires separate review before removal.");
  const hasReparsePoints = process.platform === "win32" && links.length > 0;
  const files = (await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
    .split("\0")
    .filter(Boolean);
  const ignored = (
    await git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"])
  )
    .split("\0")
    .filter(Boolean);
  const index = resolve(path, (await git(["rev-parse", "--git-path", "index"])).trim());
  const content =
    submodule || hasReparsePoints
      ? ""
      : await fingerprint({
          path,
          files,
          ignored,
          index,
          head: tree.head,
          branch: tree.branch ?? "",
          status,
          detachedLinks: [],
        });
  const activity = await usage(path);
  const review = {
    projectCwd,
    commonDir,
    path,
    branch: tree.branch,
    head: tree.head,
    status,
    ignoredEntryCount: ignored.length,
    ignoredEntryPaths: ignored.slice(0, 10),
    unpushed,
    ...activity,
    blockers,
  };
  const state = createHash("sha256")
    .update(JSON.stringify([review, refs, content, metadata.ino, metadata.birthtimeMs, links]))
    .digest("hex");
  return { ...review, state, hasReparsePoints, gone: false as const };
}

export async function removeHostWorktreeDirectory(cwd: string, path: string, force: boolean) {
  try {
    await hostGitExec.exec(
      "git",
      [
        "-c",
        "status.showUntrackedFiles=normal",
        "worktree",
        "remove",
        ...(force ? ["--force"] : []),
        "--",
        path,
      ],
      bufferedOptions(cwd, true),
    );
  } finally {
    invalidateHostWorktrees();
  }
}

export async function createHostWorktree(
  cwd: string,
  branch: unknown,
  base: unknown,
  existing: unknown,
  sourceCwd = cwd,
): Promise<HostWorktree> {
  return withHostGitMutation(cwd, () =>
    createHostWorktreeSerialized(cwd, branch, base, existing, sourceCwd),
  );
}

async function createHostWorktreeSerialized(
  cwd: string,
  branch: unknown,
  base: unknown,
  existing: unknown,
  sourceCwd: string,
): Promise<HostWorktree> {
  if (
    typeof branch !== "string" ||
    !branch ||
    branch.length > 120 ||
    branch.startsWith("-") ||
    branch.startsWith("@")
  )
    throw new Error("Enter a valid branch name");
  await hostGitExec.exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  if (typeof base !== "string" || base.length > 255 || typeof existing !== "boolean")
    throw new Error("Invalid worktree base");
  const listed = await listCached(cwd, true);
  if (listed.worktrees.some((tree) => tree.branch === branch))
    throw new Error("This branch already has a working copy. Select it from the picker.");
  const slug = `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const path = join(listed.defaultRoot, slug);
  if (existsSync(path)) throw new Error(`${path} already exists. Choose another branch name.`);
  const refs = (
    await hostGitExec.exec(
      "git",
      ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
      options(cwd),
    )
  ).stdout
    .split("\n")
    .filter(Boolean);
  const source = existing
    ? `refs/heads/${branch}`
    : base === "HEAD"
      ? "HEAD"
      : refs.find((ref) => ref === `refs/heads/${base}` || ref === `refs/remotes/${base}`);
  if (!source || (existing && !refs.includes(source)))
    throw new Error("Choose an available base branch");
  const commit = (
    await hostGitExec.exec(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${source}^{commit}`],
      options(sourceCwd),
    )
  ).stdout.trim();
  await mkdir(listed.defaultRoot, { recursive: true });
  invalidateHostWorktrees(cwd);
  try {
    if (existing)
      await hostGitExec.exec("git", ["worktree", "add", "--", path, branch], options(cwd, true));
    else
      await hostGitExec.exec(
        "git",
        ["worktree", "add", "--no-track", "-b", branch, "--", path, commit],
        options(cwd, true),
      );
  } finally {
    invalidateHostWorktrees(cwd);
  }
  const created = (await listCached(cwd, true)).worktrees.find((tree) => tree.path === path);
  if (!created) throw new Error("Worktree created, but could not be found. Refresh the picker.");
  return created;
}

/** Rename only the temporary branch created for this specific worktree. */
export async function renameHostWorktreeBranch(
  cwd: string,
  path: string,
  expectedBranch: string,
  branch: string,
  stillOwned: () => boolean | Promise<boolean> = () => true,
): Promise<HostWorktree> {
  return withHostGitMutation(cwd, () =>
    renameHostWorktreeBranchSerialized(cwd, path, expectedBranch, branch, stillOwned),
  );
}

async function renameHostWorktreeBranchSerialized(
  cwd: string,
  path: string,
  expectedBranch: string,
  branch: string,
  stillOwned: () => boolean | Promise<boolean>,
): Promise<HostWorktree> {
  if (!/^by\/[a-z0-9]{8}$/.test(expectedBranch))
    throw new Error("This is not an automatically created worktree branch");
  if (!branch || branch.length > 120 || branch.startsWith("-") || branch.startsWith("@"))
    throw new Error("Enter a valid branch name");
  await hostGitExec.exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  const tree = (await listCached(cwd, true)).worktrees.find(
    (entry) => entry.path === path && !entry.missing,
  );
  if (!tree || tree.isMain || tree.branch !== expectedBranch)
    throw new Error("The worktree branch has changed");
  if (branch === expectedBranch) return tree;
  if (!(await stillOwned())) throw new Error("The session no longer owns this branch");
  invalidateHostWorktrees(cwd);
  try {
    await hostGitExec.exec("git", ["branch", "-m", expectedBranch, branch], options(tree.path));
  } finally {
    invalidateHostWorktrees(cwd);
  }
  const renamed = (await listCached(cwd, true)).worktrees.find((entry) => entry.path === path);
  if (!renamed) throw new Error("Branch renamed, but its worktree could not be found");
  return renamed;
}

/**
 * Deletes a branch after its worktree is gone, with a safe delete (`-d`, never `-D`).
 * Returns why Git kept the branch; a refusal never fails the removal.
 */
export async function deleteHostWorktreeBranch(
  cwd: string,
  branch: string,
): Promise<string | undefined> {
  try {
    await hostGitExec.exec("git", ["branch", "-d", "--", branch], bufferedOptions(cwd, true));
    return undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message.trim().slice(0, 300) : "";
    return reason ? `Branch ${branch} was kept: ${reason}` : `Branch ${branch} was kept.`;
  } finally {
    invalidateHostWorktrees();
  }
}

/** Cheap list for Host-internal callers: no per-checkout Git state. */
export function hostWorktrees(cwd: string, background = false): Promise<HostWorktrees> {
  return listCached(cwd, false, background ? "background" : "default");
}

const creationGit = (
  cwd: string,
  args: string[],
  extra: Partial<{ timeout: number; signal: AbortSignal; lane: "network" }> = {},
) =>
  hostGitExec.exec("git", args, {
    cwd,
    windowsHide: true,
    env: { ...process.env, ...gitEnv },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    ...extra,
  });
const creationRevision = (cwd: string, ref: string) =>
  creationGit(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${ref}^{commit}`,
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );

/**
 * An extra folder of a multi-repository session. It must be an existing Git repository root,
 * outside the project and not another working copy of the project's repository.
 */
export async function validateExtraRepository(
  projectCwd: string,
  projectRepositoryId: string,
  directory: unknown,
): Promise<{ directory: string; repositoryId: string }> {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory.includes("\0"))
    throw new Error("Repositories must be absolute folders");
  const canonical = await canonicalWorkspaceDirectory(directory).catch(() => null);
  if (
    !canonical ||
    !(await stat(canonical).then(
      (info) => info.isDirectory(),
      () => false,
    ))
  )
    throw new Error(`Repository folder does not exist: ${directory}`);
  const top = await creationGit(canonical, ["rev-parse", "--show-toplevel"]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
  if (
    !top ||
    workspacePathKey(await canonicalWorkspacePath(top).catch(() => top)) !==
      workspacePathKey(canonical)
  )
    throw new Error(`Not a Git repository root: ${directory}`);
  const project = workspacePathKey(projectCwd);
  const key = workspacePathKey(canonical);
  const below = relative(project, key);
  if (key === project || (below !== "" && !below.startsWith("..") && !isAbsolute(below)))
    throw new Error(`Repository is inside the project: ${directory}`);
  const repositoryId = await hostGitRepositoryKey(canonical);
  if (repositoryId === projectRepositoryId)
    throw new Error(`Repository is the project's own repository: ${directory}`);
  return { directory: canonical, repositoryId };
}

/** The extra repository's counterpart of the base branch, else its default or current branch. */
export async function equivalentBase(
  cwd: string,
  baseBranch: string | null,
): Promise<{ commit: string; branch: string | null }> {
  if (baseBranch) {
    const commit = await creationRevision(cwd, `refs/heads/${baseBranch}`);
    if (commit) return { commit, branch: baseBranch };
  }
  const originHead = await creationGit(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]).then(
    ({ stdout }) => stdout.trim().replace(/^origin\//, ""),
    () => "",
  );
  if (originHead) {
    const commit = await creationRevision(cwd, `refs/heads/${originHead}`);
    if (commit) return { commit, branch: originHead };
  }
  const current = await creationGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then(
    ({ stdout }) => stdout.trim() || null,
    () => null,
  );
  const commit = await creationRevision(cwd, "HEAD");
  if (!commit) throw new Error("Repository has no commit to start from");
  return { commit, branch: current };
}

/**
 * Fetches the branch's upstream (60 s deadline, never prompts) and returns the fetched commit.
 * Null means "start locally": no upstream, or the remote has no such branch. A network or
 * authentication failure throws.
 */
export async function fetchRemoteBase(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const [remote, remoteRef] = (
    await creationGit(cwd, [
      "for-each-ref",
      "--format=%(upstream:remotename)%09%(upstream:remoteref)",
      `refs/heads/${branch}`,
    ])
  ).stdout
    .trim()
    .split("\t");
  if (!remote || remote === "." || !remoteRef?.startsWith("refs/heads/")) return null;
  const remoteBranch = remoteRef.slice("refs/heads/".length);
  // FETCH_HEAD is repository-global and other fetches rewrite it; land in a private ref instead.
  const temporary = `refs/bycoda/fetch/${randomUUID()}`;
  try {
    await creationGit(
      cwd,
      ["fetch", "--no-tags", "--", remote, `+refs/heads/${remoteBranch}:${temporary}`],
      { timeout: 60_000, signal, lane: "network" },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/couldn't find remote ref/i.test(message)) return null;
    const reason = message.split("\n").find((line) => /^(fatal|error):/i.test(line.trim()));
    throw new Error(
      `Could not fetch ${remote}/${remoteBranch}: ${reason?.trim() ?? "network or authentication failure"}`,
    );
  }
  try {
    return await creationRevision(cwd, temporary);
  } finally {
    await creationGit(cwd, ["update-ref", "-d", temporary]).catch(() => undefined);
  }
}

/** One sibling worktree this operation made (or is about to make); the rollback journal entry. */
export type ExtraWorktreeRecord = {
  repository: string;
  path: string;
  branch: string;
  /** Commit the branch was created at; rollback deletes the branch only while it is still there. */
  base?: string;
};

/** Adds `branch` at `base` as a worktree of `repository`. Journals before running Git. */
export async function createExtraWorktree(input: {
  repository: string;
  path: string;
  branch: string;
  base: string;
  journal: ExtraWorktreeRecord[];
  /** Makes the journal entry durable before Git runs. */
  persist?: (record: ExtraWorktreeRecord) => Promise<void>;
  observer?: CreationObserver;
}): Promise<void> {
  const { repository, path, branch, observer = {} } = input;
  await withHostGitMutation(repository, async () => {
    const listed = parse((await creationGit(repository, LIST_ARGS)).stdout);
    const known = listed.find((tree) => workspacePathKey(tree.path) === workspacePathKey(path));
    const ours = input.journal.some(
      (record) => workspacePathKey(record.path) === workspacePathKey(path),
    );
    // A retry after an unknown outcome reuses its own earlier sibling, once it checks out whole.
    if (known && ours && known.branch === branch) {
      if (await siblingIntact(repository, known, branch)) return;
      // Only a locked (killed add) or vanished checkout is partial; anything else holds changes.
      if (!known.locked && !known.missing)
        throw new Error(`Worktree is not a clean checkout of ${branch}: ${path}`);
      await removeBrokenSibling(repository, path, branch, input.base);
    } else if (known) throw new Error(`Worktree folder already registered: ${path}`);
    else if (ours) await removeBrokenSibling(repository, path, branch, input.base);
    if ((await creationRevision(repository, `refs/heads/${branch}`)) !== null)
      throw new Error(`Branch ${branch} already exists in ${repository}`);
    if (
      await lstat(path).then(
        () => true,
        () => false,
      )
    )
      throw new Error(`Worktree folder already exists: ${path}`);
    await mkdir(dirname(path), { recursive: true });
    const record = { repository, path, branch, base: input.base };
    if (!ours) input.journal.push(record);
    await input.persist?.(record);
    try {
      await hostGitExec.exec("git", ["worktree", "add", "-b", branch, "--", path, input.base], {
        ...options(repository, true),
        signal: observer.signal,
      });
    } finally {
      invalidateHostWorktrees(repository);
    }
  });
}

/** Whole, unlocked, clean checkout of `branch`: what a finished `worktree add` leaves behind. */
async function siblingIntact(repository: string, tree: HostWorktree, branch: string) {
  if (tree.locked || tree.missing) return false;
  try {
    const tip = await creationRevision(repository, `refs/heads/${branch}`);
    const head = (await creationGit(tree.path, ["rev-parse", "--verify", "HEAD"])).stdout.trim();
    const symbolic = (
      await creationGit(tree.path, ["symbolic-ref", "--quiet", "HEAD"])
    ).stdout.trim();
    const status = (await creationGit(tree.path, ["status", "--porcelain"])).stdout.trim();
    return tip !== null && head === tip && symbolic === `refs/heads/${branch}` && status === "";
  } catch {
    return false;
  }
}

/** Removes an earlier attempt's worktree even when a killed add left it locked, then its branch. */
async function removeBrokenSibling(repository: string, path: string, branch: string, base: string) {
  try {
    await clearBrokenCheckout(repository, path);
    // A branch that moved off its creation commit holds someone's work: keep it, the add then refuses.
    if ((await creationRevision(repository, `refs/heads/${branch}`)) === base)
      await creationGit(repository, ["branch", "-D", "--", branch]);
  } finally {
    invalidateHostWorktrees(repository);
  }
}

/** `worktree remove -f -f` overrides the lock a killed `worktree add` leaves; prune drops dangling rows. */
async function clearBrokenCheckout(repository: string, path: string) {
  try {
    await creationGit(repository, ["worktree", "prune"]).catch(() => undefined);
    const listed = parse((await creationGit(repository, LIST_ARGS)).stdout);
    if (
      listed.some((tree) => !tree.isMain && workspacePathKey(tree.path) === workspacePathKey(path))
    )
      await creationGit(repository, ["worktree", "remove", "-f", "-f", "--", path]);
    await creationGit(repository, ["worktree", "prune"]).catch(() => undefined);
  } finally {
    invalidateHostWorktrees(repository);
  }
}

/**
 * Forced removal is only for a checkout a killed `worktree add` left locked; anything else must
 * be clean, so work someone put there is never destroyed by a rollback.
 */
async function removeOwnedWorktree(repository: string, registered: HostWorktree): Promise<void> {
  if (registered.locked) {
    await creationGit(repository, ["worktree", "remove", "-f", "-f", "--", registered.path]);
    return;
  }
  if (registered.missing) return;
  const status = await creationGit(registered.path, ["status", "--porcelain"]).then(
    ({ stdout }) => stdout.trim(),
    () => "unreadable",
  );
  if (status) throw new Error(`Worktree has uncommitted changes and was kept: ${registered.path}`);
  await creationGit(repository, ["worktree", "remove", "--", registered.path]);
}

/**
 * Removes one journaled sibling worktree and its branch. Only a clean (or lock-partial) checkout
 * is removed and the branch only while it still sits at the commit it was created at.
 */
export async function rollbackExtraWorktree(record: ExtraWorktreeRecord): Promise<void> {
  await withHostGitMutation(record.repository, async () => {
    try {
      const listed = parse((await creationGit(record.repository, LIST_ARGS)).stdout);
      const registered = listed.find(
        (tree) => workspacePathKey(tree.path) === workspacePathKey(record.path),
      );
      if (registered && !registered.isMain && registered.branch === record.branch)
        await removeOwnedWorktree(record.repository, registered);
      await creationGit(record.repository, ["worktree", "prune"]).catch(() => undefined);
      const tip = await creationRevision(record.repository, `refs/heads/${record.branch}`);
      if (tip !== null && record.base !== undefined && tip === record.base)
        await creationGit(record.repository, ["branch", "-D", "--", record.branch]);
    } finally {
      invalidateHostWorktrees(record.repository);
    }
  });
}

/**
 * Removes a primary workspace whose creation failed definitively or was cancelled: its worktree
 * (when Git registered it at the planned path on the planned branch), its branch (only while the
 * owner marker proves this workspace made it and no commit moved it) and the marker.
 */
export async function rollbackManagedWorkspaceGit(
  cwd: string,
  workspace: ManagedWorkspace,
): Promise<void> {
  const marker = `refs/bycoda/workspaces/${workspace.id}`;
  const branch = workspace.branchRef.replace(/^refs\/heads\//, "");
  try {
    const listed = parse((await creationGit(cwd, LIST_ARGS)).stdout);
    const registered = listed.find(
      (tree) => workspacePathKey(tree.path) === workspacePathKey(workspace.path),
    );
    if (registered && !registered.isMain && registered.branch === branch)
      await removeOwnedWorktree(cwd, registered);
    await creationGit(cwd, ["worktree", "prune"]).catch(() => undefined);
    if ((await creationRevision(cwd, marker)) === workspace.baseCommit) {
      if ((await creationRevision(cwd, workspace.branchRef)) === workspace.baseCommit)
        await creationGit(cwd, ["branch", "-D", "--", branch]);
      await creationGit(cwd, ["update-ref", "-d", marker]);
    }
  } finally {
    invalidateHostWorktrees(cwd);
  }
}

/**
 * Removes a retired workspace's sibling worktree (its branch stays, like the primary's). Refuses
 * a locked, re-pointed or dirty checkout; an already absent one counts as removed. Idempotent.
 */
export async function removeSiblingWorktree(record: ExtraWorktreeRecord): Promise<void> {
  await withHostGitMutation(record.repository, async () => {
    try {
      const blocker = await siblingBlocker(record);
      if (blocker) throw new Error(blocker);
      const listed = parse((await creationGit(record.repository, LIST_ARGS)).stdout);
      const registered = listed.find(
        (tree) => workspacePathKey(tree.path) === workspacePathKey(record.path),
      );
      if (registered && !registered.missing)
        await creationGit(record.repository, ["worktree", "remove", "--", record.path]);
      await creationGit(record.repository, ["worktree", "prune"]).catch(() => undefined);
    } finally {
      invalidateHostWorktrees(record.repository);
    }
  });
}

/** Why a sibling worktree cannot be removed now, or null when it is safe (or already gone). */
export async function siblingBlocker(record: ExtraWorktreeRecord): Promise<string | null> {
  const listed = parse((await creationGit(record.repository, LIST_ARGS)).stdout);
  const registered = listed.find(
    (tree) => workspacePathKey(tree.path) === workspacePathKey(record.path),
  );
  if (!registered) {
    const present = await lstat(record.path).then(
      () => true,
      () => false,
    );
    return present ? `Repository worktree is not registered: ${record.path}` : null;
  }
  if (registered.isMain || registered.branch !== record.branch || registered.locked)
    return `Repository worktree changed or is locked: ${record.path}`;
  if (registered.missing) return null;
  const status = await creationGit(record.path, ["status", "--porcelain"]).then(
    ({ stdout }) => stdout.trim(),
    () => "unreadable",
  );
  return status ? `Repository worktree has uncommitted changes: ${record.path}` : null;
}

/** Startup, best effort: fetch landing refs a crash left behind. */
export async function deleteStaleFetchRefs(cwd: string): Promise<void> {
  const refs = (
    await creationGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/bycoda/fetch/"])
  ).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const ref of refs) await creationGit(cwd, ["update-ref", "-d", ref]);
}
