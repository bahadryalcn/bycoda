import { createHash, randomUUID } from "node:crypto";
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
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { safeGitPath } from "../workspaces/workspace";
import { writeFileAtomic } from "../storage/atomic-write";
import type { HarnessFileChange } from "../../src/integrations/harness/core/types";

type Image = { raw: string; mode: number } | null;
export type FileRevision = { before: Image; after: Image; conflict?: string };
type Turn = {
  id: string;
  userBlockId: string;
  files: { [path: string]: FileRevision };
  unavailable?: string;
};
type History = { version: 1; cwd: string; turns: Turn[] };
type HistoryIndexEntry = { id: string; userBlockId: string; hash: string; bytes: number; settled: boolean };
type HistoryIndex = { version: 3; cwd: string; turns: HistoryIndexEntry[]; checksum: string };
type Active = {
  cwd: string;
  turn: Turn;
  baseline: Map<string, Image>;
  complete: boolean;
  claimed: Map<string, Image>;
  prepared: Map<string, Image>;
  excluded: Map<string, string>;
  conflicts: Set<string>;
  proofs: Map<string, FileRevision>;
  proofCalls: Set<string>;
  proofBytes: number;
};
export type FilesRevertPlan = {
  authorityGeneration?: number;
  planToken?: string;
  files: { path: string; action: "restore" | "delete"; conflict?: string }[];
  unavailable?: string;
};
export type FileRevertAuthority = (
  sessionId: string,
  authorityGeneration?: number,
) => Promise<void>;
export class FileRevertAuthorityError extends Error {
  readonly code = "FILE_REVERT_AUTHORITY";
  partialResult?: { reverted: string[]; skipped: Array<{ path: string; reason: string }> };
}
export function fileRevertGeneration(value: unknown): number | undefined {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new FileRevertAuthorityError("Invalid file revert authority generation");
  return value;
}
export async function assertFileRevertAuthority(
  port: FileRevertAuthority | undefined,
  session: string,
  generation?: number,
): Promise<void> {
  generation = fileRevertGeneration(generation);
  if (typeof port !== "function")
    throw new FileRevertAuthorityError("File revert requires a durable authority guard");
  try {
    await port(session, generation);
  } catch (error) {
    throw new FileRevertAuthorityError(error instanceof Error ? error.message : String(error));
  }
}
const revertToken = (
  session: string,
  cwd: string,
  userBlockId: string,
  generation: number,
  files: Map<string, FileRevision>,
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        "session-files-revert/v2",
        session,
        cwd,
        userBlockId,
        generation,
        [...files],
      ]),
    )
    .digest("hex");
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

/** Reverse only validated provider hunks; unchanged regions come from current bytes. */
export function reverseProviderUpdate(current: string, diff: string): string {
  const lines = current.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const patch = diff.split("\n");
  if (patch.at(-1) === "") patch.pop();
  const before: string[] = [];
  let cursor = 0;
  let hunks = 0;
  for (let i = 0; i < patch.length;) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(patch[i]);
    if (!header) {
      if (hunks || !/^(?:diff |index |--- |\+\+\+ |$)/.test(patch[i]))
        throw new Error("Unsupported provider update patch");
      i++;
      continue;
    }
    hunks++;
    const oldStart = Number(header[1]);
    const oldCount = Number(header[2] ?? 1);
    const newStart = Number(header[3]);
    const newCount = Number(header[4] ?? 1);
    const oldIndex = oldCount ? oldStart - 1 : oldStart;
    const newIndex = newCount ? newStart - 1 : newStart;
    if (
      ![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) ||
      oldIndex < 0 ||
      newIndex < cursor ||
      newIndex > lines.length
    )
      throw new Error("Invalid provider update range");
    for (let index = cursor; index < newIndex; index++) before.push(lines[index]);
    if (before.length !== oldIndex) throw new Error("Inconsistent provider update positions");
    cursor = newIndex;
    const body: Array<{ kind: string; text: string }> = [];
    i++;
    while (i < patch.length && !patch[i].startsWith("@@ ")) {
      const line = patch[i++];
      if (line === "\\ No newline at end of file") {
        const previous = body.at(-1);
        if (!previous || !previous.text.endsWith("\n"))
          throw new Error("Invalid no-newline marker");
        previous.text = previous.text.slice(0, -1);
      } else if (/^[ +-]/.test(line)) body.push({ kind: line[0], text: `${line.slice(1)}\n` });
      else throw new Error("Unsupported provider update hunk");
    }
    if (
      body.filter((line) => line.kind !== "+").length !== oldCount ||
      body.filter((line) => line.kind !== "-").length !== newCount
    )
      throw new Error("Provider update hunk counts do not match");
    for (const line of body) {
      if (line.kind !== "-") {
        if (lines[cursor] !== line.text)
          throw new Error("Current file differs from provider update");
        cursor++;
      }
      if (line.kind !== "+") before.push(line.text);
    }
  }
  if (!hunks) throw new Error("Provider update has no verifiable hunks");
  for (; cursor < lines.length; cursor++) before.push(lines[cursor]);
  if (before.some((line, index) => index < before.length - 1 && !line.endsWith("\n")))
    throw new Error("Provider update has a non-final no-newline marker");
  return before.join("");
}

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
    private readonly authority?: FileRevertAuthority,
  ) {}
  private path(session: string) {
    return join(this.root, validId(session), "file-history.json");
  }
  private indexPath(session: string) {
    return join(this.root, validId(session), "file-history.v2.json");
  }
  private blobPath(session: string, hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid file history block");
    return join(this.root, validId(session), "file-history-v2", `${hash}.json`);
  }
  private indexChecksum(cwd: string, turns: HistoryIndexEntry[]) {
    return createHash("sha256").update(JSON.stringify({ version: 3, cwd, turns })).digest("hex");
  }
  private async readTurn(session: string, entry: HistoryIndexEntry): Promise<Turn> {
    const text = await readFile(this.blobPath(session, entry.hash), "utf8");
    if (Buffer.byteLength(text) !== entry.bytes || createHash("sha256").update(text).digest("hex") !== entry.hash)
      throw new Error("File history block failed integrity check");
    const turn = JSON.parse(text) as Turn;
    if (!turn || turn.id !== entry.id || turn.userBlockId !== entry.userBlockId ||
        (entry.settled !== undefined && entry.settled !== !turn.unavailable) || !turn.files || typeof turn.files !== "object")
      throw new Error("File history block does not match its index");
    turn.files = Object.assign(Object.create(null), turn.files);
    return turn;
  }
  private async readIndex(session: string, cwd: string, startFresh = false): Promise<HistoryIndex> {
    let raw: string;
    try { raw = await readFile(this.indexPath(session), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const legacy = await this.load(session, cwd, startFresh);
      await this.save(session, legacy);
      raw = await readFile(this.indexPath(session), "utf8");
    }
    const value = JSON.parse(raw) as HistoryIndex | { version: 2; cwd: string; turns: string[] };
    if (value.version === 2) {
      // Existing v2 data is upgraded once, after each block passes its hash.
      const legacy = await this.load(session, cwd, startFresh);
      await this.save(session, legacy);
      return this.readIndex(session, cwd);
    }
    if (value.version === 3 && Array.isArray(value.turns) && value.turns.some((entry) => entry && entry.settled === undefined)) {
      const legacy = await this.load(session, cwd, startFresh);
      await this.save(session, legacy);
      return this.readIndex(session, cwd);
    }
    if (value.version !== 3 || value.cwd !== cwd || !Array.isArray(value.turns) ||
        value.turns.length > 2048 || value.turns.some((entry) => !entry ||
          typeof entry.id !== "string" || typeof entry.userBlockId !== "string" ||
          typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash) ||
          !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.settled !== "boolean") ||
        value.checksum !== this.indexChecksum(value.cwd, value.turns))
      throw new Error("File history index is invalid or belongs to another checkout");
    return value;
  }
  private async writeIndex(session: string, cwd: string, turns: HistoryIndexEntry[], previous: HistoryIndexEntry[]) {
    let bytes = Buffer.byteLength(JSON.stringify({ version: 1, cwd, turns: [] })) +
      turns.reduce((sum, entry) => sum + entry.bytes, 0) + Math.max(0, turns.length - 1);
    while ((bytes > this.budget || turns.length > 2048) && turns.length) {
      if (!turns[0].settled) throw new Error("File history capacity is held by unresolved captures");
      bytes -= turns[0].bytes + (turns.length > 1 ? 1 : 0);
      turns.shift();
    }
    await writeFileAtomic(this.indexPath(session), JSON.stringify({ version: 3, cwd, turns, checksum: this.indexChecksum(cwd, turns) }));
    const retained = new Set(turns.map((entry) => entry.hash));
    for (const hash of new Set(previous.map((entry) => entry.hash)))
      if (!retained.has(hash)) await rm(this.blobPath(session, hash), { force: true }).catch(() => undefined);
  }
  private async storeTurn(session: string, turn: Turn): Promise<HistoryIndexEntry> {
    const text = JSON.stringify(turn);
    const hash = createHash("sha256").update(text).digest("hex");
    const path = this.blobPath(session, hash);
    try {
      const stored = await readFile(path, "utf8");
      if (stored !== text) throw new Error("File history block failed integrity check");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFileAtomic(path, text);
    }
    return { id: turn.id, userBlockId: turn.userBlockId, hash, bytes: Buffer.byteLength(text), settled: !turn.unavailable };
  }
  /** Called only after writer retirement while the checkpoint session queue is held. */
  async retireDeletedSession(session: string, cwd: string): Promise<{ retainedUnknown: boolean }> {
    if (this.active.has(session)) throw new Error("File history capture is still active");
    const marker = join(this.root, validId(session), "file-history-retirement.json");
    const pendingRetirement = await lstat(marker).then(() => true, (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
    if (pendingRetirement) throw new Error("Previous file history retirement is unresolved; evidence retained");
    let raw: string;
    try { raw = await readFile(this.indexPath(session), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { retainedUnknown: true };
      throw error;
    }
    if ((JSON.parse(raw) as { version?: number }).version === 2) {
      await this.readIndex(session, cwd);
      raw = await readFile(this.indexPath(session), "utf8");
    }
    const index = JSON.parse(raw) as HistoryIndex;
    if (index.version !== 3 || index.cwd !== cwd || !Array.isArray(index.turns) ||
        index.checksum !== this.indexChecksum(index.cwd, index.turns))
      throw new Error("File history retirement requires a valid current index");
    // Verify all named evidence before retiring the index. An orphan is not
    // presumed dead merely because it is absent from the published index.
    for (const entry of index.turns) {
      const turn = await this.readTurn(session, entry);
      if (turn.unavailable) throw new Error("File capture outcome is unresolved; file history retained");
    }
    await writeFileAtomic(marker, raw);
    await writeFileAtomic(this.indexPath(session), JSON.stringify({
      version: 3, cwd, turns: [], checksum: this.indexChecksum(cwd, []),
    }));
    for (const hash of new Set(index.turns.map((entry) => entry.hash)))
      await rm(this.blobPath(session, hash), { force: true });
    await rm(marker, { force: true });
    // Legacy backups and unreferenced blocks have no proven retirement owner.
    return { retainedUnknown: true };
  }
  /** `startFresh`: a turn is beginning, so history that cannot be read for this
   * checkout (the session moved to another folder, or the file is damaged) is
   * replaced instead of failing every later turn of the session. Reverting
   * still refuses it. */
  private async load(session: string, cwd: string, startFresh = false): Promise<History> {
    try {
      let history: History | undefined;
      try {
        const index = JSON.parse(await readFile(this.indexPath(session), "utf8")) as
          HistoryIndex | { version: 2; cwd: string; turns: string[] };
        if ((index.version !== 2 && index.version !== 3) || typeof index.cwd !== "string" || !Array.isArray(index.turns))
          throw new Error("Invalid file history index");
        const turns: Turn[] = [];
        if (index.version === 3) {
          if (index.checksum !== this.indexChecksum(index.cwd, index.turns)) throw new Error("Invalid file history index checksum");
          for (const entry of index.turns) turns.push(await this.readTurn(session, entry));
        } else {
          for (const hash of index.turns) {
            const text = await readFile(this.blobPath(session, hash), "utf8");
            if (createHash("sha256").update(text).digest("hex") !== hash)
              throw new Error("File history block failed integrity check");
            turns.push(JSON.parse(text) as Turn);
          }
        }
        history = { version: 1, cwd: index.cwd, turns };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // Only a missing index permits legacy fallback. Missing indexed blocks
        // are corruption and must not resurrect an older legacy snapshot.
        try { await lstat(this.indexPath(session)); } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === "ENOENT") {
            history = JSON.parse(await readFile(this.path(session), "utf8")) as History;
          } else throw missing;
        }
        if (!history) throw new Error("Indexed file history block is missing", { cause: error });
      }
      if (!history) throw new Error("File history is unavailable");
      if (history.version !== 1 || history.cwd !== cwd || !Array.isArray(history.turns))
        throw new Error("File history belongs to another checkout or format");
      for (const turn of history.turns) turn.files = Object.assign(Object.create(null), turn.files);
      return history;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, cwd, turns: [] };
      if (startFresh) {
        const indexed = await lstat(this.indexPath(session)).then(() => true, (failure) => {
          if ((failure as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw failure;
        });
        if (indexed) throw error;
        console.warn("File history was reset for a new turn:", error);
        return { version: 1, cwd, turns: [] };
      }
      throw error;
    }
  }
  private async save(session: string, history: History) {
    let previous: HistoryIndexEntry[] = [];
    try {
      const stored = JSON.parse(await readFile(this.indexPath(session), "utf8")) as HistoryIndex | { version: 2; turns: string[] };
      if (!Array.isArray(stored.turns)) throw new Error("Invalid file history index");
      if (stored.version === 2) previous = stored.turns.map((hash) => ({ hash, id: "", userBlockId: "", bytes: 0, settled: false }));
      else if (stored.version === 3 && stored.checksum === this.indexChecksum(stored.cwd, stored.turns)) previous = stored.turns;
      else throw new Error("Invalid file history index");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const entries: HistoryIndexEntry[] = [];
    for (const turn of history.turns) entries.push(await this.storeTurn(session, turn));
    await this.writeIndex(session, history.cwd, entries, previous);
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
    const index = await this.readIndex(session, cwd, true);
    if (index.turns.some((previous) => previous.id === turnId))
      throw new Error("File history turn was already recorded; a new turn ID is required");
    const turn: Turn = {
      id: turnId,
      userBlockId,
      files: Object.create(null),
      unavailable: "Turn file capture was interrupted",
    };
    const entry = await this.storeTurn(session, turn);
    await this.writeIndex(session, cwd, [...index.turns, entry], index.turns);
    const active: Active = {
      cwd,
      turn,
      baseline: new Map(),
      complete: true,
      claimed: new Map(),
      prepared: new Map(),
      excluded: new Map(),
      conflicts: new Set(),
      proofs: new Map(),
      proofCalls: new Set(),
      proofBytes: 0,
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
  /** Codex file notifications arrive after writes. Their proof replaces the late
   * prepare/claim heuristic; it never authorizes a previous journal entry. */
  async claimProof(
    session: string,
    cwd: string,
    turnId: string,
    callId: string,
    changes: HarnessFileChange[],
  ) {
    const active = this.active.get(session);
    if (!active || active.turn.id !== turnId || active.cwd !== (await realpath(cwd))) return;
    if (active.proofCalls.has(callId)) return;
    if (
      typeof callId !== "string" ||
      !callId ||
      callId.length > 512 ||
      active.proofCalls.size >= 4096 ||
      !Array.isArray(changes) ||
      !changes.length ||
      changes.length > 4096
    ) {
      active.complete = false;
      return;
    }
    active.proofCalls.add(callId);
    for (const change of changes) {
      try {
        const path = relative(active.cwd, await filePath(active.cwd, change.path)).replace(
          /\\/g,
          "/",
        );
        if (
          typeof change.contents !== "string" ||
          Buffer.byteLength(change.contents) > MAX_FILE ||
          Buffer.from(change.contents).toString("utf8") !== change.contents
        )
          throw new Error("Provider proof exceeds file capture limits");
        const actual = await image(active.cwd, path);
        const textImage = (
          text: string,
          mode = actual?.mode ?? active.baseline.get(path)?.mode ?? 0o644,
        ): Image => {
          if (Buffer.byteLength(text) > MAX_FILE)
            throw new Error("Provider proof exceeds file capture limits");
          return { raw: Buffer.from(text, "utf8").toString("base64"), mode };
        };
        const previous = active.proofs.get(path);
        let unavailableBefore: string | undefined;
        let before: Image;
        let after: Image;
        if (change.kind === "add") {
          before = null;
          after = textImage(change.contents);
          if (
            !previous &&
            (active.baseline.get(path) || active.excluded.has(path) || !active.complete)
          )
            unavailableBefore =
              "Pre-edit contents for overwritten provider AddFile are unavailable";
          else if (!previous) {
            // Git's baseline enumeration omits ignored files. AddFile may have
            // overwritten one, so absence there cannot authorize deletion.
            let knownNonIgnored = false;
            try {
              await execFileAsync("git", ["check-ignore", "-q", "--no-index", "--", path], {
                cwd: active.cwd,
                windowsHide: true,
                encoding: "utf8",
                maxBuffer: 4096,
                timeout: 15_000,
              });
            } catch (error) {
              knownNonIgnored = (error as { code?: number }).code === 1;
            }
            if (!knownNonIgnored)
              unavailableBefore =
                "Pre-edit contents for ignored or unverified provider AddFile are unavailable";
          }
        } else if (change.kind === "delete") {
          before = textImage(change.contents, active.baseline.get(path)?.mode ?? 0o644);
          after = null;
        } else if (change.kind === "update") {
          if (!actual) throw new Error("Updated file is missing");
          const current = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            Buffer.from(actual.raw, "base64"),
          );
          before = textImage(reverseProviderUpdate(current, change.contents));
          after = actual;
        } else throw new Error("Unsupported provider file proof");
        const revision = {
          before: previous ? previous.before : before,
          after,
          conflict:
            previous?.conflict ??
            unavailableBefore ??
            (previous && !same(previous.after, before)
              ? "File changed outside this session between edits"
              : undefined),
        };
        const bytes = (value: FileRevision | undefined) =>
          (value?.before?.raw.length ?? 0) + (value?.after?.raw.length ?? 0);
        const nextSize = active.proofBytes - bytes(previous) + bytes(revision);
        if (nextSize > this.budget || (!previous && active.proofs.size >= 4096))
          throw new Error("Provider proof exceeded the turn history budget");
        active.proofBytes = nextSize;
        active.proofs.set(path, revision);
      } catch {
        // Unsupported or malformed evidence must never fall back to a stale baseline.
        active.complete = false;
      }
    }
  }
  async finish(session: string, cwd: string, turnId: string, shared = false) {
    const active = this.active.get(session);
    if (!active || active.turn.id !== turnId || active.cwd !== (await realpath(cwd))) return;
    try {
      const index = await this.readIndex(session, active.cwd);
      const position = index.turns.findIndex((entry) => entry.id === turnId);
      if (position < 0) return;
      const turn = await this.readTurn(session, index.turns[position]);
      const discovered = shared ? new Set<string>() : new Set(await this.paths(active.cwd));
      const candidates = shared
        ? [...new Set([...active.claimed.keys(), ...active.proofs.keys()])]
        : [
            ...new Set([
              ...active.baseline.keys(),
              ...active.excluded.keys(),
              ...active.claimed.keys(),
              ...active.proofs.keys(),
              ...discovered,
            ]),
          ];
      for (const path of candidates) {
        const proof = active.proofs.get(path);
        if (proof) {
          if (!same(proof.before, proof.after) || proof.conflict) turn.files[path] = proof;
          continue;
        }
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
      const entries = [...index.turns];
      entries[position] = await this.storeTurn(session, turn);
      await this.writeIndex(session, active.cwd, entries, index.turns);
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
  async plan(
    session: string,
    cwd: string,
    userBlockId: string,
    authorityGeneration?: number,
  ): Promise<FilesRevertPlan> {
    const generation = fileRevertGeneration(authorityGeneration);
    await assertFileRevertAuthority(this.authority, session, generation);
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
    await assertFileRevertAuthority(this.authority, session, generation);
    return {
      files,
      ...(generation === undefined
        ? {}
        : {
            authorityGeneration: generation,
            planToken: revertToken(session, cwd, userBlockId, generation, selection.files),
          }),
    };
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
    planToken?: string,
    onReverted?: (path: string, restored: Image) => void,
    authorityGeneration?: number,
  ) {
    const generation = fileRevertGeneration(authorityGeneration);
    await assertFileRevertAuthority(this.authority, session, generation);
    validId(userBlockId);
    cwd = await realpath(cwd);
    if (this.active.has(session)) throw new Error("Session is still running");
    const history = await this.load(session, cwd);
    const selection = this.selection(history, userBlockId);
    if (selection.unavailable) throw new Error(selection.unavailable);
    if (
      generation !== undefined &&
      (typeof planToken !== "string" ||
        planToken !== revertToken(session, cwd, userBlockId, generation, selection.files))
    )
      throw new Error("File revert preview changed; review it again before reverting files");
    const result = { reverted: [] as string[], skipped: [] as { path: string; reason: string }[] };
    let authorityFailure: FileRevertAuthorityError | undefined;
    for (const [path, revision] of selection.files) {
      let rescue: string | undefined;
      let staged: string | undefined;
      let guard: Awaited<ReturnType<typeof acquireRevertFileGuard>> | undefined;
      try {
        const conflict = await this.conflict(cwd, path, revision);
        if (conflict) throw new Error(conflict);
        let abs = await filePath(cwd, path);
        await assertFileRevertAuthority(this.authority, session, generation);
        await mkdir(dirname(abs), { recursive: true });
        guard = await acquireRevertFileGuard(cwd, abs);
        guard.check();
        if (revision.before) {
          await assertFileRevertAuthority(this.authority, session, generation);
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
          const rescuePath = join(dirname(abs), `.bycoda-rescue-${randomUUID()}`);
          await assertFileRevertAuthority(this.authority, session, generation);
          await rename(abs, rescuePath);
          rescue = rescuePath;
          const held = await image(cwd, relative(cwd, rescue));
          if (!same(held, revision.after)) throw new Error("File changed during revert");
        }
        // link is exclusive: never replace a new file written during this window.
        guard.check();
        await filePath(cwd, path);
        await assertFileRevertAuthority(this.authority, session, generation);
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
        if (error instanceof FileRevertAuthorityError) {
          authorityFailure = new FileRevertAuthorityError(reason);
          result.skipped.push({ path, reason });
          break;
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
    // Finish bookkeeping for already committed per-file effects even if a later
    // authority check fails. Cleanup/rollback must not bless any remaining file.
    if (!result.reverted.length && !authorityFailure)
      await assertFileRevertAuthority(this.authority, session, generation);
    if (result.reverted.length || !authorityFailure) await this.save(session, history);
    if (authorityFailure) {
      authorityFailure.partialResult = {
        reverted: [...result.reverted],
        skipped: [...result.skipped],
      };
      if (result.reverted.length)
        authorityFailure.message += `; already reverted ${result.reverted.length} file(s): ${JSON.stringify(result.reverted)}; review them before a new request`;
      throw authorityFailure;
    }
    return result;
  }
}
