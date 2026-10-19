import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const active = new AsyncLocalStorage<string>();
const tails = new Map<string, Promise<unknown>>();
// Serialize only admission, not work. This preserves request order even when
// resolving a junction/worktree path is slower than resolving the next request.
let admission: Promise<unknown> = Promise.resolve();

async function repositoryKey(cwd: string): Promise<string> {
  const root = await realpath(cwd);
  let directory = root;
  for (;;) {
    const marker = join(directory, ".git");
    const info = await stat(marker).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      return null;
    });
    if (info) {
      let gitDir = marker;
      if (!info.isDirectory()) {
        const target = (await readFile(marker, "utf8")).match(/^gitdir:\s*(.+)/)?.[1]?.trim();
        if (!target) throw new Error("Invalid Git directory pointer");
        gitDir = resolve(directory, target);
      }
      const common = await readFile(join(gitDir, "commondir"), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        },
      );
      const canonical = await realpath(common ? resolve(gitDir, common.trim()) : gitDir);
      return process.platform === "win32" ? canonical.toLowerCase() : canonical;
    }
    const parent = dirname(directory);
    if (parent === directory) return process.platform === "win32" ? root.toLowerCase() : root;
    directory = parent;
  }
}

/** Serialize complete mutations across API clients and repository aliases.
 * Nested calls (sync -> push, command dispatch -> stage) retain the same lease. */
export async function withHostGitMutation<T>(
  cwd: string,
  work: () => Promise<T>,
  queueTimeoutMs = 120_000,
): Promise<T> {
  const admitted = admission.then(async () => {
    const key = await repositoryKey(cwd);
    if (active.getStore() === key) return { pending: work() };
    let expired = false;
    const timeoutError = () =>
      new Error(
        "Another Git operation is still running. Refresh and retry; this queued operation was not executed.",
      );
    let timer: ReturnType<typeof setTimeout>;
    const waiting = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(timeoutError());
      }, queueTimeoutMs);
    });
    const run = () => {
      clearTimeout(timer);
      if (expired) throw timeoutError();
      return active.run(key, work);
    };
    const pending = (tails.get(key) ?? Promise.resolve()).then(run, run);
    tails.set(key, pending);
    const release = () => {
      if (tails.get(key) === pending) tails.delete(key);
    };
    void pending.then(release, release);
    return { pending: Promise.race([pending, waiting]) };
  });
  admission = admitted.then(
    () => undefined,
    () => undefined,
  );
  return (await admitted).pending;
}

const READ_COMMANDS = new Set([
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_staged_context",
  "git_head_message",
  "git_range_context",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_branches",
  "git_worktrees",
  "git_submodules",
  "git_pr_status",
  "git_operation_state",
  "git_operation_status",
  "git_conflicts",
  "git_conflict_stages",
  "git_stash_list",
  "git_tags",
  "git_remotes",
  "git_file_history",
  "git_blame",
  "git_commit_message",
]);

export const isHostGitMutation = (command: string) =>
  command.startsWith("git_") && !READ_COMMANDS.has(command);
