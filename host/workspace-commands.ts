import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { gitMutationScope, isHostGitMutation, withHostGitMutation } from "./git-mutations";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { FileMtime, FsEntry, GitPr, ProjectFile } from "../src/platform/tauri/fs";
import { hostUnmerged, unmergedMessage } from "./git-conflicts";
import { hostWorktrees } from "./git-worktrees";
import { hostGitSubmodules } from "./git-submodules";
import { createHostBranch, hostBranches, switchHostBranch } from "./git-branches";
import {
  GIT_ACTION_COMMANDS,
  GIT_ACTIONS_NEEDING_IDLE,
  HISTORY_FORMAT,
  HISTORY_REFS_FORMAT,
  parseHistoryLog,
  parseHistoryRefs,
  runGitAction,
  verifyGitManagementSnapshot,
  type GitActionCommand,
} from "./git-actions";
import type { HostStore } from "./store";
import { HostCheckpoints } from "./checkpoints";
import { browseHostFolder } from "./browse";
import { formatWorkspaceText } from "./editor-format";
import { listHostClaudeCommands } from "./claude-commands";
import { deleteHostSkill, exportHostSkill, importHostSkill, listHostSkills } from "./skills";
import { migrateSkillPolicy, setSkillEnabled } from "./skill-policy";
import {
  createHostPath,
  existingPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  indexHostFiles,
  invalidateHostFilePaths,
  invalidateHostGitIndex,
  listHostFiles,
  searchHostContent,
  workspacePath,
} from "./workspace";

/** Local file commands the host answers for a remote project, with the same
 * names, arguments and results as this app's Tauri commands, so the same UI
 * works on either machine. Paths are absolute host paths and must lie inside
 * a registered project or one of its worktrees. `browse_dir` only returns
 * folder metadata and can also navigate outside those roots. */
export const WORKSPACE_COMMANDS = [
  "session_checkpoint_status",
  "session_checkpoint_file_diff",
  "session_checkpoint_undo",
  "session_checkpoint_keep",
  "list_dir",
  "skill_policy_get",
  "skill_policy_set",
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
  "git_stage_files",
  "git_discard_files",
  "git_unstage_files",
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
  "git_pr_destination",
  "git_pr_create",
  "git_history",
  "git_commit_files",
  "git_commit_file_diff",
  "git_staged_context",
  "git_range_context",
  "git_branches",
  "git_checkout",
  "git_create_branch",
  ...GIT_ACTION_COMMANDS,
  "git_worktrees",
  "git_submodules",
  "search_project",
  "list_skills",
  "list_claude_commands",
  "skill_export",
  "skill_delete",
  "skill_import",
] as const;
export type WorkspaceCommand = (typeof WORKSPACE_COMMANDS)[number];

// Remote RPC has bounded request and response bodies. Keep file operations
// within those bounds even after JSON escaping or base64 encoding.
const MAX_TEXT_FILE = 1024 * 1024;
const MAX_PREVIEW_FILE = 10 * 1024 * 1024;
const MAX_TRANSFER_FILE = 1024 * 1024 * 1024;
const MAX_TRANSFER_CHUNK = 1024 * 1024;
const MAX_STAT_FILES = 64;
const ROOTS_TTL_MS = 5_000;
// Connections may own different command instances. Windows cannot replace the
// same destination concurrently, so serialize canonical destinations host-wide.
const textFileSaves = new Map<string, Promise<void>>();

const slashed = (path: string) => path.replace(/\\/g, "/");
const joined = (parent: string, name: string) =>
  `${slashed(parent).replace(/\/+$/, "")}/${slashed(name).replace(/^\/+|\/+$/g, "")}`;
const alreadyExists = (name: string) =>
  `A file or folder ${name} already exists at this location. Please choose a different name.`;

type Located = { root: string; relative: string };

export class WorkspaceCommands {
  private roots = new Map<string, { at: number; roots: string[] }>();
  private rootsGeneration = 0;

  invalidateRoots(): void {
    this.rootsGeneration++;
    this.roots.clear();
  }

  constructor(
    private readonly store: HostStore,
    private readonly withIdleProject: <T>(
      projectId: string,
      action: () => Promise<T>,
    ) => Promise<T>,
    private readonly checkpoints = new HostCheckpoints(
      resolve(dirname(store.attachmentDir), "checkpoints"),
    ),
  ) {}

  run(command: unknown, args: unknown): Promise<unknown> {
    if (!WORKSPACE_COMMANDS.includes(command as WorkspaceCommand))
      throw new Error("Unsupported workspace command");
    const input =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
    if (isHostGitMutation(command as string)) {
      return this.gitRoot(input.cwd).then((root) =>
        withHostGitMutation(
          root,
          async () => {
            try {
              return await this.runCommand(command as WorkspaceCommand, input);
            } finally {
              invalidateHostGitIndex(root);
            }
          },
          undefined,
          gitMutationScope(command as string),
        ),
      );
    }
    return this.runCommand(command as WorkspaceCommand, input);
  }

  private runCommand(command: WorkspaceCommand, input: Record<string, unknown>): Promise<unknown> {
    if (GIT_ACTION_COMMANDS.includes(command as GitActionCommand))
      return this.gitActionCommand(command as GitActionCommand, input);
    switch (command as Exclude<WorkspaceCommand, GitActionCommand>) {
      case "session_checkpoint_status":
      case "session_checkpoint_file_diff":
      case "session_checkpoint_undo":
      case "session_checkpoint_keep":
        return this.checkpoint(command as string, input);
      case "list_dir":
        return this.listDir(input.path);
      case "browse_dir":
        return this.browseDir(input.path, input.containing);
      case "list_project_files":
        return this.listProjectFiles(input.cwd);
      case "read_text_file":
        return this.readText(input.path);
      case "format_text_file": {
        return this.existing(input.path).then(({ root, path }) =>
          formatWorkspaceText(root, path, input.source, input.cursorOffset),
        );
      }
      case "read_binary_file":
        return this.readBinary(input.path);
      case "read_file_info":
        return this.readFileInfo(input.path, input.root, input.rootIdentity);
      case "read_folder_entry":
        return this.readFolderEntry(input);
      case "read_file_chunk":
        return this.readFileChunk(input);
      case "read_file_preview":
        return this.preview(input.path, input.maxLines, input.startLine);
      case "write_text_file":
        return this.writeText(input.path, input.content);
      case "stat_files":
        return this.statFiles(input.paths);
      case "create_path":
        return this.create(input.parent, input.name, input.isDir);
      case "rename_path":
        return this.rename(input.path, input.name);
      case "delete_path":
        return this.delete(input.path);
      case "copy_path":
        return this.copy(input.from, input.destParent);
      case "move_path":
        return this.move(input.from, input.destParent);
      case "git_diff_index":
        return this.gitIndex(input.cwd);
      case "git_diff_files":
        return this.gitIndex(input.cwd, false);
      case "git_diff_stats":
        return this.gitIndex(input.cwd, false).then((index) => ({
          files: index.files.length + (index.conflicts?.length ?? 0),
          additions: index.additions,
          deletions: index.deletions,
        }));
      case "git_file_diff":
        return this.gitFileDiff(input.cwd, input.relative, input.staged);
      case "git_stage_contents":
        return this.gitAction(
          input.cwd,
          "stageContents",
          input.relative,
          undefined,
          input.contents,
          input.expectedOriginal,
          input.expectedCurrent,
          input.expectedSnapshot,
        );
      case "git_stage_file":
        return this.gitAction(input.cwd, "stage", input.relative);
      case "git_stage_files":
        return this.gitAction(input.cwd, "stageFiles", input.relatives);
      case "git_unstage_files":
        return this.gitAction(input.cwd, "unstageFiles", input.relatives);
      case "git_unstage_file":
        return this.gitAction(input.cwd, "unstage", input.relative);
      case "git_discard_file":
        return this.gitAction(input.cwd, "discard", input.relative);
      case "git_discard_files":
        return this.gitAction(input.cwd, "discardFiles", input.relatives);
      case "git_discard_all":
        return this.gitAction(input.cwd, "discardAll");
      case "git_stage_all":
        return this.gitAction(input.cwd, "stageAll");
      case "git_unstage_all":
        return this.gitAction(input.cwd, "unstageAll");
      case "git_commit":
        return this.gitCommit(input.cwd, input.message, input.amend, input.signoff);
      case "git_head_message":
        return this.gitCommand(input.cwd, ["log", "-1", "--format=%B"]);
      case "git_push":
        return this.gitAction(input.cwd, "push");
      case "git_pull":
        return this.gitRoot(input.cwd).then((root) =>
          this.withIdleGitProject(root, () =>
            this.gitCommand(root, ["pull", input.rebase === true ? "--rebase" : "--ff-only"]).then(
              () => undefined,
            ),
          ),
        );
      case "git_sync":
        return this.gitRoot(input.cwd).then((root) =>
          this.withIdleGitProject(root, () => this.gitSync(root)),
        );
      case "git_pr_status":
        return this.gitPrStatus(input.cwd);
      case "git_pr_destination":
        return this.ghCommand(input.cwd, ["repo", "view", "--json", "nameWithOwner,url"]).then((json) => JSON.parse(json));
      case "git_pr_create":
        if (input.expectedSnapshot !== undefined) return this.gitRoot(input.cwd).then(async (root) => {
          await verifyGitManagementSnapshot(root, input.expectedSnapshot);
          return this.gitPrCreate(root, input.title, input.body, input.base, input.head, input.repository);
        });
        return this.gitPrCreate(input.cwd, input.title, input.body, input.base, input.head, input.repository);
      case "git_history":
        return this.gitHistory(input.cwd, input.limit, input.all === true);
      case "git_commit_files":
        return this.gitCommitFiles(input.cwd, input.sha);
      case "git_commit_file_diff":
        return this.gitCommitFileDiff(input.cwd, input.sha, input.relative);
      case "git_staged_context":
        return this.gitStagedContext(input.cwd);
      case "git_range_context":
        return this.gitRangeContext(input.cwd);
      case "git_branches":
        return this.gitBranches(input.cwd);
      case "git_checkout":
        return this.gitCheckout(input.cwd, input.name, input.remote);
      case "git_create_branch":
        return this.gitCreateBranch(input.cwd, input.name);
      case "git_worktrees":
        return this.gitWorktrees(input.cwd);
      case "git_submodules":
        return this.gitRoot(input.cwd).then(hostGitSubmodules);
      case "search_project":
        return this.searchProject(input.options);
      case "list_skills":
        return this.listSkills(input.cwd, input.disabledPaths);
      case "skill_policy_get":
        return Promise.resolve().then(() => migrateSkillPolicy(input.legacyDisabledPaths));
      case "skill_policy_set":
        return Promise.resolve().then(() => setSkillEnabled(input.name, input.enabled));
      case "list_claude_commands":
        return this.existing(input.cwd, true).then(({ path }) => listHostClaudeCommands(path));
      case "skill_export":
        return this.exportSkill(input.path, input.cwd);
      case "skill_delete":
        return this.deleteSkill(input.path, input.cwd);
      case "skill_import":
        // `cwd` only routes the call here; skills land in this machine's home.
        return Promise.resolve().then(() => importHostSkill(input));
    }
  }

  /** The project folders and worktrees files may be read and written in. */
  private async allowedRoots(): Promise<string[]> {
    const generation = this.rootsGeneration;
    const out: string[] = [];
    const projects = this.store.projects();
    let cursor = 0;
    // hostWorktrees bounds each listing subprocess with a 10 s timeout.
    await Promise.all(
      Array.from({ length: Math.min(4, projects.length) }, async () => {
        while (cursor < projects.length) {
          const project = projects[cursor++];
          const cached = this.roots.get(project.cwd);
          if (cached && Date.now() - cached.at < ROOTS_TTL_MS) {
            out.push(...cached.roots);
            continue;
          }
          const roots = await hostWorktrees(project.cwd)
            .then((listed) => [
              project.cwd,
              ...listed.worktrees
                .filter((tree) => !tree.missing && tree.path !== project.cwd)
                .map((tree) => tree.path),
            ])
            .catch(() => [project.cwd]);
          if (generation === this.rootsGeneration)
            this.roots.set(project.cwd, { at: Date.now(), roots });
          out.push(...roots);
        }
      }),
    );
    return out;
  }

  /** Finds the project root that contains `input`, which may not exist yet. */
  private async locate(input: unknown): Promise<Located> {
    if (
      typeof input !== "string" ||
      !isAbsolute(input) ||
      input.length > 4096 ||
      input.includes("\0")
    )
      throw new Error("Invalid workspace path");
    let actual = resolve(input);
    let missing = "";
    // Resolve symlinks on the nearest existing ancestor, then re-append the
    // part that does not exist yet (a file about to be created or written).
    for (;;) {
      const real = await realpath(actual).catch(() => undefined);
      if (real) {
        actual = missing ? resolve(real, missing) : real;
        break;
      }
      const parent = dirname(actual);
      if (parent === actual) break;
      missing = missing ? `${basename(actual)}/${missing}` : basename(actual);
      actual = parent;
    }
    // A project nested in another belongs to the innermost one, so its root
    // keeps the root protections instead of passing as the outer's subfolder.
    let found: Located | undefined;
    const find = (roots: string[]) => {
      for (const root of roots) {
        const rel = relative(root, actual);
        if (rel === ".." || /^\.\.[\\/]/.test(rel) || isAbsolute(rel)) continue;
        if (!found || rel.length < found.relative.length) found = { root, relative: rel };
      }
    };
    find(this.store.projects().map((project) => project.cwd));
    if (found) return found;
    find(await this.allowedRoots());
    if (found) return found;
    throw new Error("Path is outside this machine’s projects");
  }

  private async existing(input: unknown, allowRoot = false) {
    const { root, relative: rel } = await this.locate(input);
    return { root, path: await existingPath(root, rel, allowRoot) };
  }

  private async listDir(input: unknown): Promise<FsEntry[]> {
    const { root, relative: rel } = await this.locate(input);
    const entries = await listHostFiles(root, rel);
    return entries.map((entry) => ({
      ...entry,
      path: joined(input as string, entry.name),
    }));
  }

  private async browseDir(input: unknown, containing: unknown) {
    const folder = await browseHostFolder(input, containing);
    const canOpenFiles = await this.existing(folder.path, true).then(
      () => true,
      () => false,
    );
    return { ...folder, canOpenFiles };
  }

  private async listProjectFiles(input: unknown): Promise<ProjectFile[]> {
    const { path } = await this.existing(input, true);
    const cwd = input as string;
    return (await indexHostFiles(path)).map((file) => ({
      name: file.split("/").pop() || file,
      path: joined(cwd, file),
      relative: file,
    }));
  }

  private async file(input: unknown, limit: number, tooLarge: string) {
    const { path } = await this.existing(input);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Not a file");
    if (info.size > limit)
      throw new Error(`File is too large to ${tooLarge} (maximum ${limit / 1024 / 1024} MB).`);
    return readFile(path);
  }

  private async readText(input: unknown): Promise<string> {
    const bytes = await this.file(input, MAX_TEXT_FILE, "edit");
    if (bytes.includes(0)) throw new Error("Binary files cannot be edited.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("File is not valid UTF-8.");
    }
  }

  /** Base64, since host responses are JSON; the client decodes it. */
  private async readBinary(input: unknown): Promise<string> {
    return (await this.file(input, MAX_PREVIEW_FILE, "preview")).toString("base64");
  }

  /** Bounded, versioned reads for an owner-requested local copy or media preview. */
  private async folderAccessPath(input: unknown, root: unknown, expectedIdentity?: unknown) {
    const selected = await this.existing(root, true);
    const selectedPath = await realpath(selected.path);
    const selectedInfo = await stat(selectedPath, { bigint: true });
    if (!selectedInfo.isDirectory()) throw new Error("The shared root is not a folder");
    const rootIdentity = createHash("sha256")
      .update(JSON.stringify([selectedPath, String(selectedInfo.dev), String(selectedInfo.ino)]))
      .digest("hex");
    if (expectedIdentity !== undefined && expectedIdentity !== rootIdentity)
      throw new Error("The selected folder was replaced. Open the live folder again.");
    const target = await this.existing(input, true);
    const path = await realpath(target.path);
    const rel = relative(selectedPath, path);
    if (
      rel === ".." ||
      rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(rel)
    )
      throw new Error("Path is outside the selected folder");
    return { path, rootIdentity };
  }

  private async readFolderEntry(input: Record<string, unknown>) {
    if (typeof input.children !== "boolean") throw new Error("Invalid folder listing request");
    const { path, rootIdentity } = await this.folderAccessPath(
      input.path,
      input.root,
      input.rootIdentity,
    );
    const metadata = async (entryPath: string, name: string) => {
      const info = await stat(entryPath, { bigint: true });
      if (!info.isDirectory() && !info.isFile()) throw new Error("Unsupported filesystem entry");
      const verified = await this.folderAccessPath(entryPath, input.root, rootIdentity);
      const after = await stat(verified.path, { bigint: true });
      if (verified.path !== entryPath || after.dev !== info.dev || after.ino !== info.ino)
        throw new Error("The folder entry changed while reading.");
      return {
        name,
        isDir: info.isDirectory(),
        size: info.isFile() ? Number(info.size) : 0,
        mtimeMs: Number(info.mtimeMs),
        version: [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":"),
      };
    };
    const entry = await metadata(path, basename(String(input.path)));
    const entries = [];
    if (input.children && entry.isDir) {
      const children = await readdir(path);
      if (children.length > 2000)
        throw new Error("This folder has too many entries for native browsing (maximum 2000).");
      for (const name of children) {
        try {
          const child = await this.folderAccessPath(resolve(path, name), input.root, rootIdentity);
          entries.push(await metadata(child.path, name));
        } catch {
          // Broken links and links escaping the selected root never become DAV entries.
        }
      }
    }
    await this.folderAccessPath(input.path, input.root, rootIdentity);
    return { ...entry, entries, rootIdentity };
  }

  private async transferFile(input: unknown, root?: unknown, rootIdentity?: unknown) {
    const path =
      root === undefined
        ? (await this.existing(input)).path
        : (await this.folderAccessPath(input, root, rootIdentity)).path;
    const expected = await stat(path, { bigint: true });
    const file = await open(
      path,
      constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
    );
    try {
      const info = await file.stat({ bigint: true });
      const verified =
        root === undefined
          ? (await this.existing(input)).path
          : (await this.folderAccessPath(input, root, rootIdentity)).path;
      const after = await stat(verified, { bigint: true });
      if (
        info.dev !== expected.dev ||
        info.ino !== expected.ino ||
        info.dev !== after.dev ||
        info.ino !== after.ino
      )
        throw new Error("The file changed while opening. Try again.");
      if (!info.isFile()) throw new Error("Not a file");
      if (info.size > BigInt(MAX_TRANSFER_FILE))
        throw new Error("File is too large to open on this computer (maximum 1 GB).");
      const version = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
      return { file, size: Number(info.size), version };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  private async readFileInfo(input: unknown, root?: unknown, rootIdentity?: unknown) {
    const { file, size, version } = await this.transferFile(input, root, rootIdentity);
    await file.close();
    return { size, version };
  }

  private async readFileChunk(input: Record<string, unknown>) {
    const { offset, length, version } = input;
    if (
      !Number.isSafeInteger(offset) ||
      Number(offset) < 0 ||
      !Number.isSafeInteger(length) ||
      Number(length) < 1 ||
      Number(length) > MAX_TRANSFER_CHUNK ||
      typeof version !== "string" ||
      version.length > 256
    )
      throw new Error("Invalid file chunk request");
    const transfer = await this.transferFile(input.path, input.root, input.rootIdentity);
    try {
      if (version !== transfer.version)
        throw new Error("The file changed while downloading. Try again.");
      if (Number(offset) > transfer.size) throw new Error("Invalid file chunk offset");
      const bytes = Buffer.alloc(Math.min(Number(length), transfer.size - Number(offset)));
      const { bytesRead } = await transfer.file.read(bytes, 0, bytes.length, Number(offset));
      const after = await transfer.file.stat({ bigint: true });
      if ([after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":") !== version)
        throw new Error("The file changed while downloading. Try again.");
      return { data: bytes.subarray(0, bytesRead).toString("base64"), offset, length: bytesRead };
    } finally {
      await transfer.file.close();
    }
  }

  private async preview(input: unknown, maxLines: unknown, startLine: unknown): Promise<string[]> {
    const text = (await this.file(input, MAX_TEXT_FILE, "preview")).toString("utf8");
    if (text.includes("\0")) throw new Error("Binary file");
    const limit = Math.min(12, Math.max(1, Number(maxLines) || 6));
    const start = Math.max(1, Number(startLine) || 1);
    return text
      .split(/\r?\n/)
      .slice(start - 1, start - 1 + limit)
      .map((line) => (line.length > 200 ? `${line.slice(0, 199)}…` : line));
  }

  private async writeText(input: unknown, content: unknown): Promise<void> {
    if (typeof content !== "string") throw new Error("Invalid file content");
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE)
      throw new Error(`File is too large to save (maximum ${MAX_TEXT_FILE / 1024 / 1024} MB).`);
    const { root, relative: rel } = await this.locate(input);
    const path = workspacePath(root, rel);
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    const save = async () => {
      const previous = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (previous?.isDirectory()) throw new Error("Cannot save text to a directory.");
      // Replace atomically, as the local command does.
      const temporary = `${path}.bycoda-${randomUUID()}`;
      const handle = await open(temporary, "wx", previous?.mode);
      try {
        await handle.writeFile(content, "utf8");
        if (previous) await handle.chmod(previous.mode);
        await handle.close();
        await rename(temporary, path);
      } catch (reason) {
        await handle.close().catch(() => {});
        await rm(temporary, { force: true });
        throw reason;
      }
      invalidateHostFilePaths(root);
    };
    const pending = (textFileSaves.get(key) ?? Promise.resolve()).then(save, save);
    textFileSaves.set(key, pending);
    try {
      await pending;
    } finally {
      if (textFileSaves.get(key) === pending) textFileSaves.delete(key);
    }
  }

  private async statFiles(input: unknown): Promise<FileMtime[]> {
    if (!Array.isArray(input) || input.length > MAX_STAT_FILES) throw new Error("Too many paths");
    return Promise.all(
      input.map(async (path) => {
        const info = await this.existing(path, true)
          .then(({ path: actual }) => stat(actual))
          .catch(() => null);
        return {
          path: String(path),
          mtimeMs: info?.isFile() ? Math.floor(info.mtimeMs) : null,
          isDir: info?.isDirectory() ?? false,
        };
      }),
    );
  }

  private async create(parent: unknown, name: unknown, isDir: unknown): Promise<string> {
    const { root, relative: rel } = await this.locate(parent);
    try {
      await createHostPath(root, rel, name, isDir);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(alreadyExists(String(name)));
      throw reason;
    }
    return joined(parent as string, name as string);
  }

  private async rename(input: unknown, name: unknown): Promise<string> {
    if (typeof name !== "string" || !name.trim() || /^[\\/]/.test(name) || name.includes("\0"))
      throw new Error("A file or folder name must be provided.");
    const { root, path: from } = await this.existing(input);
    const target = joined(dirname(input as string), name);
    const { root: targetRoot, relative: rel } = await this.locate(target);
    if (targetRoot !== root) throw new Error("Cannot move a file between working copies.");
    const to = workspacePath(root, rel);
    if (to === from) return input as string;
    if (
      await lstat(to).then(
        () => true,
        () => false,
      )
    )
      throw new Error(alreadyExists(name));
    if (!relative(from, to).startsWith("..")) throw new Error("Cannot move a folder into itself.");
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    invalidateHostFilePaths(root);
    return target;
  }

  private async delete(input: unknown): Promise<void> {
    const { root, path } = await this.existing(input);
    await rm(path, { recursive: true });
    invalidateHostFilePaths(root);
  }

  private async destination(from: unknown, destParent: unknown) {
    const source = await this.existing(from);
    const parent = await this.existing(destParent, true);
    if (!(await stat(parent.path)).isDirectory())
      throw new Error(`${String(destParent)} is not a folder`);
    if (
      (await stat(source.path)).isDirectory() &&
      !relative(source.path, parent.path).startsWith("..")
    )
      throw new Error("Cannot paste a folder into itself.");
    return { root: parent.root, source: source.path, parent: parent.path };
  }

  private async copy(from: unknown, destParent: unknown): Promise<string> {
    const { root, source, parent } = await this.destination(from, destParent);
    const name = basename(source);
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    for (let n = 0; ; n++) {
      const candidate = n === 0 ? name : n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`;
      const to = resolve(parent, candidate);
      if (
        await lstat(to).then(
          () => true,
          () => false,
        )
      )
        continue;
      await cp(source, to, { recursive: true, errorOnExist: true });
      invalidateHostFilePaths(root);
      return joined(destParent as string, candidate);
    }
  }

  private async move(from: unknown, destParent: unknown): Promise<string> {
    const { root, source, parent } = await this.destination(from, destParent);
    const name = basename(source);
    const to = resolve(parent, name);
    if (to === source) return from as string;
    if (
      await lstat(to).then(
        () => true,
        () => false,
      )
    )
      throw new Error(alreadyExists(name));
    await rename(source, to);
    invalidateHostFilePaths(root);
    return joined(destParent as string, name);
  }

  private async gitRoot(input: unknown): Promise<string> {
    const { path } = await this.existing(input, true);
    if (!(await stat(path)).isDirectory()) throw new Error("Not a working copy");
    return path;
  }

  private async checkpoint(command: string, input: Record<string, unknown>) {
    const cwd = await this.gitRoot(input.cwd);
    if (typeof input.sessionId !== "string") throw new Error("Invalid checkpoint session");
    const path = input.relative == null ? undefined : String(input.relative);
    if (command === "session_checkpoint_status")
      return this.checkpoints.status(input.sessionId, cwd);
    if (command === "session_checkpoint_file_diff") {
      if (path === undefined) throw new Error("Choose a checkpoint file");
      return this.checkpoints.fileDiff(input.sessionId, cwd, path);
    }
    const session = input.sessionId;
    if (input.expectedCheckpoint !== undefined && typeof input.expectedCheckpoint !== "string")
      throw new Error("Invalid expected checkpoint");
    const change = () =>
      this.checkpoints.change(session, cwd, path, command === "session_checkpoint_undo", input.expectedCheckpoint as string | undefined);
    return command === "session_checkpoint_undo" ? withHostGitMutation(cwd, change) : change();
  }

  /** This machine's skills for a project folder here; the desktop drops
   * the ones it hides, as it does for its own. */
  private async listSkills(input: unknown, disabled: unknown) {
    if (
      disabled != null &&
      (!Array.isArray(disabled) ||
        disabled.length > 10000 ||
        disabled.some((path) => typeof path !== "string" || path.length > 4096))
    )
      throw new Error("Invalid disabled skill paths.");
    const disabledPaths = (disabled ?? []) as string[];
    // An empty `cwd` is "no project": this machine's personal skills only.
    if (input === "") return listHostSkills(null, undefined, disabledPaths);
    const { path } = await this.existing(input, true);
    return listHostSkills(path, undefined, disabledPaths);
  }

  /** A listed skill's files. The skill may live in the home folder, outside
   * every project, so it is checked against the listing, not the roots. */
  private async exportSkill(skill: unknown, cwd: unknown) {
    if (cwd === "") return exportHostSkill(skill, null);
    const { path } = await this.existing(cwd, true);
    return exportHostSkill(skill, path);
  }

  private async deleteSkill(skill: unknown, cwd: unknown) {
    if (cwd === "") return deleteHostSkill(skill, null);
    const { path } = await this.existing(cwd, true);
    return deleteHostSkill(skill, path);
  }

  private async searchProject(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid search");
    const options = input as Record<string, unknown>;
    return searchHostContent(await this.gitRoot(options.cwd), options);
  }

  private async gitIndex(input: unknown, full = true) {
    return hostGitIndex(await this.gitRoot(input), full);
  }

  private async gitFileDiff(cwd: unknown, relative: unknown, staged: unknown) {
    return hostFileDiff(await this.gitRoot(cwd), relative, staged === true);
  }

  private async gitAction(
    cwd: unknown,
    action: string,
    relative?: unknown,
    message?: unknown,
    contents?: unknown,
    expectedOriginal?: unknown,
    expectedCurrent?: unknown,
    expectedSnapshot?: unknown,
  ) {
    const root = await this.gitRoot(cwd);
    return hostGitAction(
      root,
      action,
      relative,
      message,
      contents,
      expectedOriginal,
      expectedCurrent,
      expectedSnapshot === undefined ? undefined : () => verifyGitManagementSnapshot(root, expectedSnapshot),
    );
  }

  private async gitCommand(cwd: unknown, args: string[]): Promise<string> {
    const root = await this.gitRoot(cwd);
    return (
      await exec(
        "git",
        [...(args.includes("--") ? ["--literal-pathspecs"] : []), "-c", "core.pager=cat", ...args],
        {
          cwd: root,
          timeout: ["pull", "push", "fetch", "commit"].includes(args[0]) ? 120_000 : 30_000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
        },
      )
    ).stdout;
  }

  private async gitCommit(cwd: unknown, message: unknown, amend: unknown, signoff: unknown) {
    if (typeof message !== "string" || !message.trim() || message.length > 100_000)
      throw new Error("Enter a commit message");
    const unresolved = await hostUnmerged(await this.gitRoot(cwd));
    if (unresolved.length) throw new Error(unmergedMessage(unresolved));
    await this.gitCommand(cwd, [
      "commit",
      ...(amend === true ? ["--amend"] : []),
      ...(signoff === true ? ["--signoff"] : []),
      "-m",
      message,
    ]);
  }

  private async gitSync(cwd: unknown) {
    await this.gitCommand(cwd, ["pull", "--ff-only"]);
    await this.gitAction(cwd, "push");
  }

  private async ghCommand(cwd: unknown, args: string[]): Promise<string> {
    const root = await this.gitRoot(cwd);
    return (
      await exec("gh", args, {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
      })
    ).stdout.trim();
  }

  private async gitPrStatus(cwd: unknown) {
    const output = await this.ghCommand(cwd, [
      "pr",
      "list",
      "--head",
      (await this.gitCommand(cwd, ["symbolic-ref", "--short", "HEAD"])).trim(),
      "--state",
      "all",
      "--json",
      "number,title,url,state",
      "--limit",
      "20",
    ]);
    const prs = JSON.parse(output) as GitPr[];
    const pr = prs.find((entry) => entry.state.toLowerCase() === "open") ?? prs[0];
    return pr ? { ...pr, state: pr.state.toLowerCase() } : null;
  }

  private async gitPrCreate(
    cwd: unknown,
    title: unknown,
    body: unknown,
    base: unknown,
    head: unknown,
    repository?: unknown,
  ) {
    if (
      [title, body, base, head].some((value) => typeof value !== "string" || value.length > 100_000)
    )
      throw new Error("Invalid pull request");
    if (repository !== undefined && (typeof repository !== "string" || !/^[a-z0-9.-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository))) throw new Error("Invalid pull request repository");
    return this.ghCommand(cwd, [
      "pr",
      "create",
      ...(typeof repository === "string" ? ["--repo", repository] : []),
      "--title",
      title as string,
      "--body",
      body as string,
      "--base",
      base as string,
      "--head",
      head as string,
    ]);
  }

  private gitSha(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9a-f]{4,40}$/i.test(value))
      throw new Error("Invalid commit");
    return value;
  }

  private async gitCommitSha(cwd: unknown, input: unknown): Promise<string> {
    const sha = this.gitSha(input);
    const resolved = await this.gitCommand(cwd, ["rev-parse", "--verify", `${sha}^{commit}`]).catch(
      () => "",
    );
    if (!/^[0-9a-f]{40,64}$/i.test(resolved.trim())) throw new Error("Unknown commit");
    return resolved.trim();
  }

  private async gitHistory(cwd: unknown, limit: unknown, all: boolean) {
    const count = Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, Number(limit))) : 200;
    const [head, upstream, index, refs] = await Promise.all([
      this.gitCommand(cwd, ["rev-parse", "--verify", "HEAD"]).catch(() => ""),
      this.gitCommand(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => ""),
      this.gitIndex(cwd),
      this.gitCommand(cwd, [
        "for-each-ref",
        HISTORY_REFS_FORMAT,
        "refs/heads",
        "refs/tags",
        "refs/remotes",
      ]),
    ]);
    const headSha = head.trim() || null;
    if (!headSha) return { head: null, commits: [] };
    // Not `--all`: that would pull in `refs/stash` and its index commits.
    const tips = all ? ["HEAD", "--branches", "--remotes", "--tags"] : ["HEAD"];
    if (!all && upstream.trim()) tips.push("@{upstream}");
    if (!all && index.defaultBranch && index.remote) {
      const defaultRef = `refs/remotes/origin/${index.defaultBranch}`;
      const exists = await this.gitCommand(cwd, ["rev-parse", "--verify", defaultRef]).then(
        () => true,
        () => false,
      );
      if (exists) tips.push(`origin/${index.defaultBranch}`);
    }
    const output = await this.gitCommand(cwd, [
      "log",
      "--topo-order",
      `--max-count=${count}`,
      HISTORY_FORMAT,
      ...tips,
    ]);
    const commits = parseHistoryLog(output, headSha, parseHistoryRefs(refs));
    return { head: headSha, commits };
  }

  private async gitCommitFiles(cwd: unknown, shaInput: unknown) {
    const sha = await this.gitCommitSha(cwd, shaInput);
    const [names, stats] = await Promise.all([
      this.gitCommand(cwd, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--no-renames",
        "--name-status",
        "-r",
        sha,
      ]),
      this.gitCommand(cwd, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--no-renames",
        "--numstat",
        "-r",
        sha,
      ]),
    ]);
    const counts = new Map(
      stats
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [added, removed, path] = line.split("\t");
          return [
            path,
            { additions: Number(added) || 0, deletions: Number(removed) || 0 },
          ] as const;
        }),
    );
    return names
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [code, relativePath] = line.split("\t");
        return {
          path: relativePath,
          relative: relativePath,
          status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
          ...(counts.get(relativePath) ?? { additions: 0, deletions: 0 }),
          staged: false,
          unstaged: false,
        };
      });
  }

  private async gitCommitFileDiff(cwd: unknown, shaInput: unknown, input: unknown) {
    const sha = await this.gitCommitSha(cwd, shaInput);
    const root = await this.gitRoot(cwd);
    const path = relative(root, workspacePath(root, input)).replace(/\\/g, "/");
    const parent = await this.gitCommand(root, ["rev-parse", "--verify", `${sha}^`]).catch(
      () => "",
    );
    const [original, current] = await Promise.all([
      parent
        ? this.gitBlob(root, `${parent.trim()}:${path}`)
        : Promise.resolve({ bytes: Buffer.alloc(0), tooLarge: false }),
      this.gitBlob(root, `${sha}:${path}`),
    ]);
    const binary = original.bytes.includes(0) || current.bytes.includes(0);
    const tooLarge =
      original.tooLarge ||
      current.tooLarge ||
      original.bytes.length > MAX_TEXT_FILE ||
      current.bytes.length > MAX_TEXT_FILE;
    const status =
      !original.bytes.length && current.bytes.length
        ? "added"
        : original.bytes.length && !current.bytes.length
          ? "deleted"
          : "modified";
    return {
      path,
      relative: path,
      status,
      original: binary || tooLarge ? "" : original.bytes.toString("utf8"),
      current: binary || tooLarge ? "" : current.bytes.toString("utf8"),
      binary,
      tooLarge,
    };
  }

  private async gitBlob(root: string, spec: string) {
    try {
      const { stdout } = await exec("git", ["show", spec], {
        cwd: root,
        timeout: 30_000,
        maxBuffer: MAX_TEXT_FILE + 1024,
        encoding: "buffer",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return { bytes: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout), tooLarge: false };
    } catch (reason) {
      return { bytes: Buffer.alloc(0), tooLarge: String(reason).includes("maxBuffer") };
    }
  }

  private async gitStagedContext(cwd: unknown) {
    const [index, summary, patch] = await Promise.all([
      this.gitIndex(cwd),
      this.gitCommand(cwd, ["diff", "--cached", "--stat"]),
      this.gitCommand(cwd, ["diff", "--cached", "--no-ext-diff"]),
    ]);
    return { branch: index.branch, summary, patch };
  }

  private async gitRangeContext(cwd: unknown) {
    const index = await this.gitIndex(cwd);
    if (!index.defaultBranch) throw new Error("Default branch is unknown");
    const base = `origin/${index.defaultBranch}`;
    const head = index.branch ?? "HEAD";
    const [commitSummary, diffSummary, diffPatch] = await Promise.all([
      this.gitCommand(cwd, ["log", "--oneline", `${base}..HEAD`]),
      this.gitCommand(cwd, ["diff", "--stat", `${base}...HEAD`]),
      this.gitCommand(cwd, ["diff", "--no-ext-diff", `${base}...HEAD`]),
    ]);
    return { base: index.defaultBranch, head, commitSummary, diffSummary, diffPatch };
  }

  private async gitBranches(cwd: unknown) {
    const state = await hostBranches(await this.gitRoot(cwd));
    return {
      current: state.current,
      detached: state.current === null,
      branches: [
        ...state.branches.map((name) => ({ name, current: name === state.current, remote: null })),
        ...state.remotes.map((entry) => ({
          name: entry.name,
          current: false,
          remote: entry.remote,
        })),
      ],
    };
  }

  private async gitCheckout(cwd: unknown, name: unknown, remote: unknown) {
    const root = await this.gitRoot(cwd);
    const state = await this.withIdleGitProject(root, () => switchHostBranch(root, name, remote));
    return state.current ?? "HEAD";
  }

  private async gitCreateBranch(cwd: unknown, name: unknown) {
    const root = await this.gitRoot(cwd);
    const state = await this.withIdleGitProject(root, () => createHostBranch(root, name));
    return state.current ?? "HEAD";
  }

  private async withIdleGitProject<T>(cwd: string, action: () => Promise<T>): Promise<T> {
    const { root } = await this.locate(cwd);
    const project = this.store
      .projects()
      .find(
        (candidate) =>
          candidate.cwd === root || this.roots.get(candidate.cwd)?.roots.includes(root),
      );
    if (!project) throw new Error("Project is unavailable");
    return this.withIdleProject(project.id, action);
  }

  private async gitActionCommand(command: GitActionCommand, input: Record<string, unknown>) {
    const root = await this.gitRoot(input.cwd);
    const run = () => runGitAction(command, root, input);
    return GIT_ACTIONS_NEEDING_IDLE.has(command) ? this.withIdleGitProject(root, run) : run();
  }

  private async gitWorktrees(cwd: unknown) {
    const listed = await hostWorktrees(await this.gitRoot(cwd));
    return {
      defaultRoot: listed.defaultRoot,
      worktrees: listed.worktrees.map((tree) => ({
        ...tree,
        locked: tree.locked,
        prunable: tree.missing,
        dirty: null,
        unpushed: null,
        sessionIds: [],
      })),
    };
  }
}
