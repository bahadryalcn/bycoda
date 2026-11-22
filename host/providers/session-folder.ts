import { lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readStateFile } from "../storage/atomic-write";

const SCRATCH_PREFIX = "~/.bycoda-host/scratch/session-";

export function isSessionScratchCwd(cwd: string): boolean {
  return cwd.startsWith(SCRATCH_PREFIX);
}

/** Shared with the desktop app on this machine (`set_session_folder`). */
export function sessionFolderPath(home = homedir()): string {
  return join(home, ".bycoda-host", "session-folder.json");
}

/** A local absolute folder; remote URLs and UNC shares are not session folders. */
export function isLocalAbsoluteFolder(folder: string): boolean {
  return (
    !/^[\\/]{2}/.test(folder) &&
    !folder.includes("://") &&
    !folder.includes("\0") &&
    isAbsolute(folder)
  );
}

function parseFolder(text: string): string | undefined {
  const folder = (JSON.parse(text) as { folder?: unknown }).folder;
  return typeof folder === "string" && folder.trim() ? folder.trim() : undefined;
}

/**
 * Create and resolve the reserved per-session scratch path, or resolve bare `~`
 * to the legacy configured folder. Other paths go through the caller's normal resolver.
 */
export async function resolveSessionCwd(
  cwd: string,
  home = homedir(),
): Promise<string | undefined> {
  if (isSessionScratchCwd(cwd)) {
    const id = cwd.slice(SCRATCH_PREFIX.length);
    if (!/^[A-Za-z0-9_-]{1,180}$/u.test(id)) throw new Error("Invalid session scratch directory");
    const root = join(home, ".bycoda-host", "scratch");
    const path = join(root, `session-${id}`);
    await mkdir(root, { recursive: true });
    if (!(await lstat(root)).isDirectory()) throw new Error("Invalid session scratch root");
    await mkdir(path, { recursive: true });
    if (!(await lstat(path)).isDirectory()) throw new Error("Invalid session scratch directory");
    return path;
  }
  if (cwd !== "~") return undefined;
  const state = await readStateFile(sessionFolderPath(home), parseFolder, {
    quarantine: false,
  }).catch(() => undefined);
  const folder = state?.status === "ok" ? state.value : undefined;
  if (folder && isLocalAbsoluteFolder(folder)) {
    try {
      await mkdir(folder, { recursive: true });
      return folder;
    } catch {
      // Unusable folder: fall back to home like an unset choice.
    }
  }
  return home;
}
