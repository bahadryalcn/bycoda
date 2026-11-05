import { lstat, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Keep canonical Windows paths suitable for Git arguments and display. */
export function ordinaryWorkspacePath(path: string): string {
  if (process.platform !== "win32") return path;
  path = path.replaceAll("/", "\\");
  return path.startsWith("\\\\?\\UNC\\") ? `\\\\${path.slice(8)}` : path.replace(/^\\\\\?\\/, "");
}

/** Compare already canonical paths without changing their display spelling. */
export const workspacePathKey = (path: string): string => {
  const value = resolve(ordinaryWorkspacePath(path));
  return process.platform === "win32" ? value.toLowerCase() : value;
};

export async function canonicalWorkspacePath(path: string): Promise<string> {
  return ordinaryWorkspacePath(await realpath(ordinaryWorkspacePath(path)));
}

export function canonicalWorkspacePathSync(path: string): string {
  return ordinaryWorkspacePath(realpathSync.native(ordinaryWorkspacePath(path)));
}

export function canonicalWorkspaceDirectorySync(path: string): string {
  const absolute = resolve(ordinaryWorkspacePath(path));
  try {
    return canonicalWorkspacePathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(absolute) === absolute)
      throw error;
    return join(canonicalWorkspaceDirectorySync(dirname(absolute)), basename(absolute));
  }
}

/** Canonicalize existing ancestors of an as-yet unmaterialized directory. */
export async function canonicalWorkspaceDirectory(path: string): Promise<string> {
  const absolute = resolve(ordinaryWorkspacePath(path));
  try {
    return await canonicalWorkspacePath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(absolute) === absolute)
      throw error;
    return join(await canonicalWorkspaceDirectory(dirname(absolute)), basename(absolute));
  }
}

/** Resolve ancestor aliases, but never turn a workspace/root link into its target.
 * Descendants still need the caller's no-follow traversal checks. */
export async function canonicalWorkspaceEntry(path: string): Promise<string> {
  const absolute = resolve(ordinaryWorkspacePath(path));
  const entry = join(await canonicalWorkspaceDirectory(dirname(absolute)), basename(absolute));
  const info = await lstat(entry).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw new Error("Workspace path is a symbolic link or reparse point");
  return info ? canonicalWorkspacePath(entry) : entry;
}
