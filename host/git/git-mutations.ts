import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const active = new AsyncLocalStorage<string>();
const tails = new Map<string, Promise<unknown>>();
export type GitMutationScope = "local" | "fetch" | "exclusive";

/** These legacy commands must not bypass managed workspace review/receipts. */
export const isBranchDeliveryCommand = (command: string) =>
  ["git_merge", "git_push", "git_sync", "git_pr_create"].includes(command);

export const isManagedWorkspaceBranch = (reference: unknown): reference is string =>
  typeof reference === "string" && /^(?:refs\/heads\/)?bycoda\/[st]\//.test(reference);

export const MANAGED_DELIVERY_REVIEW_REQUIRED =
  "Managed workspace delivery requires a fresh review plan and authenticated owner approval. Use workspaces.delivery.review, then workspaces.delivery.merge or workspaces.delivery.publish.";
const LOCAL_MUTATIONS = new Set([
  "git_commit",
  "git_stage_file",
  "git_stage_files",
  "git_stage_contents",
  "git_stage_all",
  "git_unstage_file",
  "git_unstage_files",
  "git_unstage_all",
]);

/** Only index writes/commit can overlap fetch; ref/worktree changes fence both. */
export function gitMutationScope(command: string): GitMutationScope {
  if (command === "git_fetch") return "fetch";
  return LOCAL_MUTATIONS.has(command) ? "local" : "exclusive";
}
// Serialize only admission, not work. This preserves request order even when
// resolving a junction/worktree path is slower than resolving the next request.
let admission: Promise<unknown> = Promise.resolve();

export async function hostGitRepositoryKey(cwd: string): Promise<string> {
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

/** The canonical common Git directory of the currently admitted mutation. */
export const currentHostGitRepository = () => active.getStore();

/** Serialize complete mutations across API clients and repository aliases.
 * Fetch and index/commit have separate lanes; exclusive work fences both.
 * Nested calls (sync -> push, command dispatch -> stage) retain the same lease. */
export async function withHostGitMutation<T>(
  cwd: string,
  work: () => Promise<T>,
  queueTimeoutMs = 120_000,
  scope: GitMutationScope = "exclusive",
): Promise<T> {
  const admitted = admission.then(async () => {
    const key = await hostGitRepositoryKey(cwd);
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
    const lanes =
      scope === "exclusive" ? [key, `${key}\0fetch`] : [scope === "fetch" ? `${key}\0fetch` : key];
    const previous = Promise.all(
      lanes.map((lane) => (tails.get(lane) ?? Promise.resolve()).catch(() => undefined)),
    );
    const pending = previous.then(run);
    for (const lane of lanes) tails.set(lane, pending);
    const release = () => {
      for (const lane of lanes) if (tails.get(lane) === pending) tails.delete(lane);
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
  "git_management_snapshot",
  "git_pr_destination",
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
