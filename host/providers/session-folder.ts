import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readStateFile } from "../storage/atomic-write";

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
 * Where a session without a project (stored cwd exactly `~`) runs: the configured folder,
 * created when missing, else the home folder. Any other cwd, including `~/x`, is returned
 * unchanged for `expandHome`.
 */
export async function resolveSessionCwd(
  cwd: string,
  home = homedir(),
): Promise<string | undefined> {
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
