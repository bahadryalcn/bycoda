import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { execFileAsync } from "../src/shared/lib/processExecution.node";
import { safeGitPath } from "./workspace";

type Image = { raw: string; mode: number } | null;
export type FileRevision = { before: Image; after: Image; conflict?: string };
type Turn = {
  id: string;
  userBlockId: string;
  files: { [path: string]: FileRevision };
  unavailable?: string;
};
type History = { version: 1; cwd: string; turns: Turn[] };
type Active = {
  cwd: string;
  turn: Turn;
  baseline: Map<string, Image>;
  complete: boolean;
  claimed: Map<string, Image>;
  prepared: Map<string, Image>;
  excluded: Map<string, string>;
  conflicts: Set<string>;
};
export type FilesRevertPlan = {
  files: { path: string; action: "restore" | "delete"; conflict?: string }[];
  unavailable?: string;
};
const MAX_FILE = 8 * 1024 * 1024;
const MAX_HISTORY = 64 * 1024 * 1024;
const validId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid file history ID");
  return value;
};
const same = (a: Image, b: Image) =>
  a?.raw === b?.raw && (process.platform === "win32" || a?.mode === b?.mode);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fingerprint = async (cwd: string, path: string) => {
  try {
    const meta = await lstat(await safeGitPath(cwd, path));
    return JSON.stringify([meta.size, meta.mtimeMs, meta.ctimeMs, meta.ino, meta.mode]);
  } catch (error) {
    return message(error);
  }
};

// Node's Windows file handles always share writes. A short-lived hidden helper
// supplies mandatory deny-write and deny-directory-rename handles for revert only.
// Requests travel as JSON on stdin, never interpolated into executable text.
const WINDOWS_GUARD = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RevertGuard {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
}
'@
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$held = [Collections.Generic.List[IDisposable]]::new()
try {
  foreach ($directory in $request.directories) {
    $handle = [RevertGuard]::CreateFile($directory, 0x81, 3, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
    if ($handle.IsInvalid) { throw 'A parent directory is busy or unavailable' }
    $held.Add($handle)
    if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A parent is a linked directory' }
  }
  if ([IO.File]::Exists($request.path)) {
    $held.Add([IO.File]::Open($request.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::Read -bor [IO.FileShare]::Delete)))
  }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  [void][Console]::In.ReadLine()
} finally {
  foreach ($handle in $held) { $handle.Dispose() }
}
`;
export async function acquireRevertFileGuard(cwd: string, abs: string) {
  if (process.platform !== "win32") return { check() {}, async release() {} };
  const directories: string[] = [];
  let parent = dirname(abs);
  for (;;) {
    directories.unshift(parent);
    if (parent === cwd) break;
    const next = dirname(parent);
    if (next === parent) throw new Error("Path is outside the checkout");
    parent = next;
  }
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_GUARD],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let closed = false;
  let detail = "";
  const completion = new Promise<void>((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  child.stderr.on("data", (bytes) => {
    if (detail.length < 4000) detail += String(bytes);
  });
  child.stdin.on("error", () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("File guard timed out"));
      }, 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      let output = "";
      child.stdout.on("data", (bytes) => {
        output += String(bytes);
        if (output.includes("READY")) finish();
      });
      child.once("error", (error) => finish(error));
      child.once("close", () =>
        finish(
          new Error(
            "File is open for writing or its directory is busy" +
              (detail ? `: ${detail.trim()}` : ""),
          ),
        ),
      );
      child.stdin.write(JSON.stringify({ directories, path: abs }) + "\n");
    });
  } catch (error) {
    child.stdin.end();
    await completion;
    throw error;
  }
  return {
    check() {
      if (closed) throw new Error("File guard exited during revert");
    },
    async release() {
      child.stdin.end("\n");
      await completion;
    },
  };
}

/** Reject every symlink component (including links within the checkout), nested
 * repositories, and hard links. Restoring an alias must never modify another path. */
async function filePath(cwd: string, path: string) {
  const abs = await safeGitPath(cwd, path);
  const parts = relative(cwd, abs).split(/[\\/]/);
  if (
    parts.some((part) => part.replace(/[. ]+$/, "").toLowerCase() === ".git" || part.includes(":"))
  )
    throw new Error("Git metadata and alternate data streams cannot be reverted");
  let cursor = cwd;
  for (let i = 0; i < parts.length; i++) {
    cursor = join(cursor, parts[i]);
    const meta = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (meta?.isSymbolicLink()) throw new Error("Linked paths cannot be reverted");
    if (meta && i < parts.length - 1 && !meta.isDirectory())
      throw new Error("Parent is not a directory");
    if (
      meta?.isDirectory() &&
      (await lstat(join(cursor, ".git")).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
    )
      throw new Error("Nested repositories cannot be reverted");
    if (meta?.isFile() && meta.nlink > 1) throw new Error("Hard-linked files cannot be reverted");
  }
  return abs;
}
async function image(cwd: string, path: string): Promise<Image> {
  const abs = await filePath(cwd, path);
  try {
    const meta = await lstat(abs);
    if (!meta.isFile() || meta.size > MAX_FILE)
      throw new Error("File is unsupported or exceeds 8 MiB");
    return { raw: (await readFile(abs)).toString("base64"), mode: meta.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** No Git index/tree/ref writes. Only changed files survive a completed turn.
 * The bounded live baseline is discarded on completion; crashes are unavailable. */
export class SessionFileRevert {
  private active = new Map<string, Active>();
  constructor(
    private root: string,
    private budget = MAX_HISTORY,
  ) {}
  private path(session: string) {
    return join(this.root, validId(session), "file-history.json");
  }
  private async load(session: string, cwd: string): Promise<History> {
    try {
      const history = JSON.parse(await readFile(this.path(session), "utf8")) as History;
      if (history.version !== 1 || history.cwd !== cwd || !Array.isArray(history.turns))
        throw new Error("File history belongs to another checkout or format");
      for (const turn of history.turns) turn.files = Object.assign(Object.create(null), turn.files);
      return history;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, cwd, turns: [] };
      throw error;
    }
  }
  private async save(session: string, history: History) {
    while (Buffer.byteLength(JSON.stringify(history)) > this.budget && history.turns.length)
      history.turns.shift();
    // Empty turns are bounded too; missing IDs intentionally report unavailable.
    if (history.turns.length > 2048) history.turns.splice(0, history.turns.length - 2048);
    const path = this.path(session);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(history));
    await rename(tmp, path);
  }
  private async paths(cwd: string): Promise<string[]> {
    try {
      const result = await execFileAsync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
        {
          cwd,
          windowsHide: true,
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: 15_000,
        },
      );
      return [...new Set(result.stdout.split("\0").filter(Boolean))];
    } catch (error) {
      if (!String((error as { stderr?: string }).stderr).includes("not a git repository"))
        throw error;
      const paths: string[] = [];
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if ([".git", "node_modules", "temp", "target"].includes(entry.name)) continue;
          const path = join(dir, entry.name);
          if (entry.isFile()) paths.push(relative(cwd, path).replace(/\\/g, "/"));
          else if (entry.isDirectory()) {
            if (
              await lstat(join(path, ".git")).then(
                () => true,
                () => false,
              )
            )
              continue;
            await walk(path);
          }
          if (paths.length > 20_000) throw new Error("Too many files for turn history");
        }
      };
      await walk(cwd);
      return paths;
    }
  }
  async begin(session: string, cwd: string, turnId: string, userBlockId = turnId) {
    validId(turnId);
    validId(userBlockId);
    cwd = await realpath(cwd);
    if (this.active.get(session)?.turn.id === turnId) return;
    if (this.active.has(session))
      await this.finish(session, cwd, this.active.get(session)!.turn.id, true);
    const history = await this.load(session, cwd);
    if (history.turns.some((previous) => previous.id === turnId))
      throw new Error("File history turn was already recorded; a new turn ID is required");
    const turn: Turn = {
      id: turnId,
      userBlockId,
      files: Object.create(null),
      unavailable: "Turn file capture was interrupted",
    };
    history.turns.push(turn);
    await this.save(session, history);
    const active: Active = {
      cwd,
      turn,
      baseline: new Map(),
      complete: true,
      claimed: new Map(),
      prepared: new Map(),
      excluded: new Map(),
      conflicts: new Set(),
    };
    this.active.set(session, active);
    let size = 0;
    try {
      for (const path of await this.paths(cwd)) {
        try {
          const value = await image(cwd, path);
          size += value?.raw.length ?? 0;
          if (size > this.budget) {
            active.excluded.set(path, await fingerprint(cwd, path));
            continue;
          }
          active.baseline.set(path, value);
        } catch {
          active.excluded.set(path, await fingerprint(cwd, path));
        }
      }
    } catch {
      active.complete = false;
    }
  }
  /** Must run immediately before the session's structured write, paired with
   * claim after it. Post-edit provider events alone cannot prove a shared baseline. */
  async prepare(session: string, cwd: string, turnId: string, paths: string[]) {
    const active = this.active.get(session);
    if (!active || active.turn.id !== turnId || active.cwd !== (await realpath(cwd))) return;
    for (const path of paths) {
      const normalized = relative(active.cwd, await filePath(active.cwd, path)).replace(/\\/g, "/");
      const before = await image(active.cwd, normalized);
      if (active.claimed.has(normalized) && !same(active.claimed.get(normalized)!, before))
        active.conflicts.add(normalized);
      if (!active.prepared.has(normalized)) active.prepared.set(normalized, before);
    }
  }
  async claim(session: string, cwd: string, turnId: string, paths: string[]) {
    const active = this.active.get(session);
    if (!active || active.turn.id !== turnId || active.cwd !== (await realpath(cwd))) return;
    for (const path of paths) {
      const normalized = relative(active.cwd, await filePath(active.cwd, path)).replace(/\\/g, "/");
      active.claimed.set(normalized, await image(active.cwd, normalized));
    }
  }
  async finish(session: string, cwd: string, turnId: string, shared = false) {
    const active = this.active.get(session);
    if (!active || active.turn.id !== turnId || active.cwd !== (await realpath(cwd))) return;
    try {
      const history = await this.load(session, active.cwd);
      const turn = history.turns.find((t) => t.id === turnId);
      if (!turn) return;
      const discovered = shared ? new Set<string>() : new Set(await this.paths(active.cwd));
      const candidates = shared
        ? [...active.claimed.keys()]
        : [
            ...new Set([
              ...active.baseline.keys(),
              ...active.excluded.keys(),
              ...active.claimed.keys(),
              ...discovered,
            ]),
          ];
      for (const path of candidates) {
        if (active.excluded.has(path)) {
          if (
            active.claimed.has(path) ||
            active.excluded.get(path) !== (await fingerprint(active.cwd, path))
          )
            active.complete = false;
          continue;
        }
        if (!active.baseline.has(path) && !active.complete) continue;
        const before =
          (shared || !active.baseline.has(path)) && active.prepared.has(path)
            ? active.prepared.get(path)!
            : (active.baseline.get(path) ?? null);
        try {
          const after = active.claimed.has(path)
            ? active.claimed.get(path)!
            : await image(active.cwd, path);
          if (!same(before, after))
            turn.files[path] = {
              before,
              after,
              conflict:
                (shared || (!active.baseline.has(path) && !discovered.has(path))) &&
                !active.prepared.has(path)
                  ? "Pre-edit contents could not be verified during overlapping turns"
                  : active.conflicts.has(path)
                    ? "File changed outside this session between edits"
                    : undefined,
            };
        } catch {
          active.complete = false;
        }
      }
      if (active.complete) delete turn.unavailable;
      else turn.unavailable = "The turn exceeded file capture limits or contains unsupported files";
      await this.save(session, history);
      return turn.unavailable ? undefined : { files: turn.files, shared };
    } finally {
      this.active.delete(session);
    }
  }
  private selection(history: History, userBlockId: string) {
    const index = history.turns.findIndex((turn) => turn.userBlockId === userBlockId);
    if (index < 0)
      return {
        files: new Map<string, FileRevision>(),
        unavailable: "File history for this message is unavailable or has been pruned",
      };
    const turns = history.turns.slice(index);
    const unavailable = turns.find((turn) => turn.unavailable)?.unavailable;
    const files = new Map<string, FileRevision>();
    for (const turn of turns)
      for (const [path, revision] of Object.entries(turn.files)) {
        const previous = files.get(path);
        files.set(
          path,
          previous
            ? {
                before: previous.before,
                after: revision.after,
                conflict:
                  previous.conflict ??
                  (!same(previous.after, revision.before)
                    ? "File changed outside this session between turns"
                    : revision.conflict),
              }
            : { ...revision },
        );
      }
    return { files, unavailable };
  }
  private async conflict(cwd: string, path: string, revision: FileRevision) {
    if (revision.conflict) return revision.conflict;
    try {
      if (!same(await image(cwd, path), revision.after)) return "File changed outside this session";
    } catch (error) {
      return message(error);
    }
  }
  async plan(session: string, cwd: string, userBlockId: string): Promise<FilesRevertPlan> {
    validId(userBlockId);
    cwd = await realpath(cwd);
    if (this.active.has(session)) return { files: [], unavailable: "Session is still running" };
    let history: History;
    try {
      history = await this.load(session, cwd);
    } catch (error) {
      return { files: [], unavailable: message(error) };
    }
    const selection = this.selection(history, userBlockId);
    if (selection.unavailable) return { files: [], unavailable: selection.unavailable };
    const files: FilesRevertPlan["files"] = [];
    for (const [path, revision] of selection.files)
      files.push({
        path,
        action: revision.before ? "restore" : "delete",
        conflict: await this.conflict(cwd, path, revision),
      });
    return { files };
  }
  /** Call only after conversation rewind has persisted, for BOTH file choices.
   * Truncation changes bookkeeping; it never modifies checkout files. */
  async forgetFromMessage(session: string, cwd: string, userBlockId: string) {
    validId(userBlockId);
    cwd = await realpath(cwd);
    if (this.active.has(session)) throw new Error("Session is still running");
    const history = await this.load(session, cwd);
    const index = history.turns.findIndex((turn) => turn.userBlockId === userBlockId);
    if (index < 0) return;
    history.turns.splice(index);
    await this.save(session, history);
  }
  async revert(
    session: string,
    cwd: string,
    userBlockId: string,
    _planToken?: string,
    onReverted?: (path: string, restored: Image) => void,
  ) {
    validId(userBlockId);
    cwd = await realpath(cwd);
    if (this.active.has(session)) throw new Error("Session is still running");
    const history = await this.load(session, cwd);
    const selection = this.selection(history, userBlockId);
    if (selection.unavailable) throw new Error(selection.unavailable);
    const result = { reverted: [] as string[], skipped: [] as { path: string; reason: string }[] };
    for (const [path, revision] of selection.files) {
      let rescue: string | undefined;
      let staged: string | undefined;
      let guard: Awaited<ReturnType<typeof acquireRevertFileGuard>> | undefined;
      try {
        const conflict = await this.conflict(cwd, path, revision);
        if (conflict) throw new Error(conflict);
        let abs = await filePath(cwd, path);
        await mkdir(dirname(abs), { recursive: true });
        guard = await acquireRevertFileGuard(cwd, abs);
        guard.check();
        if (revision.before) {
          staged = join(dirname(abs), `.bycoda-restore-${randomUUID()}`);
          await writeFile(staged, Buffer.from(revision.before.raw, "base64"), { flag: "wx" });
          if (process.platform !== "win32") await chmod(staged, revision.before.mode);
        }
        // Revalidate after asynchronous preparation. Atomically take possession of
        // the current directory entry, then validate the captured contents again.
        abs = await filePath(cwd, path);
        const again = await this.conflict(cwd, path, revision);
        if (again) throw new Error(again);
        guard.check();
        if (revision.after) {
          rescue = join(dirname(abs), `.bycoda-rescue-${randomUUID()}`);
          await rename(abs, rescue);
          const held = await image(cwd, relative(cwd, rescue));
          if (!same(held, revision.after)) throw new Error("File changed during revert");
        }
        // link is exclusive: never replace a new file written during this window.
        guard.check();
        await filePath(cwd, path);
        if (staged) await link(staged, abs);
        else if (
          await lstat(abs).then(
            () => true,
            (e: NodeJS.ErrnoException) => {
              if (e.code === "ENOENT") return false;
              throw e;
            },
          )
        )
          throw new Error("File changed during revert");
        if (rescue) {
          await rm(rescue);
          rescue = undefined;
        }
        result.reverted.push(path);
        onReverted?.(path, revision.before);
      } catch (error) {
        let reason = message(error);
        if (rescue) {
          try {
            await link(rescue, await filePath(cwd, path));
            await rm(rescue);
          } catch {
            reason += `; original preserved at ${rescue}`;
          }
        }
        result.skipped.push({ path, reason });
      } finally {
        try {
          if (staged) await rm(staged, { force: true });
        } finally {
          await guard?.release();
        }
      }
    }
    // Remove only successfully reverted paths from the selected turns. Retain
    // skipped history so a later retry can explain the same conflict honestly.
    const index = history.turns.findIndex((turn) => turn.userBlockId === userBlockId);
    for (const turn of history.turns.slice(index))
      for (const path of result.reverted) delete turn.files[path];
    await this.save(session, history);
    return result;
  }
}
