import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { withHostGitMutation } from "./git-mutations";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const options = (cwd: string, mutation = false) => ({
  cwd,
  windowsHide: true,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  timeout: mutation ? 120_000 : 10_000,
  maxBuffer: 1024 * 1024,
});

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
