import { hostGitExec } from "./git-exec-pool";
import { StringDecoder } from "node:string_decoder";
import { hostGitRepositoryKey, withHostGitMutation } from "./git-mutations";
import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, open, readFile, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { WorktreeRemovalReview } from "../../src/features/source-control/model/worktrees";
import {
  entryMissing,
  inside,
  inventoryWorkspaceLinks,
  validateWorkspaceCleanupPaths,
} from "../workspaces/workspace-cleanup-paths";
import type {
  ManagedWorkspace,
  WorkspaceNames,
  WorkspaceOwner,
} from "../workspaces/workspace-contracts";
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
    await hostGitExec.exec("git", ["worktree", "add", "--", path, branch], options(cwd, true));
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
      const path = present ? await canonicalWorkspacePath(tree.path).catch(() => undefined) : undefined;
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

export function hostWorktrees(cwd: string, background = false): Promise<HostWorktrees> {
  return listCached(cwd, false, background ? "background" : "default");
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
  if (!/^mc\/[a-z0-9]{8}$/.test(expectedBranch))
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
