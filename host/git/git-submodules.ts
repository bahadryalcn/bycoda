import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { hostGitExec } from "./git-exec-pool";
import {
  discoveryCommandError,
  execFilesOffThread,
  nestedRepositoryCandidates,
  type RepositoryDiscoveryLimit,
} from "./git-repository-discovery";

const MAX_SUBMODULES = 256;
const GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };

async function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  if (timeout <= 0) throw new Error("Repository discovery timed out");
  const { stdout } = await hostGitExec.exec("git", ["--no-pager", ...args], {
    lane: "background",
    cwd,
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
    env: GIT_ENV,
  });
  return stdout;
}

/** Repository paths relative to the checkout, and the size bound that cut a scan short, if any. */
export type HostGitSubmodules = { paths: string[]; limit: RepositoryDiscoveryLimit | null };

const SHARED_TTL_MS = 2 * 60_000;
const SHARED_LIMIT = 64;
const shared = new Map<
  string,
  { at: number; scan: Promise<HostGitSubmodules>; refreshing: boolean }
>();

/**
 * One discovery per checkout for all connections, reused for a while. Every client rescans on
 * Git changes while agents commit, and each scan starts a Git command per candidate and
 * PowerShell on Windows. An explicit refresh asks `fresh`. Failures are not reused.
 */
export function sharedHostGitSubmodules(
  cwd: string,
  includeRepositories: boolean,
  fresh = false,
): Promise<HostGitSubmodules> {
  const key = `${includeRepositories}:${cwd}`;
  const hit = shared.get(key);
  if (hit && (hit.refreshing || (!fresh && elapsedSince(hit.at) < SHARED_TTL_MS))) return hit.scan;
  const scan = hostGitSubmodules(cwd, includeRepositories);
  const entry = { at: monotonicNow(), scan, refreshing: fresh };
  shared.delete(key);
  shared.set(key, entry);
  while (shared.size > SHARED_LIMIT) shared.delete(shared.keys().next().value as string);
  void scan.then(
    () => {
      entry.refreshing = false;
    },
    () => {
      if (shared.get(key) === entry) shared.delete(key);
    },
  );
  return scan;
}

/**
 * True when the directory's `.git` is a file pointing into `<common dir>/worktrees/<name>`, which
 * is how Git links any worktree (of this repository or another) to its repository. Submodules
 * point into `modules/` and independent repositories have a `.git` directory.
 */
async function isLinkedWorktree(directory: string): Promise<boolean> {
  const text = await readFile(join(directory, ".git"), "utf8").catch(() => "");
  const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!gitdir) return false;
  const target = resolve(directory, gitdir).split(sep).join("/");
  return /\/worktrees\/[^/]+\/?$/i.test(target);
}

/** Initialized gitlinks by default; opt-in source repositories. Never clones or moves a checkout. */
export async function hostGitSubmodules(
  cwd: string,
  includeRepositories = false,
  maxPaths = MAX_SUBMODULES,
): Promise<HostGitSubmodules> {
  const startedAt = monotonicNow();
  const remaining = () => Math.floor(Math.max(0, 15_000 - elapsedSince(startedAt)));
  const root = await realpath(cwd);
  const queue = [root];
  const seen = new Set([root]);
  const paths: string[] = [];
  let limit: RepositoryDiscoveryLimit | null = null;
  gitlinks: for (let index = 0; index < queue.length; index++) {
    const parent = queue[index];
    // Listing the whole index only to find gitlinks is slow on large checkouts; a checkout
    // without `.gitmodules` registers no submodules (source repositories are found below).
    if (!(await stat(join(parent, ".gitmodules")).catch(() => null))) continue;
    const entries = await git(parent, ["ls-files", "--stage", "-z", "--", "."], remaining()).catch(
      (error: { stderr?: unknown }) => {
        // A plain folder has no gitlinks, but may still hold source repositories.
        if (parent === root && /not a git repository/i.test(String(error?.stderr ?? error)))
          return "";
        throw error;
      },
    );
    for (const entry of entries.split("\0")) {
      const tab = entry.indexOf("\t");
      if (tab < 0 || !/^160000 [a-f0-9]+ [0-3]$/.test(entry.slice(0, tab))) continue;
      const path = entry.slice(tab + 1);
      const child = await realpath(join(parent, path)).catch(() => null);
      if (!child || seen.has(child)) continue;
      const rel = relative(root, child);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      // Uninitialized submodules otherwise inherit their parent's repository.
      if (!(await stat(join(child, ".git")).catch(() => null))) continue;
      const top = await git(child, ["rev-parse", "--show-toplevel"], remaining());
      if ((await realpath(top.trim())) !== child) continue;
      if (paths.length >= maxPaths) {
        // Keep what was verified; the caller shows the list as limited.
        limit = "repositories";
        break gitlinks;
      }
      seen.add(child);
      paths.push(rel.split(sep).join("/"));
      queue.push(child);
    }
  }
  if (includeRepositories) {
    const discovery = await nestedRepositoryCandidates(root, remaining);
    limit ??= discovery.limit;
    const children: string[] = [];
    // A linked worktree is another checkout, not a repository of this one; nothing inside it counts.
    const worktrees: string[] = [];
    for (const candidate of discovery.repositories)
      if (await isLinkedWorktree(candidate)) worktrees.push(await realpath(candidate));
    for (const candidate of discovery.repositories) {
      const child = await realpath(candidate);
      if (worktrees.some((tree) => child === tree || child.startsWith(tree + sep))) continue;
      const rel = relative(root, child);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || seen.has(child))
        continue;
      children.push(child);
    }
    const timeout = remaining();
    if (timeout <= 0 && children.length) throw new Error("Repository discovery timed out");
    const tops = await execFilesOffThread(
      children.map((child) => ({
        file: "git",
        args: ["--no-pager", "rev-parse", "--show-toplevel"],
        cwd: child,
        env: GIT_ENV,
      })),
      timeout,
    );
    for (const [index, child] of children.entries()) {
      const top = tops[index];
      if ("failure" in top) throw discoveryCommandError("git", top.failure);
      if ((await realpath(top.stdout.trim())) !== child) continue;
      const rel = relative(root, child);
      if (paths.length >= maxPaths) {
        limit = "repositories";
        break;
      }
      seen.add(child);
      paths.push(rel.split(sep).join("/"));
    }
  }
  return { paths: paths.sort(), limit };
}
