import { invoke as invokeLocal } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { withGithubRead } from "../../shared/lib/githubReadGate";
import { open } from "@tauri-apps/plugin-dialog";
import { parentPath, slash, joinPath } from "../../shared/lib/paths";
import { REMOTE_PATH_PREFIX } from "../../shared/lib/remotePaths";
import { localExplorerPath } from "../../shared/lib/remoteExplorerPaths";
import type { InterjectionMeta } from "../../features/sessions/model/session";

export { REMOTE_PATH_PREFIX } from "../../shared/lib/remotePaths";

/** Read only a project-contained image; the backend checks symlink containment. */
export async function readProjectImage(root: string, path: string): Promise<Uint8Array> {
  const bytes = root.startsWith(REMOTE_PATH_PREFIX)
    ? await readBinaryFile(joinPath(root, path))
    : new Uint8Array(await invokeLocal<ArrayBuffer>("read_project_image", { root, path }));
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Document image exceeds 20 MB");
  return bytes;
}

type RemoteCommandRunner = (command: string, args: Record<string, unknown>) => Promise<unknown>;
let remoteRunner: RemoteCommandRunner | undefined;

/** Set once by the connections feature, which knows the connected machines. */
export function setRemoteCommandRunner(runner: RemoteCommandRunner) {
  remoteRunner = runner;
}

/** Watches a remote checkout's `.git` through its machine; returns the release. */
type RemoteGitWatcher = (
  cwd: string,
  report: (index: boolean, refs: boolean) => void,
  setWatching: (on: boolean) => void,
) => () => void;
let remoteGitWatcher: RemoteGitWatcher | undefined;

/** Set once by the connections feature, which can reach the host's `.git` watcher. */
export function setRemoteGitWatcher(watcher: RemoteGitWatcher) {
  remoteGitWatcher = watcher;
}

const isRemotePath = (value: unknown): boolean =>
  typeof value === "string"
    ? value.startsWith(REMOTE_PATH_PREFIX)
    : Array.isArray(value) && value.some(isRemotePath);
const PATH_ARGS = ["path", "cwd", "parent", "from", "destParent", "paths"];

/** Runs a command on the machine that owns its paths, so the same file and
 * Git UI works for a local project and one on a connected machine. */
export function invokeWorkspace<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const options = args?.options;
  const remoteOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? isRemotePath((options as Record<string, unknown>).cwd)
      : false;
  if (args && (PATH_ARGS.some((key) => isRemotePath(args[key])) || remoteOptions)) {
    if (!remoteRunner)
      return Promise.reject(new Error("Connect this project’s machine to open its files."));
    return remoteRunner(command, args) as Promise<T>;
  }
  return invokeLocal<T>(command, args);
}

const invoke = invokeWorkspace;

export type OmpInterjectionAnchor = InterjectionMeta & {
  id: string;
  afterAssistantText: string;
  /** One-based occurrence among assistant messages with exactly this text. */
  afterOccurrence: number;
  /** Direct-concat live representation, with its own exact-text occurrence. */
  afterAssistantTextConcat?: string;
  afterConcatOccurrence?: number;
  text: string;
  /** Full text of a directly following text-only answer, if present. */
  followingAssistantText?: string | null;
  followingAssistantTextConcat?: string | null;
};

export function ompSessionInterjections(
  providerSessionId: string,
): Promise<OmpInterjectionAnchor[]> {
  return invoke<OmpInterjectionAnchor[]>("omp_session_interjections", {
    providerSessionId,
  });
}

/** One active-path assistant message in source order. Its newline and concat
 * representations are alternative forms of the same message, not two messages.
 */
export interface OmpAssistantText {
  text: string;
  concat: string;
}

export function ompActiveAssistantTexts(providerSessionId: string): Promise<OmpAssistantText[]> {
  return invoke<OmpAssistantText[]>("omp_active_assistant_texts", { providerSessionId });
}

export function claudeShellCommands(
  providerSessionId: string,
  providerAccountId: string | undefined,
  toolIds: string[],
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("claude_shell_commands", {
    providerSessionId,
    providerAccountId,
    toolIds,
  });
}

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  ignored: boolean;
};

export type ProjectLocation = {
  path: string;
  identity: string;
};

export function resolveProjectLocation(
  path: string,
  identity?: string,
): Promise<ProjectLocation | null> {
  return invoke<ProjectLocation | null>("resolve_project_location", {
    path,
    identity: identity ?? null,
  });
}

export function revokeFileAccess(path: string): Promise<void> {
  return invokeLocal<void>("revoke_file_access", { path });
}

export type ExternalEditor = {
  id: string;
  name: string;
};

export function listExternalEditors(): Promise<ExternalEditor[]> {
  return invoke<ExternalEditor[]>("list_external_editors");
}

export function openHtmlInChrome(path: string): Promise<void> {
  return invokeLocal<void>("open_html_in_chrome", { path });
}

export function openInExternalEditor(editorId: string, cwd: string): Promise<void> {
  return invoke<void>("open_in_external_editor", { editorId, cwd });
}

export type ProjectFile = {
  name: string;
  path: string;
  relative: string;
  isDir?: boolean;
};

/** A Claude Code conversation stored on disk for the current project. */
export type ClaudeSessionSummary = {
  id: string;
  path: string;
  title: string;
  updatedAt: number;
  messageCount: number;
};

/**
 * Conversations Claude Code recorded for this working directory, newest first.
 * Summarized in Rust: a single session file routinely runs past half a
 * megabyte, and reading a project's worth of them in the UI would stall it.
 */
export function claudeSessions(
  cwd: string,
  providerAccountId?: string,
): Promise<ClaudeSessionSummary[]> {
  return invoke<ClaudeSessionSummary[]>("claude_sessions", {
    cwd,
    providerAccountId: providerAccountId ?? null,
  });
}

export function listDir(path: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("list_dir", { path });
}

export type FolderListing = {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  /** Listing a folder does not grant access to its files in the editor. */
  canOpenFiles: boolean;
};

/** Owner-initiated folder navigation, including host paths outside projects. */
export async function browseDirectory(path: string, containing = false): Promise<FolderListing> {
  if (path.startsWith(REMOTE_PATH_PREFIX))
    return invoke<FolderListing>("browse_dir", { path, containing });
  const directory = containing && !(await isLocalDirectory(path)) ? parentPath(path) : path;
  const parent = parentPath(directory);
  return {
    path: directory,
    parent: parent === directory ? null : parent,
    entries: await listDir(directory),
    canOpenFiles: true,
  };
}

export type DiscoveredSkill = {
  name: string;
  description: string;
  path: string;
  scope: "project" | "user" | "builtin";
  source:
    | "agents"
    | "claude"
    | "cursor"
    | "codex"
    | "opencode"
    | "pi"
    | "omp"
    | "fx"
    | "grok"
    | "hermes"
    | "antigravity"
    | "bycoda";
};

export function listSkills(
  cwd: string,
  disabledPaths?: readonly string[] | null,
): Promise<DiscoveredSkill[]> {
  return invoke<DiscoveredSkill[]>("list_skills", {
    cwd,
    disabledPaths: disabledPaths ?? null,
  });
}

export type SkillFile = { path: string; data: string };
export type SkillBundle = { name: string; files: SkillFile[] };

/** Every file of a skill listed for `cwd`, on the machine that owns `path`. */
export function exportSkill(path: string, cwd: string): Promise<SkillBundle> {
  return invoke<SkillBundle>("skill_export", { path, cwd });
}

/** Deletes a listed skill's folder, including its supporting files. */
export function deleteSkill(path: string, cwd: string): Promise<void> {
  return invoke<void>("skill_delete", { path, cwd });
}

/** Writes a skill to `~/.agents/skills/<name>` on the machine `target` (a
 * project path, `remote://…` or empty for this computer) belongs to; resolves
 * to the SKILL.md path. Fails with `SKILL_EXISTS:` unless `overwrite`. */
export function importSkill(
  target: string,
  payload: SkillBundle,
  overwrite: boolean,
): Promise<string> {
  return invoke<string>("skill_import", {
    cwd: target,
    name: payload.name,
    files: payload.files,
    overwrite,
  });
}

export type ClaudeCommandEntry = {
  name: string;
  description: string;
  argumentHint: string;
  scope: "project" | "user" | "plugin";
};

/** Claude Code custom slash commands on disk (name, description, hint only). */
export function listClaudeCommands(cwd: string): Promise<ClaudeCommandEntry[]> {
  return invoke<ClaudeCommandEntry[]>("list_claude_commands", { cwd });
}

type ProjectFileListing = {
  root: string;
  files: { name: string; relative: string }[];
};

/** Local projects send the root once with relative paths; a remote host still
 * sends full entries, which pass through untouched. */
export async function listProjectFiles(cwd: string): Promise<ProjectFile[]> {
  const listing = await invoke<ProjectFileListing | ProjectFile[]>("list_project_files", { cwd });
  if (Array.isArray(listing)) return listing;
  const prefix = listing.root.endsWith("/") ? listing.root : `${listing.root}/`;
  return listing.files.map((file) => ({
    name: file.name,
    path: prefix + file.relative,
    relative: file.relative,
  }));
}

export type GitDiffStats = {
  files: number;
  additions: number;
  deletions: number;
};

export function gitDiffStats(cwd: string): Promise<GitDiffStats> {
  return invoke<GitDiffStats>("git_diff_stats", { cwd });
}

export type GitChangedFile = {
  path: string;
  relative: string;
  status: "modified" | "added" | "deleted" | "untracked" | string;
  additions: number;
  deletions: number;
  staged: boolean;
  unstaged: boolean;
};

export type GitDiffIndex = {
  /** Absent on older hosts. False is a successful lookup outside a repository. */
  repository?: boolean;
  branch: string | null;
  head: string | null;
  files: GitChangedFile[];
  additions: number;
  deletions: number;
  remote: string | null;
  upstream: string | null;
  defaultBranch: string | null;
  ahead: number;
  behind: number;
  aheadOfDefault: number;
  headPushed: boolean;
  /** Unmerged files, kept out of `files` and the line counts. Absent from a
   * host that predates conflict info. */
  conflicts?: GitConflictFile[];
  /** The operation git is stopped in the middle of; absent like `conflicts`. */
  operation?: GitOperation | null;
};

/** What git recorded for an unmerged path (`git status`: UU, AA, DU, UD, AU, UA,
 * DD). "Current" is the checked-out branch (stage 2), "incoming" the other. */
export type GitConflictKind =
  | "both-modified"
  | "both-added"
  | "deleted-by-us"
  | "deleted-by-them"
  | "added-by-us"
  | "added-by-them"
  | "both-deleted";

export type GitConflictFile = {
  path: string;
  relative: string;
  kind: GitConflictKind;
};

/** The three versions of a conflicted file. A null version is a missing stage
 * (normal for add and delete conflicts); binary or oversized files come back
 * with empty text. */
export type GitConflictStages = {
  path: string;
  relative: string;
  kind: GitConflictKind;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  binary: boolean;
  tooLarge: boolean;
};

export function gitConflictStages(cwd: string, relative: string): Promise<GitConflictStages> {
  return invoke<GitConflictStages>("git_conflict_stages", { cwd, relative });
}

export function gitDiffIndex(cwd: string): Promise<GitDiffIndex> {
  return invoke<GitDiffIndex>("git_diff_index", { cwd });
}

/** File list and counts only, for diff content views that do not need sync data. */
export function gitDiffFiles(cwd: string): Promise<GitDiffIndex> {
  return invoke<GitDiffIndex>("git_diff_files", { cwd });
}

export type GitFileDiff = {
  path: string;
  relative: string;
  status: string;
  original: string;
  current: string;
  binary: boolean;
  tooLarge: boolean;
};

export type GitFileDiffKind = "staged" | "unstaged";

export function gitFileDiff(
  cwd: string,
  relative: string,
  kind: GitFileDiffKind = "unstaged",
): Promise<GitFileDiff> {
  return invoke<GitFileDiff>("git_file_diff", {
    cwd,
    relative,
    staged: kind === "staged",
  });
}

export type GitHistoryRef = {
  name: string;
  kind: "local" | "remote" | "tag" | string;
};

export type GitHistoryCommit = {
  sha: string;
  shortSha: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
  refs: GitHistoryRef[];
  head: boolean;
};

export type GitHistory = {
  head: string | null;
  commits: GitHistoryCommit[];
};

/** `all` widens the graph from the current branch to every branch and tag. */
export function gitHistory(cwd: string, limit = 200, all = false): Promise<GitHistory> {
  return invoke<GitHistory>("git_history", { cwd, limit, all });
}

export function gitCommitFiles(cwd: string, sha: string): Promise<GitChangedFile[]> {
  return invoke<GitChangedFile[]>("git_commit_files", { cwd, sha });
}

/** Full subject and body of the selected commit, independent of HEAD. */
export function gitCommitMessage(cwd: string, sha: string): Promise<string> {
  return invoke<string>("git_commit_message", { cwd, sha });
}

export function gitCommitFileDiff(
  cwd: string,
  sha: string,
  relative: string,
): Promise<GitFileDiff> {
  return invoke<GitFileDiff>("git_commit_file_diff", { cwd, sha, relative });
}

export function gitStageContents(
  cwd: string,
  relative: string,
  contents: string,
  expectedOriginal?: string,
): Promise<void> {
  return invoke<void>("git_stage_contents", { cwd, relative, contents, expectedOriginal });
}

export function gitStageFile(cwd: string, relative: string): Promise<void> {
  return invoke<void>("git_stage_file", { cwd, relative });
}

export function gitStageFiles(cwd: string, relatives: string[]): Promise<void> {
  return invoke<void>("git_stage_files", { cwd, relatives });
}

export function gitUnstageFiles(cwd: string, relatives: string[]): Promise<void> {
  return invoke<void>("git_unstage_files", { cwd, relatives });
}

export function gitDiscardFiles(cwd: string, relatives: string[]): Promise<void> {
  return invoke<void>("git_discard_files", { cwd, relatives });
}

export function gitUnstageFile(cwd: string, relative: string): Promise<void> {
  return invoke<void>("git_unstage_file", { cwd, relative });
}

export function gitDiscardFile(cwd: string, relative: string): Promise<void> {
  return invoke<void>("git_discard_file", { cwd, relative });
}

export function gitDiscardAll(cwd: string): Promise<void> {
  return invoke<void>("git_discard_all", { cwd });
}

export function gitStageAll(cwd: string): Promise<void> {
  return invoke<void>("git_stage_all", { cwd });
}

export function gitUnstageAll(cwd: string): Promise<void> {
  return invoke<void>("git_unstage_all", { cwd });
}

export function gitCommit(
  cwd: string,
  message: string,
  amend = false,
  signoff = false,
): Promise<void> {
  return invoke<void>("git_commit", {
    cwd,
    message,
    amend,
    ...(signoff ? { signoff } : {}),
  });
}

/** Move HEAD back one commit, keeping its changes staged. */
export function gitUndoLastCommit(cwd: string): Promise<void> {
  return invoke<void>("git_undo_last_commit", { cwd });
}

export function gitHeadMessage(cwd: string): Promise<string> {
  return invoke<string>("git_head_message", { cwd });
}

export type GitStagedContext = {
  branch: string | null;
  summary: string;
  patch: string;
};

export function gitStagedContext(cwd: string): Promise<GitStagedContext> {
  return invoke<GitStagedContext>("git_staged_context", { cwd });
}

export function gitPush(cwd: string): Promise<void> {
  return invoke<void>("git_push", { cwd });
}

/** Fast-forward only, or rebase onto the upstream with `rebase`. */
export function gitPull(cwd: string, rebase = false): Promise<void> {
  return invoke<void>("git_pull", { cwd, ...(rebase ? { rebase } : {}) });
}

export function gitSync(cwd: string): Promise<void> {
  return invoke<void>("git_sync", { cwd });
}

export type GitRangeContext = {
  base: string;
  head: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
};

export function gitRangeContext(cwd: string): Promise<GitRangeContext> {
  return invoke<GitRangeContext>("git_range_context", { cwd });
}

export type GitPr = {
  number: number;
  title: string;
  url: string;
  state: string;
};

export function gitPrStatus(cwd: string): Promise<GitPr | null> {
  // Keep the remote router: accounts on another host have a separate quota.
  const scope = cwd.startsWith(REMOTE_PATH_PREFIX) ? (cwd.split("/")[2] ?? cwd) : "local";
  return withGithubRead(() => invoke<GitPr | null>("git_pr_status", { cwd }), scope);
}

export function gitPrCreate(
  cwd: string,
  title: string,
  body: string,
  base: string,
  head: string,
): Promise<string> {
  return invoke<string>("git_pr_create", { cwd, title, body, base, head });
}

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: string | null;
};

export type GitBranches = {
  current: string | null;
  detached: boolean;
  branches: GitBranchInfo[];
};

export function gitBranches(cwd: string): Promise<GitBranches> {
  return invoke<GitBranches>("git_branches", { cwd });
}

export function gitCheckout(cwd: string, name: string, remote?: string | null): Promise<string> {
  return invoke<string>("git_checkout", { cwd, name, remote: remote ?? null });
}

export function gitCreateBranch(cwd: string, name: string): Promise<string> {
  return invoke<string>("git_create_branch", { cwd, name });
}

/** `reference` is a local branch name or `remote/branch`. */
export function gitCreateBranchFrom(cwd: string, name: string, reference: string): Promise<string> {
  return invoke<string>("git_create_branch_from", { cwd, name, reference });
}

export type GitStashMode = "tracked" | "untracked" | "staged";

/** `mode` defaults to `untracked`: tracked and untracked files both. */
export function gitStash(cwd: string, message?: string, mode?: GitStashMode): Promise<void> {
  return invoke<void>("git_stash", {
    cwd,
    message: message ?? null,
    ...(mode ? { mode } : {}),
  });
}

/** Delete every stash entry. */
export function gitStashClear(cwd: string): Promise<void> {
  return invoke<void>("git_stash_clear", { cwd });
}

/** Check out a commit without moving any branch. */
export function gitCheckoutCommit(cwd: string, sha: string): Promise<void> {
  return invoke<void>("git_checkout_commit", { cwd, sha });
}

export function gitCreateBranchAt(cwd: string, name: string, sha: string): Promise<string> {
  return invoke<string>("git_create_branch_at", { cwd, name, sha });
}

export function gitCreateTag(cwd: string, name: string, sha: string): Promise<void> {
  return invoke<void>("git_create_tag", { cwd, name, sha });
}

export function gitCherryPick(cwd: string, sha: string): Promise<void> {
  return invoke<void>("git_cherry_pick", { cwd, sha });
}

export function gitRevert(cwd: string, sha: string): Promise<void> {
  return invoke<void>("git_revert", { cwd, sha });
}

export type GitResetMode = "soft" | "mixed" | "hard";

export function gitReset(cwd: string, sha: string, mode: GitResetMode): Promise<void> {
  return invoke<void>("git_reset", { cwd, sha, mode });
}

export type GitOperation = "merge" | "rebase" | "cherry-pick" | "revert";

/** The operation git stopped in the middle of, or null when idle. */
export function gitOperationState(cwd: string): Promise<GitOperation | null> {
  return invoke<GitOperation | null>("git_operation_state", { cwd });
}

export function gitOperationAbort(cwd: string): Promise<void> {
  return invoke<void>("git_operation_abort", { cwd });
}

/** Finish the stopped operation once every conflict is staged. */
export function gitOperationContinue(cwd: string): Promise<void> {
  return invoke<void>("git_operation_continue", { cwd });
}

export function gitDeleteBranch(cwd: string, name: string, force = false): Promise<void> {
  return invoke<void>("git_delete_branch", { cwd, name, force });
}

export function gitRenameBranch(cwd: string, from: string, to: string): Promise<string> {
  return invoke<string>("git_rename_branch", { cwd, from, to });
}

/** `reference` is a local branch name or `remote/branch`. */
export function gitMerge(cwd: string, reference: string): Promise<void> {
  return invoke<void>("git_merge", { cwd, reference });
}

export function gitRebase(cwd: string, reference: string): Promise<void> {
  return invoke<void>("git_rebase", { cwd, reference });
}

/** Fetch every remote. `prune` also drops tracking branches deleted there. */
export function gitFetch(cwd: string, prune = false): Promise<void> {
  return invoke<void>("git_fetch", { cwd, ...(prune ? { prune } : {}) });
}

/** Called only after the native owner confirmation for this exact checkout. */
export function gitTrustRepository(cwd: string): Promise<void> {
  return invoke<void>("git_trust_repository", { cwd, confirmed: true });
}

/** Delete a branch on its remote, for everyone. */
export function gitDeleteRemoteBranch(cwd: string, remote: string, name: string): Promise<void> {
  return invoke<void>("git_delete_remote_branch", { cwd, remote, name });
}

export type GitRemote = { name: string; url: string };

export function gitRemotes(cwd: string): Promise<GitRemote[]> {
  return invoke<GitRemote[]>("git_remotes", { cwd });
}

export function gitRemoteAdd(cwd: string, name: string, url: string): Promise<void> {
  return invoke<void>("git_remote_add", { cwd, name, url });
}

export function gitRemoteRemove(cwd: string, name: string): Promise<void> {
  return invoke<void>("git_remote_remove", { cwd, name });
}

/** Tag names, newest first. */
export function gitTags(cwd: string): Promise<string[]> {
  return invoke<string[]>("git_tags", { cwd });
}

/** Delete a local tag. A pushed tag stays on the remote. */
export function gitDeleteTag(cwd: string, name: string): Promise<void> {
  return invoke<void>("git_delete_tag", { cwd, name });
}

export type GitStashEntry = {
  index: number;
  sha: string;
  message: string;
  timestamp: number;
};

export function gitStashList(cwd: string): Promise<GitStashEntry[]> {
  return invoke<GitStashEntry[]>("git_stash_list", { cwd });
}

export function gitStashAction(
  cwd: string,
  action: "apply" | "pop" | "drop",
  index: number,
  expectedSha: string,
): Promise<void> {
  return invoke<void>("git_stash_action", { cwd, action, index, expectedSha });
}

/** Repo-relative paths with unresolved merge conflicts. */
export function gitConflicts(cwd: string): Promise<string[]> {
  return invoke<string[]>("git_conflicts", { cwd });
}

/** `gitOperationState` and `gitConflicts` together, for the banner that polls
 * both: a project on another machine answers in one request. */
export async function gitOperationStatus(
  cwd: string,
): Promise<{ operation: GitOperation | null; conflicts: string[] }> {
  if (isRemotePath(cwd))
    return invoke<{ operation: GitOperation | null; conflicts: string[] }>("git_operation_status", {
      cwd,
    });
  const [operation, conflicts] = await Promise.all([
    gitOperationState(cwd).catch(() => null),
    gitConflicts(cwd).catch(() => []),
  ]);
  return { operation, conflicts };
}

/** Take one whole side of a conflicted file and stage it. */
export function gitResolveConflict(
  cwd: string,
  relative: string,
  side: "ours" | "theirs",
): Promise<void> {
  return invoke<void>("git_resolve_conflict", { cwd, relative, side });
}

export function gitFileHistory(
  cwd: string,
  relative: string,
  limit = 200,
): Promise<GitHistoryCommit[]> {
  return invoke<GitHistoryCommit[]>("git_file_history", { cwd, relative, limit });
}

export type GitBlameLine = {
  line: number;
  sha: string;
  shortSha: string;
  author: string;
  timestamp: number;
  summary: string;
};

export function gitBlame(cwd: string, relative: string, sha?: string): Promise<GitBlameLine[]> {
  return invoke<GitBlameLine[]>("git_blame", { cwd, relative, ...(sha ? { sha } : {}) });
}

/** Git refused a checkout because the working tree would be overwritten. */
export function isCheckoutBlockedByChanges(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("would be overwritten") ||
    text.includes("commit your changes or stash") ||
    text.includes("please move or remove them before")
  );
}

const GIT_CHANGED = "bycoda-git-changed";

/**
 * What a git change touched. `index` is the working tree and the index of one
 * checkout (an edit, stage, unstage or discard): commits, branches, stashes
 * and other checkouts are as they were. `checkout` is a change the `.git`
 * watcher saw in one checkout's refs or HEAD: other checkouts of the same
 * repository get their own report. `refs` is anything else and reaches every
 * checkout.
 */
export type GitChangeScope = "index" | "checkout" | "refs";

type GitChange = { cwd?: string; scope: GitChangeScope };

/** Whether two folders belong to one checkout: the same folder or nested. */
function sameCheckout(a: string, b: string): boolean {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/**
 * Tell git UIs (diff pane, branch picker) to reload after a local git mutation.
 * Naming the checkout and an `index` scope keeps the reload to the views that
 * show that checkout's changed files.
 */
export function notifyGitChanged(cwd?: string, scope: GitChangeScope = "refs") {
  window.dispatchEvent(new CustomEvent<GitChange>(GIT_CHANGED, { detail: { cwd, scope } }));
}

type GitWatchReport = { cwd: string; index: boolean; refs: boolean };
type GitWatch = {
  count: number;
  state: "pending" | "watching" | "failed";
  /** Releases a remote watch. */
  stop?: () => void;
};

const GIT_WATCH_EVENT = "bycoda-git-watch";
const gitWatches = new Map<string, GitWatch>();
let gitWatchReady: Promise<void> | null = null;

function deliverGitWatch(reports: GitWatchReport[]) {
  const sent: { cwd: string; scope: GitChangeScope }[] = [];
  for (const report of reports) {
    const scope: GitChangeScope = report.refs ? "checkout" : "index";
    // Nested folders of one checkout share their listeners: tell them once.
    if (
      sent.some(
        (prior) =>
          sameCheckout(prior.cwd, report.cwd) && (prior.scope === "checkout" || scope === "index"),
      )
    )
      continue;
    sent.push({ cwd: report.cwd, scope });
    notifyGitChanged(report.cwd, scope);
  }
}

function gitWatchSetup(): Promise<void> {
  // Reports are addressed to the webview that registered the checkout.
  gitWatchReady ??= Promise.resolve()
    .then(() =>
      getCurrentWebview().listen<GitWatchReport[]>(GIT_WATCH_EVENT, (event) =>
        deliverGitWatch(event.payload),
      ),
    )
    // A reloaded page drops what its previous load registered.
    .then(() => invokeLocal<void>("git_watch_reset"));
  return gitWatchReady;
}

/** Ask the connected machine to report `.git` changes of a remote checkout
 * while held. Nothing is watched without a registered watcher. */
function acquireRemoteGitWatch(cwd: string): () => void {
  const watcher = remoteGitWatcher;
  if (!watcher) return () => {};
  let entry = gitWatches.get(cwd);
  if (!entry) {
    const created: GitWatch = { count: 0, state: "pending" };
    entry = created;
    gitWatches.set(cwd, created);
    created.stop = watcher(
      cwd,
      (_index, refs) => notifyGitChanged(cwd, refs ? "checkout" : "index"),
      (on) => {
        if (gitWatches.get(cwd) === created) created.state = on ? "watching" : "failed";
      },
    );
  }
  entry.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = gitWatches.get(cwd);
    if (!current || --current.count > 0) return;
    gitWatches.delete(cwd);
    current.stop?.();
  };
}

/** Ask the app to report `.git` changes of a local checkout while held. */
function acquireGitWatch(cwd: string): () => void {
  let entry = gitWatches.get(cwd);
  if (!entry) {
    const created: GitWatch = { count: 0, state: "pending" };
    entry = created;
    gitWatches.set(cwd, created);
    gitWatchSetup()
      .then(() => invokeLocal<void>("git_watch", { cwd }))
      .then(
        () => {
          if (gitWatches.get(cwd) === created) created.state = "watching";
          else void invokeLocal("git_unwatch", { cwd }).catch(() => {});
        },
        () => {
          // Not a repository, or no app to ask: views keep their own triggers.
          created.state = "failed";
        },
      );
  }
  entry.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = gitWatches.get(cwd);
    if (!current || --current.count > 0) return;
    gitWatches.delete(cwd);
    // A pending start unwatches itself once it settles.
    if (current.state === "watching") void invokeLocal("git_unwatch", { cwd }).catch(() => {});
  };
}

/**
 * Whether the `.git` watcher reports this checkout's refs, HEAD and index.
 * Views of a watched checkout need no focus reloads or polling for those.
 */
export function isGitWatched(cwd: string): boolean {
  return gitWatches.get(cwd)?.state === "watching";
}

/**
 * `filter.cwd` skips `index` and `checkout` changes of unrelated checkouts and
 * watches that local checkout's `.git` while subscribed; `filter.refsOnly`
 * skips every `index` change, for views of commits, branches or stashes.
 */
export function subscribeGitChanged(
  listener: () => void,
  filter?: { cwd?: string; refsOnly?: boolean },
): () => void {
  const onChange = (event: Event) => {
    const change = (event as CustomEvent<GitChange | null>).detail;
    if (change && change.scope !== "refs") {
      if (change.scope === "index" && filter?.refsOnly) return;
      if (filter?.cwd && change.cwd && !sameCheckout(filter.cwd, change.cwd)) {
        return;
      }
    }
    listener();
  };
  window.addEventListener(GIT_CHANGED, onChange);
  const cwd = filter?.cwd;
  const release =
    cwd && cwd !== "~"
      ? isRemotePath(cwd)
        ? acquireRemoteGitWatch(cwd)
        : acquireGitWatch(cwd)
      : () => {};
  return () => {
    window.removeEventListener(GIT_CHANGED, onChange);
    release();
  };
}

export function createPath(parent: string, name: string, isDir: boolean): Promise<string> {
  return invoke<string>("create_path", { parent, name, isDir }).then(slash);
}

export function renamePath(path: string, name: string): Promise<string> {
  return invoke<string>("rename_path", { path, name }).then(slash);
}

export function deletePath(path: string): Promise<void> {
  return invoke<void>("delete_path", { path });
}

export function copyPath(from: string, destParent: string): Promise<string> {
  return invoke<string>("copy_path", { from, destParent }).then(slash);
}

export function movePath(from: string, destParent: string): Promise<string> {
  return invoke<string>("move_path", { from, destParent }).then(slash);
}

/**
 * Paths for files copied in a file manager, on macOS, Linux and Windows.
 * Rejects when the clipboard cannot be read; an empty list means it holds no
 * files.
 */
export function clipboardFilePaths(): Promise<string[]> {
  return invoke<string[]>("clipboard_file_paths").then((paths) => paths.map(slash));
}

/** Put the original file on the macOS clipboard, preserving its name and type. */
export function copyFileToClipboard(path: string): Promise<void> {
  return invoke<void>("copy_file_to_clipboard", { path });
}

export function revealPath(path: string): Promise<void> {
  if (path.startsWith(REMOTE_PATH_PREFIX)) {
    const localPath = localExplorerPath(path);
    if (!localPath)
      return Promise.reject(
        new Error(
          "Set the shared folder path in the remote folder browser to reveal it on this computer.",
        ),
      );
    return invokeLocal<void>("reveal_path", { path: localPath });
  }
  return invoke<void>("reveal_path", { path });
}

export function openPathWithDefaultApp(path: string): Promise<void> {
  if (path.startsWith(REMOTE_PATH_PREFIX)) {
    const mapped = localExplorerPath(path);
    return mapped
      ? invokeLocal<void>("open_path_with_default_app", { path: mapped })
      : prepareLocalFileCopy(path).then((local) =>
          invokeLocal<void>("open_path_with_default_app", { path: local }),
        );
  }
  return invoke<void>("open_path_with_default_app", { path });
}

/** Read-only live native folder access, using the recorded owning machine. */
export async function openLiveRemoteFolder(path: string): Promise<void> {
  const { parseRemotePath } = await import("../../features/connections/model/remoteProjects");
  const { remoteMachineFor } = await import("../../features/connections/model/connections");
  const parsed = parseRemotePath(path);
  if (!parsed) throw new Error("Choose a folder on a connected computer.");
  const machine = await remoteMachineFor(parsed.environmentId);
  if (!machine) throw new Error("The owning computer is not connected.");
  return invokeLocal<void>("remote_open_live_folder", {
    machineId: machine.id,
    environmentId: parsed.environmentId,
    path: parsed.hostPath,
  });
}

export type LocalFilePreparation = {
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
  maxBytes?: number;
};

/** Stat an already prepared native file without reading bytes or contacting its host. */
export async function preparedFileSize(path: string): Promise<number | undefined> {
  const [info] = await invokeLocal<{ size: number; isDir: boolean }[]>("inspect_paths", {
    paths: [path],
  });
  return info && !info.isDir && Number.isSafeInteger(info.size) && info.size >= 0
    ? info.size
    : undefined;
}

/** A readable native path on this computer, with an exact asset-protocol grant. */
export function prepareLocalFile(
  path: string,
  options: LocalFilePreparation = {},
): Promise<string> {
  const mapped = path.startsWith(REMOTE_PATH_PREFIX) ? localExplorerPath(path) : path;
  if (options.signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return mapped
    ? invokeLocal<string>("prepare_local_file", {
        path: mapped,
        maxBytes: options.maxBytes ?? null,
      })
    : prepareLocalFileCopy(path, options);
}

/** Download a snapshot to this computer. Editing the copy does not update its host. */
export async function prepareLocalFileCopy(
  path: string,
  options: LocalFilePreparation = {},
): Promise<string> {
  if (!path.startsWith(REMOTE_PATH_PREFIX)) return prepareLocalFile(path, options);
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  checkCancelled();
  const info = await invokeWorkspace<{ size: number; version: string }>("read_file_info", { path });
  if (
    !Number.isSafeInteger(info.size) ||
    info.size < 0 ||
    info.size > 1024 * 1024 * 1024 ||
    typeof info.version !== "string" ||
    !info.version ||
    info.version.length > 256
  )
    throw new Error("This file cannot be downloaded (maximum 1 GB).");
  if (options.maxBytes !== undefined && info.size > options.maxBytes)
    throw new Error(`File is too large to preview (maximum ${options.maxBytes / 1024 / 1024} MB).`);
  checkCancelled();
  const key = JSON.stringify([path, info.version]);
  const cached = await invokeLocal<string | null>("cached_remote_file_copy", { key });
  checkCancelled();
  if (cached) {
    options.onProgress?.(info.size, info.size);
    return cached;
  }
  const id = await invokeLocal<string>("begin_remote_file_copy", {
    name: basename(path),
    size: info.size,
    key,
  });
  try {
    let offset = 0;
    options.onProgress?.(0, info.size);
    while (offset < info.size) {
      checkCancelled();
      const requested = Math.min(1024 * 1024, info.size - offset);
      const chunk = await invokeWorkspace<{ data: string; offset: number; length: number }>(
        "read_file_chunk",
        {
          path,
          version: info.version,
          offset,
          length: requested,
        },
      );
      checkCancelled();
      if (
        chunk.offset !== offset ||
        !Number.isSafeInteger(chunk.length) ||
        chunk.length < 1 ||
        chunk.length > requested ||
        typeof chunk.data !== "string"
      )
        throw new Error("The connected machine returned an invalid file chunk.");
      await invokeLocal<void>("append_remote_file_copy", { id, offset, data: chunk.data });
      offset += chunk.length;
      options.onProgress?.(offset, info.size);
    }
    checkCancelled();
    const current = await invokeWorkspace<{ size: number; version: string }>("read_file_info", {
      path,
    });
    if (current.version !== info.version || current.size !== info.size)
      throw new Error("The file changed while downloading. Try again.");
    checkCancelled();
    return await invokeLocal<string>("finish_remote_file_copy", { id });
  } catch (error) {
    await invokeLocal<void>("cancel_remote_file_copy", { id }).catch(() => undefined);
    throw error;
  }
}

/** Runs a command line in the user's shell on this computer. */
export function runShellCommand(
  cwd: string,
  command: string,
  profile?: string,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return invoke("run_shell_command", { cwd, command, profile: profile ?? null });
}

/** Whether a path on this computer is a folder; false when it is missing or on another machine. */
export function isLocalDirectory(path: string): Promise<boolean> {
  if (path.startsWith(REMOTE_PATH_PREFIX)) return Promise.resolve(false);
  return invoke<{ isDir: boolean }[]>("inspect_paths", { paths: [path] })
    .then((infos) => infos[0]?.isDir === true)
    .catch(() => false);
}

export function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}

export function pathEnvironment(): Promise<Record<string, string>> {
  return invokeLocal<Record<string, string>>("path_environment");
}

/**
 * Folders chosen from the system picker. Multi-select is on, so several
 * projects can be opened in one pass; the dialog still returns a bare string
 * when only one was taken.
 */
export async function pickNativeFolders(
  title = "Open projects",
  multiple = true,
): Promise<string[]> {
  const selected = await open({
    directory: true,
    multiple,
    title,
  });
  if (Array.isArray(selected)) {
    return selected.filter((path) => !!path).map(slash);
  }
  return typeof selected === "string" && selected ? [slash(selected)] : [];
}

/** Shared in-app browser for adding projects and session folders. */
export async function pickFolders(title = "Open projects", multiple = true): Promise<string[]> {
  const { openFolderPicker } = await import("../../features/projects/ui/openFolderPicker");
  const folders = await openFolderPicker({ title, multiple });
  for (const path of folders) await invoke<void>("authorize_project_path", { path });
  return folders;
}

/** A VS Code `.code-workspace` file, or null when the picker is dismissed. */
export async function pickCodeWorkspaceFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Open VS Code workspace",
    filters: [{ name: "VS Code workspace", extensions: ["code-workspace"] }],
  });
  return typeof selected === "string" && selected ? slash(selected) : null;
}

export async function pickFiles(title = "Attach files"): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    directory: false,
    title,
  });
  if (Array.isArray(selected)) {
    const paths = selected.filter((path): path is string => Boolean(path)).map(slash);
    return paths.length > 0 ? paths : null;
  }
  if (typeof selected === "string" && selected) return [slash(selected)];
  return null;
}

export async function pickImageFiles(title = "Insert images"): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    directory: false,
    title,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  if (Array.isArray(selected)) {
    const paths = selected.filter((path): path is string => Boolean(path)).map(slash);
    return paths.length > 0 ? paths : null;
  }
  if (typeof selected === "string" && selected) return [slash(selected)];
  return null;
}

export function cloneRepo(url: string, parent: string): Promise<string> {
  return invoke<string>("clone_repo", { url, parent }).then(slash);
}

export function readFilePreview(path: string, maxLines = 6, startLine?: number): Promise<string[]> {
  return invoke<string[]>("read_file_preview", {
    path,
    maxLines,
    startLine,
  });
}

export type FileMtime = {
  path: string;
  mtimeMs: number | null;
  isDir?: boolean;
};

export function statFiles(paths: string[]): Promise<FileMtime[]> {
  if (paths.length === 0) return Promise.resolve([]);
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const machine = path.startsWith(REMOTE_PATH_PREFIX)
      ? path.slice(REMOTE_PATH_PREFIX.length).split("/", 1)[0]
      : "";
    const group = groups.get(machine) ?? [];
    group.push(path);
    groups.set(machine, group);
  }
  return Promise.all(
    [...groups.values()].map((group) => invoke<FileMtime[]>("stat_files", { paths: group })),
  ).then((results) => {
    const byPath = new Map(results.flat().map((entry) => [entry.path, entry]));
    return paths.map((path) => byPath.get(path) ?? { path, mtimeMs: null });
  });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Raw bytes for the image viewer. Arrives as an ArrayBuffer, not base64. */
export async function readBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await invoke<ArrayBuffer | string>("read_binary_file", {
    path,
  });
  // A connected machine sends the bytes as base64 inside its JSON reply.
  return typeof buffer === "string"
    ? Uint8Array.from(atob(buffer), (char) => char.charCodeAt(0))
    : new Uint8Array(buffer);
}

export type GeneratedImageAsset = {
  path: string;
  mimeType: string;
  size: number;
};

export function saveGeneratedImage(input: {
  data: string;
  name: string;
}): Promise<GeneratedImageAsset> {
  return invoke<GeneratedImageAsset>("save_generated_image", input);
}

export function deleteGeneratedImages(paths: string[]): Promise<void> {
  return invoke<void>("delete_generated_images", { paths });
}

export function writeTextFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_text_file", { path, content });
}

/** Last path segment, or `/` for the filesystem root. */
export function basename(path: string): string {
  const trimmed = slash(path).replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
