import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ManagedWorkspace,
  RewindRefPhase,
  TurnGitRecord,
  TurnGitSnapshot,
  TurnRefPhase,
  WorkspacePathManifestEntry,
} from "./workspace-contracts";
import type { TurnGitHistory } from "./workspace-service-contracts";
import { withHostGitMutation } from "./git-mutations";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export function refComponent(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid recovery ref component");
  return value;
}
export const turnRef = (workspaceId: string, turnId: string, phase: TurnRefPhase) =>
  `refs/bycoda/turns/${refComponent(workspaceId)}/${refComponent(turnId)}/${phase}` as const;
export const rewindRef = (operationId: string, phase: RewindRefPhase) =>
  `refs/bycoda/rewinds/${refComponent(operationId)}/${phase}` as const;

/** No shell, prompts or inherited alternate Git directories. Binary I/O preserves source bytes. */
export async function turnGit(
  cwd: string,
  args: string[],
  input?: Buffer | string,
  index?: string,
): Promise<Buffer> {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env };
    for (const key of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_COMMON_DIR",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ])
      delete env[key];
    const child = spawn("git", ["--no-pager", ...args], {
      cwd,
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_LITERAL_PATHSPECS: "1",
        GIT_AUTHOR_NAME: "bycoda recovery",
        GIT_AUTHOR_EMAIL: "recovery@bycoda.local",
        GIT_COMMITTER_NAME: "bycoda recovery",
        GIT_COMMITTER_EMAIL: "recovery@bycoda.local",
        ...(index ? { GIT_INDEX_FILE: index } : {}),
      },
    });
    const chunks: Buffer[] = [];
    let error = "";
    let size = 0;
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > 256 * 1024 * 1024) child.kill();
      else chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      if (error.length < 4000) error += data.toString();
    });
    child.on("error", (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Git ${args[0]} failed: ${error.trim() || code}`));
      else resolveResult(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}
export const gitText = async (cwd: string, args: string[]) =>
  (await turnGit(cwd, args)).toString().trim();

/** Durable replacement; incomplete temporary files are never treated as records. */
export async function durableWrite(path: string, bytes: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
async function optionalRead(path: string): Promise<Buffer | null> {
  return readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
type SourceEntry = WorkspacePathManifestEntry & { mode: string; bytes: Buffer };
type GitContext = { head: string; indexPath: string; gitDirectory: string };
function safeRelative(path: string) {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git" ||
          (process.platform === "win32" && /[:<>"|?*]|[. ]$/.test(part)),
      )
  )
    throw new Error("Unsafe captured path");
}
async function safeParents(cwd: string, path: string, fileMeansAbsent = false): Promise<boolean> {
  safeRelative(path);
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = join(cwd, ...parts.slice(0, i));
    const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isFile() && fileMeansAbsent) return false;
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new Error(`Unsafe parent: ${path}`);
    if (await lstat(join(parent, ".git")).catch(() => null))
      throw new Error(`Nested repository: ${path}`);
  }
  return true;
}
async function sourceEntry(cwd: string, path: string): Promise<SourceEntry | null> {
  if (!(await safeParents(cwd, path, true))) return null;
  const absolute = join(cwd, path);
  const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (info.isDirectory() && !info.isSymbolicLink()) {
    if (await lstat(join(absolute, ".git")).catch(() => null))
      throw new Error(`Nested repository: ${path}`);
    // A tracked file may have become a directory; children are enumerated separately.
    return null;
  }
  if (info.isSymbolicLink()) {
    const target = await readlink(absolute);
    const resolved = resolve(dirname(absolute), target);
    const relation = relative(cwd, resolved);
    if (isAbsolute(target) || relation.startsWith("..") || isAbsolute(relation))
      throw new Error(`Unsafe symlink: ${path}`);
    const bytes = Buffer.from(target);
    return {
      path,
      kind: "symlink",
      fingerprint: digest(Buffer.concat([Buffer.from("120000\0"), bytes])),
      mode: "120000",
      bytes,
    };
  }
  if (!info.isFile()) throw new Error(`Unsupported directory, submodule or reparse point: ${path}`);
  if (info.size > 32 * 1024 * 1024) throw new Error(`Capture size limit (32 MiB): ${path}`);
  const bytes = await readFile(absolute);
  const mode = process.platform !== "win32" && info.mode & 0o111 ? "100755" : "100644";
  return {
    path,
    kind: "file",
    fingerprint: digest(Buffer.concat([Buffer.from(`${mode}\0`), bytes])),
    mode,
    bytes,
  };
}

export interface GitTurnHistoryOptions {
  /** Private durable data outside the materialized workspace. Never a user checkout. */
  root: string;
  /** Fresh authoritative lookup must verify canonical common-Git identity and owned
   * worktree registration; repositoryId is an opaque registry identity, not a pathname. */
  workspace(workspaceId: string): Promise<ManagedWorkspace>;
  /** Explicit ignored source inputs cannot be silently treated as generated caches. */
  uncapturedInputs?(workspace: ManagedWorkspace): Promise<string[]>;
}
/** Full managed source snapshots are independent of legacy per-file review checkpoints and compaction. */
export class GitTurnHistory implements TurnGitHistory {
  constructor(readonly options: GitTurnHistoryOptions) {}
  private recordPath(workspace: string, turn: string) {
    return join(this.options.root, "turns", refComponent(workspace), `${refComponent(turn)}.json`);
  }
  async workspace(id: string) {
    const workspace = await this.options.workspace(id);
    if (workspace.id !== id || workspace.directoryState !== "present")
      throw new Error("Managed workspace is not present");
    if (workspace.branchRef === workspace.targetBranchRef)
      throw new Error("Rewind cannot modify the integration branch");
    return workspace;
  }
  async assertBranch(workspace: ManagedWorkspace) {
    const branch = await gitText(workspace.path, ["symbolic-ref", "HEAD"]);
    if (branch !== workspace.branchRef) throw new Error("Workspace branch changed");
    const lines = (
      await gitText(workspace.path, [
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-path",
        "index",
        "--verify",
        "HEAD^{commit}",
      ])
    )
      .split("\n")
      .map((line) => line.trim());
    if (lines.length !== 4) throw new Error("Unsupported Git root path");
    const [top, gitDirectory, indexPath, head] = lines;
    const normalized = (path: string) =>
      process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    if (normalized(top) !== normalized(workspace.path))
      throw new Error("Workspace is not the Git root");
    return { head, indexPath, gitDirectory } satisfies GitContext;
  }
  private async inventory(cwd: string, excluded = new Set<string>()): Promise<SourceEntry[]> {
    const paths = [
      ...new Set(
        (await turnGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
          .toString()
          .split("\0")
          .filter((path) => !!path && !excluded.has(path)),
      ),
    ].sort();
    if (paths.length > 20_000) throw new Error("Capture path limit (20,000)");
    const result: SourceEntry[] = [];
    let size = 0;
    for (const path of paths) {
      const entry = await sourceEntry(cwd, path);
      if (entry) {
        size += entry.bytes.length;
        if (size > 128 * 1024 * 1024) throw new Error("Capture total size limit (128 MiB)");
        result.push(entry);
      }
    }
    return result;
  }
  private async validateIndex(cwd: string, gitDirectory: string) {
    if (
      (await gitText(cwd, ["config", "--bool", "core.sparseCheckout"]).catch(() => "false")) ===
      "true"
    )
      throw new Error("Disable sparse checkout before exact capture");
    if (await gitText(cwd, ["rev-parse", "--shared-index-path"]))
      throw new Error("Disable split index before exact capture");
    const entries = (await turnGit(cwd, ["ls-files", "--stage", "-z"])).toString().split("\0");
    if (entries.some((entry) => /^\d+ [a-f0-9]+ [123]\t/.test(entry)))
      throw new Error("Resolve index conflicts before exact capture");
    if (entries.some((entry) => entry.startsWith("160000 ")))
      throw new Error("Submodules are not supported by exact capture");
    // Intent-to-add is not represented by write-tree. Refuse rather than silently normalize it.
    const visible = await turnGit(cwd, ["diff", "--cached", "--raw", "--ita-visible-in-index"]);
    const invisible = await turnGit(cwd, ["diff", "--cached", "--raw", "--ita-invisible-in-index"]);
    if (!visible.equals(invisible))
      throw new Error("Stage or unstage intent-to-add entries before exact capture");
    const markers = await Promise.all(
      ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].map(
        (marker) =>
          lstat(join(gitDirectory, marker)).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          }),
      ),
    );
    if (markers.some(Boolean))
      throw new Error("Finish the in-progress Git operation before capture");
  }
  async fingerprint(workspace: ManagedWorkspace): Promise<string> {
    return this.fingerprintFrom(workspace, await this.assertBranch(workspace));
  }
  private async fingerprintFrom(workspace: ManagedWorkspace, context: GitContext) {
    const index = (await optionalRead(context.indexPath)) ?? Buffer.alloc(0);
    const entries = await this.inventory(workspace.path);
    return digest(
      JSON.stringify([
        workspace.branchRef,
        context.head,
        digest(index),
        entries.map(({ path, kind, fingerprint }) => ({ path, kind, fingerprint })),
      ]),
    );
  }
  private async indexPath(cwd: string) {
    return gitText(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  }
  private async indexBytes(cwd: string) {
    return (await optionalRead(await this.indexPath(cwd))) ?? Buffer.alloc(0);
  }
  private async commit(cwd: string, tree: string, message: string) {
    return (await turnGit(cwd, ["commit-tree", tree], `${message}\n`)).toString().trim();
  }
  /** Caller holds the common Git gate and a writer reservation when preparing rescue. */
  async capture(workspace: ManagedWorkspace): Promise<TurnGitSnapshot> {
    const context = await this.assertBranch(workspace);
    await this.validateIndex(workspace.path, context.gitDirectory);
    if ((await this.options.uncapturedInputs?.(workspace))?.length)
      throw new Error(
        "Ignored source inputs need private capture before exact rewind is available",
      );
    const initial = await this.fingerprintFrom(workspace, context);
    const head = context.head;
    const bytes = (await optionalRead(context.indexPath)) ?? Buffer.alloc(0);
    const indexMetadataId = digest(bytes);
    await durableWrite(join(this.options.root, "indexes", indexMetadataId), bytes);
    const temporary = join(this.options.root, "scratch", randomUUID());
    await mkdir(dirname(temporary), { recursive: true });
    try {
      if (bytes.length) await writeFile(temporary, bytes);
      else await turnGit(workspace.path, ["read-tree", "--empty"], undefined, temporary);
      const indexTree = (await turnGit(workspace.path, ["write-tree"], undefined, temporary))
        .toString()
        .trim();
      await rm(temporary, { force: true });
      await turnGit(workspace.path, ["read-tree", "--empty"], undefined, temporary);
      const entries = await this.inventory(workspace.path);
      const objectIds = new Map<string, string>();
      const files = entries.filter((entry) => entry.kind === "file");
      // Hash ordinary files in bounded argv batches, rather than launching a Git process per file.
      // The final full-content recheck rejects external writes during these reads.
      for (let offset = 0; offset < files.length; offset += 32) {
        const batch = files.slice(offset, offset + 32);
        const ids = (
          await turnGit(workspace.path, [
            "hash-object",
            "-w",
            "--no-filters",
            "--",
            ...batch.map((entry) => entry.path),
          ])
        )
          .toString()
          .trim()
          .split("\n");
        if (ids.length !== batch.length) throw new Error("Incomplete blob capture");
        batch.forEach((entry, index) => {
          const expected = createHash(head.length === 64 ? "sha256" : "sha1")
            .update(`blob ${entry.bytes.length}\0`)
            .update(entry.bytes)
            .digest("hex");
          if (expected !== ids[index].trim())
            throw new Error(`Source changed while capturing: ${entry.path}`);
          objectIds.set(entry.path, expected);
        });
      }
      for (const entry of entries.filter((entry) => entry.kind === "symlink")) {
        objectIds.set(
          entry.path,
          (
            await turnGit(
              workspace.path,
              ["hash-object", "-w", "--stdin", "--no-filters"],
              entry.bytes,
            )
          )
            .toString()
            .trim(),
        );
      }
      await turnGit(
        workspace.path,
        ["update-index", "-z", "--index-info"],
        entries
          .map((entry) => `${entry.mode} ${objectIds.get(entry.path)}\t${entry.path}\0`)
          .join(""),
        temporary,
      );
      const worktreeTree = (await turnGit(workspace.path, ["write-tree"], undefined, temporary))
        .toString()
        .trim();
      if ((await this.fingerprint(workspace)) !== initial)
        throw new Error("Workspace changed during capture; retry after writers settle");
      return {
        head,
        index: await this.commit(workspace.path, indexTree, "bycoda exact index"),
        worktree: await this.commit(workspace.path, worktreeTree, "bycoda raw worktree"),
        indexMetadataId,
        paths: entries.map(({ path, kind, fingerprint }) => ({ path, kind, fingerprint })),
        capturedAt: Date.now(),
      };
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async retain(
    workspace: ManagedWorkspace,
    snapshot: TurnGitSnapshot,
    refs: [string, string, string],
  ) {
    await turnGit(
      workspace.path,
      ["update-ref", "--stdin"],
      `start\ncreate ${refs[0]} ${snapshot.head}\ncreate ${refs[1]} ${snapshot.index}\ncreate ${refs[2]} ${snapshot.worktree}\nprepare\ncommit\n`,
    );
  }
  async begin(request: Parameters<TurnGitHistory["begin"]>[0]): Promise<TurnGitRecord> {
    const workspace = await this.workspace(request.workspaceId);
    return withHostGitMutation(workspace.path, async () => {
      const previous = await this.get(request.workspaceId, request.userBlockId);
      if (previous) {
        if (
          previous.runId !== request.runId ||
          previous.sessionId !== request.sessionId ||
          previous.conversationRevision !== request.conversationRevision
        )
          throw new Error("Turn boundary identity changed");
        if (previous.before.status === "complete") return previous;
      }
      const record: TurnGitRecord = {
        ...request,
        branchRef: workspace.branchRef,
        before: { status: "blocked", reason: "Capture incomplete" },
      };
      try {
        const snapshot = await this.capture(workspace);
        await this.retain(workspace, snapshot, [
          turnRef(workspace.id, request.userBlockId, "before-head"),
          turnRef(workspace.id, request.userBlockId, "before-index"),
          turnRef(workspace.id, request.userBlockId, "before-worktree"),
        ]);
        record.before = { status: "complete", snapshot };
      } catch (error) {
        record.before = {
          status: "blocked",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      await durableWrite(
        this.recordPath(workspace.id, request.userBlockId),
        JSON.stringify(record),
      );
      return record;
    });
  }
  async end(request: Parameters<TurnGitHistory["end"]>[0]): Promise<TurnGitRecord> {
    const workspace = await this.workspace(request.workspaceId);
    return withHostGitMutation(workspace.path, async () => {
      const record = await this.get(workspace.id, request.userBlockId);
      if (!record || record.sessionId !== request.sessionId || record.runId !== request.runId)
        throw new Error("Unknown accepted turn");
      if (record.after) return record;
      try {
        const snapshot = await this.capture(workspace);
        // Retain all optional after-state objects in one ref transaction.
        const prefix = `refs/bycoda/turns/${refComponent(workspace.id)}/${refComponent(request.userBlockId)}`;
        await this.retain(workspace, snapshot, [
          `${prefix}/after-head`,
          `${prefix}/after-index`,
          `${prefix}/after-worktree`,
        ]);
        record.after = { status: "complete", snapshot };
      } catch (error) {
        record.after = {
          status: "blocked",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      await durableWrite(
        this.recordPath(workspace.id, request.userBlockId),
        JSON.stringify(record),
      );
      return record;
    });
  }
  async get(workspace: string, turn: string): Promise<TurnGitRecord | null> {
    const bytes = await optionalRead(this.recordPath(workspace, turn));
    return bytes ? JSON.parse(bytes.toString()) : null;
  }
  async list(workspace: string, session: string): Promise<TurnGitRecord[]> {
    const directory = join(this.options.root, "turns", refComponent(workspace));
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(
          async (name) =>
            JSON.parse(await readFile(join(directory, name), "utf8")) as TurnGitRecord,
        ),
    );
    return records
      .filter((record) => record.sessionId === session)
      .sort((a, b) => a.conversationRevision - b.conversationRevision);
  }
  private async snapshotEntries(cwd: string, snapshot: TurnGitSnapshot): Promise<SourceEntry[]> {
    const rows = (await turnGit(cwd, ["ls-tree", "-rz", snapshot.worktree]))
      .toString()
      .split("\0")
      .filter(Boolean);
    const result: SourceEntry[] = [];
    const parsed = rows.map((row) => {
      const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Invalid worktree snapshot");
      const [, mode, oid, path] = match;
      safeRelative(path);
      return { mode, oid, path };
    });
    const objects = await turnGit(
      cwd,
      ["cat-file", "--batch"],
      parsed.map((entry) => `${entry.oid}\n`).join(""),
    );
    let offset = 0;
    for (const { mode, oid, path } of parsed) {
      const end = objects.indexOf(10, offset);
      const header = objects.subarray(offset, end).toString();
      const match = /^([a-f0-9]+) blob (\d+)$/.exec(header);
      if (end < 0 || !match || match[1] !== oid) throw new Error("Invalid captured blob stream");
      const length = Number(match[2]);
      const bytes = objects.subarray(end + 1, end + 1 + length);
      if (bytes.length !== length || objects[end + 1 + length] !== 10)
        throw new Error("Truncated captured blob stream");
      offset = end + 2 + length;
      const fingerprint = digest(Buffer.concat([Buffer.from(`${mode}\0`), bytes]));
      if (!snapshot.paths.some((entry) => entry.path === path && entry.fingerprint === fingerprint))
        throw new Error("Snapshot manifest does not match Git content");
      result.push({ path, mode, bytes, kind: mode === "120000" ? "symlink" : "file", fingerprint });
    }
    if (result.length !== snapshot.paths.length) throw new Error("Snapshot manifest is incomplete");
    return result;
  }
  /** Resume a partial restore only when every byte is still either the rescued or target byte.
   * Unknown/ignored obstructions are never removed. No reset --hard or git clean is used. */
  async restore(
    workspace: ManagedWorkspace,
    target: TurnGitSnapshot,
    source: TurnGitSnapshot,
    operationId = digest(`${source.worktree}:${target.worktree}`),
  ) {
    await this.assertBranch(workspace);
    const cwd = workspace.path;
    const head = await gitText(cwd, ["rev-parse", "HEAD"]);
    if (head !== source.head && head !== target.head)
      throw new Error("External HEAD drift; recovery blocked");
    const targetEntries = await this.snapshotEntries(cwd, target);
    const sourceEntries = await this.snapshotEntries(cwd, source);
    const targets = new Map(targetEntries.map((entry) => [entry.path, entry]));
    const sources = new Map(sourceEntries.map((entry) => [entry.path, entry]));
    const paths = [...new Set([...targets.keys(), ...sources.keys()])].sort();
    refComponent(operationId);
    const temporaryPaths = targetEntries.map((entry) => ({
      path: `${entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/") + 1) : ""}.bycoda-rewind-${operationId}-${digest(entry.path).slice(0, 12)}.tmp`,
      targetPath: entry.path,
      fingerprint: entry.fingerprint,
    }));
    const ownershipPath = join(this.options.root, "restores", `${operationId}.json`);
    const ownership = JSON.stringify({
      source: source.worktree,
      target: target.worktree,
      temporaryPaths,
    });
    const previousOwnership = await optionalRead(ownershipPath);
    if (previousOwnership && previousOwnership.toString() !== ownership)
      throw new Error("Restore operation identity changed");
    // Sibling staging files give an atomic final replacement, including across volumes.
    // A durable private manifest binds their ownership before any staging file is created.
    for (const entry of temporaryPaths) {
      if (sources.has(entry.path) || targets.has(entry.path))
        throw new Error("Restore staging path collides with captured source");
      if (!(await safeParents(cwd, entry.path, true))) continue;
      const info = await lstat(join(cwd, entry.path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info) continue;
      if (!previousOwnership) throw new Error("Restore staging path already exists");
      const wanted = targets.get(entry.targetPath)!;
      if (wanted.kind === "symlink") {
        if (
          !info.isSymbolicLink() ||
          (await readlink(join(cwd, entry.path))) !== wanted.bytes.toString()
        )
          throw new Error("External restore staging drift");
      } else {
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("Unsafe restore staging entry");
        const bytes = await readFile(join(cwd, entry.path));
        // A terminated write can leave a prefix of this known blob at our reserved path.
        if (
          bytes.length > wanted.bytes.length ||
          !bytes.equals(wanted.bytes.subarray(0, bytes.length))
        )
          throw new Error("External restore staging content drift");
      }
      await rm(join(cwd, entry.path));
    }
    if (!previousOwnership) await durableWrite(ownershipPath, ownership);
    const replacementDirectories = new Set<string>();
    const inspectReplacement = async (directory: string): Promise<void> => {
      await safeParents(cwd, directory);
      for (const child of await readdir(join(cwd, directory), { withFileTypes: true })) {
        const path = `${directory}/${child.name}`;
        safeRelative(path);
        if (child.isDirectory() && !child.isSymbolicLink()) await inspectReplacement(path);
        else {
          const entry = await sourceEntry(cwd, path);
          if (!entry || entry.fingerprint !== sources.get(path)?.fingerprint)
            throw new Error(`Uncaptured directory obstruction: ${path}`);
        }
      }
      replacementDirectories.add(directory);
    };
    for (const path of targets.keys()) {
      if (!(await safeParents(cwd, path, true))) continue;
      const info = await lstat(join(cwd, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (info?.isDirectory() && !info.isSymbolicLink()) {
        if (![...sources.keys()].some((sourcePath) => sourcePath.startsWith(`${path}/`)))
          throw new Error(`Unknown directory obstruction: ${path}`);
        await inspectReplacement(path);
      }
    }
    // Reject unknown new source paths, including newly tracked paths.
    const current = await this.inventory(cwd, new Set(temporaryPaths.map((entry) => entry.path)));
    for (const entry of current)
      if (!targets.has(entry.path) && !sources.has(entry.path))
        throw new Error(`External new path: ${entry.path}`);
    for (const path of paths) {
      const entry = await sourceEntry(cwd, path);
      const fingerprint = entry?.fingerprint;
      if (
        fingerprint !== sources.get(path)?.fingerprint &&
        fingerprint !== targets.get(path)?.fingerprint
      )
        throw new Error(`External content drift: ${path}`);
    }
    const targetIndex = await readFile(join(this.options.root, "indexes", target.indexMetadataId));
    if (digest(targetIndex) !== target.indexMetadataId) throw new Error("Index metadata corrupted");
    const currentIndex = digest(await this.indexBytes(cwd));
    if (currentIndex !== source.indexMetadataId && currentIndex !== target.indexMetadataId)
      throw new Error("External index drift; recovery blocked");
    const indexPath = await this.indexPath(cwd);
    const lockPath = `${indexPath}.lock`;
    const lock = await open(lockPath, "wx", 0o600);
    try {
      const fresh = await this.assertBranch(workspace);
      if (fresh.head !== head || fresh.indexPath !== indexPath)
        throw new Error("Workspace branch or HEAD changed while acquiring index lock");
      const lockedIndex = digest(await this.indexBytes(cwd));
      if (lockedIndex !== currentIndex)
        throw new Error("Index changed while acquiring restore lock");
      // Git's CAS also protects against an external commit between validation and ref mutation.
      await turnGit(cwd, ["update-ref", workspace.branchRef, target.head, head]);
      // Remove captured leaves first, then only empty structural directories. This supports
      // file/directory renames without recursively deleting ignored or unknown content.
      for (const path of paths
        .filter((path) => !targets.has(path))
        .sort((a, b) => b.length - a.length)) {
        const entry = await sourceEntry(cwd, path);
        if (!entry) continue;
        if (entry.fingerprint !== sources.get(path)?.fingerprint)
          throw new Error(`Content changed during restore: ${path}`);
        await rm(join(cwd, path));
      }
      for (const directory of [...replacementDirectories].sort((a, b) => b.length - a.length)) {
        await safeParents(cwd, directory);
        const info = await lstat(join(cwd, directory)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (info?.isDirectory() && !info.isSymbolicLink()) await rmdir(join(cwd, directory));
      }
      for (const path of targets.keys()) {
        await safeParents(cwd, path);
        const currentEntry = await sourceEntry(cwd, path);
        const wanted = targets.get(path);
        if (currentEntry?.fingerprint === wanted?.fingerprint) continue;
        if (currentEntry?.fingerprint !== sources.get(path)?.fingerprint)
          throw new Error(`Content changed during restore: ${path}`);
        if (!wanted) {
          // This exact path was captured in the rescue manifest, and its content was rechecked.
          await rm(join(cwd, path));
        } else {
          await mkdir(dirname(join(cwd, path)), { recursive: true });
          const staging = join(
            cwd,
            temporaryPaths.find((entry) => entry.targetPath === path)!.path,
          );
          if (wanted.kind === "symlink") await symlink(wanted.bytes.toString(), staging);
          else {
            const file = await open(staging, "wx", wanted.mode === "100755" ? 0o755 : 0o644);
            try {
              await file.writeFile(wanted.bytes);
              await file.sync();
            } finally {
              await file.close();
            }
            if (process.platform !== "win32")
              await chmod(staging, wanted.mode === "100755" ? 0o755 : 0o644);
          }
          await rename(staging, join(cwd, path));
        }
      }
      if (targetIndex.length) {
        await lock.writeFile(targetIndex);
        await lock.sync();
        await lock.close();
        await rename(lockPath, indexPath);
      } else {
        await rm(indexPath, { force: true });
      }
    } finally {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true });
    }
    if ((await this.fingerprint(workspace)) !== this.snapshotFingerprint(workspace, target))
      throw new Error("Restored source does not match target snapshot");
  }
  snapshotFingerprint(workspace: ManagedWorkspace, snapshot: TurnGitSnapshot) {
    return digest(
      JSON.stringify([
        workspace.branchRef,
        snapshot.head,
        snapshot.indexMetadataId,
        snapshot.paths,
      ]),
    );
  }
}
