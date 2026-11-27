import { statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve } from "node:path";
import { readStateFileSync, writeFileAtomic } from "../storage/atomic-write";
import { setAdditionalDirsResolver } from "../../src/integrations/harness/core/additionalDirs";

const MAX_DIRS = 16;
const MAX_PATH = 4096;
const folded = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

/**
 * Folders a Host session may also read and edit. Every entry must be an absolute path to an
 * existing directory on this Host that is neither a filesystem root nor the home folder
 * (same rules as a local project). Returns canonical paths without duplicates or the
 * session's own working directory; any other input fails so the client sees why.
 */
export async function validateAdditionalDirs(
  raw: unknown,
  workingDirectory: string,
  home = homedir(),
): Promise<string[]> {
  if (!Array.isArray(raw) || raw.length > MAX_DIRS) throw new Error("Invalid additional folders");
  const physical = async (path: string) => realpath(path).catch(() => resolve(path));
  const own = folded(await physical(workingDirectory));
  const homeKey = folded(await physical(home));
  const seen = new Set<string>([own]);
  const result: string[] = [];
  for (const entry of raw) {
    if (
      typeof entry !== "string" ||
      !entry.trim() ||
      entry.length > MAX_PATH ||
      entry.includes("\0") ||
      !isAbsolute(entry)
    )
      throw new Error("Additional folders must be absolute paths");
    const real = await realpath(entry).catch(() => {
      throw new Error(`Folder "${entry}" does not exist on this Host`);
    });
    if (!(await stat(real)).isDirectory()) throw new Error(`"${entry}" is not a folder`);
    const key = folded(real);
    if (real === parse(real).root || key === homeKey)
      throw new Error(`"${entry}" is a drive root or the home folder, not a project folder`);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(real);
  }
  return result;
}

let bySession = new Map<string, readonly string[]>();
let stateFile: string | undefined;
let writes: Promise<void> = Promise.resolve();

/** A folder deleted since it was saved (a removed worktree) must never reach `--add-dir`. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function parseStored(text: string): Map<string, readonly string[]> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid state");
  const map = new Map<string, readonly string[]>();
  for (const [id, dirs] of Object.entries(value)) {
    if (!Array.isArray(dirs) || !dirs.every((dir) => typeof dir === "string")) continue;
    const present = dirs.filter(isDirectory);
    if (present.length > 0) map.set(id, present);
  }
  return map;
}

function persist(): void {
  const file = stateFile;
  if (!file) return;
  const snapshot = JSON.stringify(Object.fromEntries(bySession));
  writes = writes
    .then(() => writeFileAtomic(file, snapshot))
    .catch((error: unknown) => {
      console.error("Session additional folders could not be saved:", error);
    });
}

/** Replaces the session's folders; the next provider launch sees them, and so does one after a Host restart. */
export function setSessionAdditionalDirs(sessionId: string, dirs: readonly string[]): void {
  if (dirs.length === 0) bySession.delete(sessionId);
  else bySession.set(sessionId, dirs);
  persist();
}

/** Resolves once the latest list is on disk. */
export function flushSessionAdditionalDirs(): Promise<void> {
  return writes;
}

/**
 * The provider adapters ask this resolver for a session's extra folders (Claude `--add-dir`,
 * Codex writable roots), without folders deleted since. With a state file the lists are loaded from it, so compact and rewind
 * after a restart still see them; an unreadable file reads as empty and is left for inspection.
 */
export function installHostAdditionalDirsResolver(file?: string): void {
  stateFile = file;
  bySession = new Map();
  if (file) {
    const stored = readStateFileSync(file, parseStored, { quarantine: false });
    if (stored.status === "ok") bySession = stored.value;
  }
  setAdditionalDirsResolver((sessionId) => (bySession.get(sessionId) ?? []).filter(isDirectory));
}
