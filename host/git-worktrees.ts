import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ManagedWorkspace, WorkspaceNames, WorkspaceOwner } from "./workspace-contracts";

const options = (cwd: string, mutation = false) => ({
  cwd,
  windowsHide: true,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  timeout: mutation ? 120_000 : 10_000,
  maxBuffer: 1024 * 1024,
});

/** Stable names are allocated before execution and never renamed by title generation. */
export function managedWorkspaceNames(owner: WorkspaceOwner, slug: string, id: string) {
  if (!/^[a-zA-Z0-9-]{12,}$/.test(id)) throw new Error("Invalid workspace identity");
  const short = id.replaceAll("-", "").slice(0, 12).toLowerCase();
  if (short.length !== 12) throw new Error("Invalid workspace identity");
  const name =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64)
      .replace(/-$/, "") || "work";
  return {
    branch: `bycoda/${owner.kind === "task" ? "t" : "s"}/${name}-${short}`,
    directory: `wt-${short}`,
  };
}

/** S1 portion of the frozen naming service; S2 supplies turnRef and rewindRef. */
export const workspaceNames: Pick<WorkspaceNames, "branch" | "directory"> = {
  branch(owner, slug, id) {
    return managedWorkspaceNames(owner, slug, id).branch as ReturnType<WorkspaceNames["branch"]>;
  },
  directory(id) {
    return managedWorkspaceNames({ kind: "session", id: "naming" }, "work", id)
      .directory as ReturnType<WorkspaceNames["directory"]>;
  },
};

export async function managedWorkspaceBase(cwd: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
    throw new Error("Invalid committed workspace base");
  return (
    await exec(
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
  return canonicalDirectory(root);
}

async function canonicalDirectory(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw error;
    return join(await canonicalDirectory(dirname(path)), basename(path));
  }
}

/** Caller holds the common-repository mutation gate and a durable operation reservation. */
export async function materializeManagedWorkspace(
  cwd: string,
  workspace: ManagedWorkspace,
  creating: boolean,
): Promise<void> {
  const path = resolve(workspace.path);
  if ((await hostGitRepositoryKey(cwd)) !== workspace.repositoryId)
    throw new Error("Managed project repository identity changed");
  if ((await canonicalDirectory(dirname(path))) !== dirname(path))
    throw new Error("Managed workspace root changed");
  await mkdir(dirname(path), { recursive: true });
  if ((await realpath(dirname(path))) !== dirname(path))
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
      await new Promise<void>((done, reject) => {
        const child = spawn("git", ["update-ref", "--stdin"], {
          ...options(cwd, true),
          stdio: ["pipe", "ignore", "pipe"],
        });
        let error = "";
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          error += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? done()
            : reject(new Error(`Workspace branch reservation failed: ${error.slice(0, 2000)}`)),
        );
        child.stdin.on("error", reject);
        child.stdin.end(input);
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
    const actual = (await exec("git", ["symbolic-ref", "HEAD"], options(path))).stdout.trim();
    if (actual !== workspace.branchRef) throw new Error("Managed workspace branch changed");
    if (creating && (await managedWorkspaceBase(path, "HEAD")) !== workspace.baseCommit)
      throw new Error("Managed workspace HEAD changed during creation");
  };
  const registered = listed.worktrees.find((tree) => resolve(tree.path) === path);
  if (registered) {
    if (registered.isMain || registered.branch !== branch || registered.missing || !info)
      throw new Error("Managed worktree registration changed");
    await verify();
    return;
  }
  if (info) throw new Error("Managed workspace directory already exists without registration");
  if (listed.worktrees.some((tree) => tree.branch === branch))
    throw new Error("Managed branch is checked out elsewhere");
  try {
    await exec("git", ["worktree", "add", "--", path, branch], options(cwd, true));
    await verify();
  } finally {
    invalidateHostWorktrees();
  }
}

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

function build(text: string): HostWorktrees {
  const worktrees = parse(text).map((tree) => ({
    ...tree,
    path: available(tree.path) ? realpathSync.native(tree.path) : tree.path,
    missing: !available(tree.path),
  }));
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

/** One `git worktree list` at a time per project, reused for a few seconds. */
function listCached(cwd: string, force = false): Promise<HostWorktrees> {
  const hit = force ? undefined : fresh(cwd);
  if (hit) return hit.promise;
  const entry: CachedList = {
    at: Date.now(),
    generation: listGeneration,
    promise: exec("git", LIST_ARGS, options(cwd)).then(({ stdout }) => {
      const value = build(stdout);
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

function listSync(cwd: string, force = false): HostWorktrees {
  const hit = force ? undefined : fresh(cwd);
  if (hit?.value) return hit.value;
  const value = build(execFileSync("git", LIST_ARGS, { ...options(cwd), encoding: "utf8" }));
  remember(cwd, {
    at: Date.now(),
    generation: listGeneration,
    promise: Promise.resolve(value),
    value,
  });
  return value;
}

/** The real path of a requested working copy, or null for the project itself. */
function requestedPath(projectCwd: string, requested: unknown): string | null {
  if (requested == null || requested === "" || requested === projectCwd) return null;
  if (typeof requested !== "string" || requested.includes("\0") || requested.length > 4096)
    throw new Error("Invalid working copy");
  const actual = available(requested) ? realpathSync.native(requested) : requested;
  return actual === projectCwd ? null : actual;
}

export function resolveHostWorktree(projectCwd: string, requested: unknown): string {
  const actual = requestedPath(projectCwd, requested);
  if (actual === null) return projectCwd;
  const find = (listed: HostWorktrees) => listed.worktrees.find((tree) => tree.path === actual);
  // A cached list may predate a worktree made outside this host: look again
  // before refusing.
  const target = find(listSync(projectCwd)) ?? find(listSync(projectCwd, true));
  if (!target || !available(target.path))
    throw new Error("Choose an available worktree of this project");
  return realpathSync.native(target.path);
}

export async function resolveHostWorktreeAsync(
  projectCwd: string,
  requested: unknown,
): Promise<string> {
  const actual = requestedPath(projectCwd, requested);
  if (actual === null) return projectCwd;
  const ok = (listed: HostWorktrees) =>
    listed.worktrees.some((tree) => tree.path === actual && !tree.missing) && available(actual);
  if (ok(await listCached(projectCwd))) return actual;
  if (ok(await listCached(projectCwd, true))) return actual;
  throw new Error("Choose an available worktree of this project");
}

export function hostWorktrees(cwd: string): Promise<HostWorktrees> {
  return listCached(cwd);
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
  await exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  if (typeof base !== "string" || base.length > 255 || typeof existing !== "boolean")
    throw new Error("Invalid worktree base");
  const listed = await listCached(cwd, true);
  if (listed.worktrees.some((tree) => tree.branch === branch))
    throw new Error("This branch already has a working copy. Select it from the picker.");
  const slug = `wt-${branch.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const path = join(listed.defaultRoot, slug);
  if (existsSync(path)) throw new Error(`${path} already exists. Choose another branch name.`);
  const refs = (
    await exec(
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
    await exec(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${source}^{commit}`],
      options(sourceCwd),
    )
  ).stdout.trim();
  await mkdir(listed.defaultRoot, { recursive: true });
  invalidateHostWorktrees(cwd);
  try {
    if (existing) await exec("git", ["worktree", "add", "--", path, branch], options(cwd, true));
    else
      await exec(
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
  if (!/^mc\/[a-z0-9]{8}$/.test(expectedBranch))
    throw new Error("This is not an automatically created worktree branch");
  if (!branch || branch.length > 120 || branch.startsWith("-") || branch.startsWith("@"))
    throw new Error("Enter a valid branch name");
  await exec("git", ["check-ref-format", "--branch", branch], options(cwd));
  const tree = (await listCached(cwd, true)).worktrees.find(
    (entry) => entry.path === path && !entry.missing,
  );
  if (!tree || tree.isMain || tree.branch !== expectedBranch)
    throw new Error("The worktree branch has changed");
  if (branch === expectedBranch) return tree;
  if (!(await stillOwned())) throw new Error("The session no longer owns this branch");
  invalidateHostWorktrees(cwd);
  try {
    await exec("git", ["branch", "-m", expectedBranch, branch], options(tree.path));
  } finally {
    invalidateHostWorktrees(cwd);
  }
  const renamed = (await listCached(cwd, true)).worktrees.find((entry) => entry.path === path);
  if (!renamed) throw new Error("Branch renamed, but its worktree could not be found");
  return renamed;
}
