import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  nestedRepositoryCandidates,
  type RepositoryDiscoveryLimit,
} from "./git-repository-discovery";

const MAX_SUBMODULES = 256;

async function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  if (timeout <= 0) throw new Error("Repository discovery timed out");
  const { stdout } = await exec("git", ["--no-pager", ...args], {
    cwd,
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

/** Repository paths relative to the checkout, and the size bound that cut a scan short, if any. */
export type HostGitSubmodules = { paths: string[]; limit: RepositoryDiscoveryLimit | null };

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
    for (const candidate of discovery.repositories) {
      const child = await realpath(candidate);
      const rel = relative(root, child);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || seen.has(child))
        continue;
      const top = await git(child, ["rev-parse", "--show-toplevel"], remaining());
      if ((await realpath(top.trim())) !== child) continue;
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
