import {
  notifyGitChanged,
  setRemoteCommandRunner,
  type FolderListing,
} from "../../../platform/tauri/fs";
import { notifyDirsChanged } from "../../files/model/fileTree";
import { remoteMachineFor, remoteRequest } from "./connections";
import { subscribeRemoteRecovered } from "./remoteHealth";
import { parseRemotePath, remotePath } from "./remoteProjects";

/** File commands a connected machine answers exactly as this computer does
 * (see host/workspace-commands.ts). */
export const HOST_COMMANDS = new Set([
  "session_checkpoint_status",
  "session_checkpoint_file_diff",
  "session_checkpoint_undo",
  "session_checkpoint_keep",
  "list_dir",
  "browse_dir",
  "list_project_files",
  "read_text_file",
  "format_text_file",
  "read_binary_file",
  "read_file_info",
  "read_folder_entry",
  "read_file_chunk",
  "read_file_preview",
  "write_text_file",
  "stat_files",
  "create_path",
  "rename_path",
  "delete_path",
  "copy_path",
  "move_path",
  "git_diff_index",
  "git_diff_files",
  "git_diff_stats",
  "git_file_diff",
  "git_stage_contents",
  "git_stage_file",
  "git_unstage_file",
  "git_discard_file",
  "git_discard_all",
  "git_stage_all",
  "git_unstage_all",
  "git_commit",
  "git_head_message",
  "git_push",
  "git_pull",
  "git_sync",
  "git_pr_status",
  "git_pr_create",
  "git_history",
  "git_commit_files",
  "git_commit_message",
  "git_commit_file_diff",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_checkout",
  "git_create_branch",
  // The `git.actions` set (host/git-actions.ts). Their results carry no host
  // paths: `git_conflicts` and the file arguments are repo-relative.
  "git_stash",
  "git_trust_repository",
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
  "git_worktrees",
  "git_submodules",
  "search_project",
  "list_skills",
  "list_claude_commands",
  "skill_export",
  "skill_delete",
  "skill_import",
]);
/** Arguments that hold paths; everything else is passed through untouched. */
const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];
/** Commands whose string result is a path. */
const PATH_RESULTS = new Set([
  "create_path",
  "rename_path",
  "copy_path",
  "move_path",
  "skill_import",
]);
/** Commands whose result entries carry a `path`. */
const ENTRY_RESULTS = new Set(["list_dir", "list_project_files", "stat_files", "list_skills"]);

const UNAVAILABLE = "This isn’t available for projects on another machine yet.";
const OUTDATED = "Update bycoda Host in Connections settings to use this project’s files.";
const OUTDATED_FOLDERS =
  "Update bycoda Host in Connections settings to browse folders outside projects.";
const OUTDATED_SKILLS =
  "The other machine’s bycoda Host needs updating to copy skills. Update it in Connections settings.";
const OUTDATED_SKILL_DELETE =
  "The other machine’s bycoda Host needs updating to delete skills. Update it in Connections settings.";

/** Runs a file command whose paths are `remote://` paths on the machine that
 * owns them, translating paths both ways so callers never see host paths. */
export function runRemoteCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  return runOnMachine(command, args);
}

/** Skill commands that need no project path: a machine's personal skills are
 * addressed by the machine alone (an empty `cwd` means "no project"). */
const MACHINE_COMMANDS = new Set(["list_skills", "skill_export", "skill_import", "skill_delete"]);

/** Runs a skill command on a given machine without a project path, with the
 * same argument and result translation as `runRemoteCommand`. */
export function runMachineCommand(
  environmentId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!MACHINE_COMMANDS.has(command)) return Promise.reject(new Error(UNAVAILABLE));
  return runOnMachine(command, args, environmentId);
}

async function runOnMachine(
  command: string,
  args: Record<string, unknown>,
  addressed?: string,
): Promise<unknown> {
  if (!HOST_COMMANDS.has(command)) throw new Error(UNAVAILABLE);
  let environmentId: string | undefined = addressed;
  const toHost = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(toHost);
    if (typeof value !== "string") return value;
    // An empty path argument is "no path", not another machine's path.
    if (value === "") return value;
    const parsed = parseRemotePath(value);
    if (!parsed || (environmentId && parsed.environmentId !== environmentId))
      throw new Error("Files can only be copied or moved within one machine.");
    environmentId = parsed.environmentId;
    return parsed.hostPath;
  };
  const hostArgs = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      PATH_ARGS.includes(key)
        ? toHost(value)
        : key === "options" && value && typeof value === "object" && !Array.isArray(value)
          ? { ...value, cwd: toHost((value as Record<string, unknown>).cwd) }
          : value,
    ]),
  );
  if (!environmentId) throw new Error(UNAVAILABLE);
  const env = environmentId;
  if (command === "list_skills" && Array.isArray(args.disabledPaths)) {
    // Settings contain paths for every machine. Only this host's identities
    // belong in its discovery request, before same-name deduplication.
    hostArgs.disabledPaths = args.disabledPaths.flatMap((value) => {
      const parsed = typeof value === "string" ? parseRemotePath(value) : undefined;
      return parsed?.environmentId === env ? [parsed.hostPath] : [];
    });
  }
  const machine = await remoteMachineFor(env);
  if (!machine) throw new Error("This project’s machine isn’t connected on this computer.");
  let result: unknown;
  try {
    result = await remoteRequest(machine.id, "workspace.run", {
      command,
      args: hostArgs,
    });
  } catch (reason) {
    if (/Unsupported (host method|remote operation|workspace command)/i.test(String(reason)))
      throw new Error(
        command === "browse_dir"
          ? OUTDATED_FOLDERS
          : command === "skill_delete"
            ? OUTDATED_SKILL_DELETE
            : command.startsWith("skill_")
              ? OUTDATED_SKILLS
              : OUTDATED,
      );
    throw reason;
  }
  const fromHost = (path: string) => remotePath(env, path);
  if (
    ["session_checkpoint_status", "session_checkpoint_undo", "session_checkpoint_keep"].includes(
      command,
    ) &&
    result &&
    typeof result === "object"
  ) {
    const status = result as { files: { path: string }[] };
    return {
      ...status,
      files: status.files.map((file) => ({ ...file, path: fromHost(file.path) })),
    };
  }
  if (command === "session_checkpoint_file_diff" && result && typeof result === "object") {
    const diff = result as { path: string };
    return { ...diff, path: fromHost(diff.path) };
  }
  if (command === "browse_dir" && result && typeof result === "object") {
    const folder = result as FolderListing;
    return {
      ...folder,
      path: fromHost(folder.path),
      parent: folder.parent === null ? null : fromHost(folder.parent),
      entries: folder.entries.map((entry) => ({ ...entry, path: fromHost(entry.path) })),
    };
  }
  if (PATH_RESULTS.has(command) && typeof result === "string") return fromHost(result);
  if (ENTRY_RESULTS.has(command) && Array.isArray(result))
    return result.map((entry: { path: string }) => ({
      ...entry,
      path: fromHost(entry.path),
    }));
  if (
    (command === "git_diff_index" || command === "git_diff_files") &&
    result &&
    typeof result === "object"
  ) {
    const index = result as { files: { path: string }[]; conflicts?: { path: string }[] };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    const withHostPath = (file: { path: string }) => ({
      ...file,
      path: fromHost(`${root}/${file.path}`),
    });
    return {
      ...index,
      files: index.files.map(withHostPath),
      // Absent from a host that predates conflict info.
      ...(index.conflicts ? { conflicts: index.conflicts.map(withHostPath) } : {}),
    };
  }
  if (
    (command === "git_file_diff" || command === "git_conflict_stages") &&
    result &&
    typeof result === "object"
  ) {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "git_commit_files" && Array.isArray(result)) {
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return result.map((file: { path: string }) => ({
      ...file,
      path: fromHost(`${root}/${file.path}`),
    }));
  }
  if (command === "git_commit_file_diff" && result && typeof result === "object") {
    const diff = result as { path: string };
    const root = String(hostArgs.cwd).replace(/[\\/]+$/, "");
    return { ...diff, path: fromHost(`${root}/${diff.path}`) };
  }
  if (command === "search_project" && result && typeof result === "object") {
    const search = result as { matches: { path: string }[] };
    return {
      ...search,
      matches: search.matches.map((match) => ({ ...match, path: fromHost(match.path) })),
    };
  }
  if (command === "git_worktrees" && result && typeof result === "object") {
    const worktrees = result as { defaultRoot: string; worktrees: { path: string }[] };
    return {
      ...worktrees,
      defaultRoot: fromHost(worktrees.defaultRoot),
      worktrees: worktrees.worktrees.map((tree) => ({ ...tree, path: fromHost(tree.path) })),
    };
  }
  return result;
}

setRemoteCommandRunner(runRemoteCommand);
// When a machine comes back, every view of it reloads at once.
subscribeRemoteRecovered(() => {
  notifyGitChanged();
  notifyDirsChanged();
});
