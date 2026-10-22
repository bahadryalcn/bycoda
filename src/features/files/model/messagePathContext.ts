import { statFiles } from "../../../platform/tauri/fs";
import { isEqualOrInside, joinPath, parentPath, pathKey, resolveWorkspacePath, slash } from "../../../shared/lib/paths";

const MAX_MESSAGE_FOLDERS = 24;

/**
 * Folders named by paths elsewhere in the same message. Agents often give a
 * folder once and then list its files by name only.
 */
export function messageReferenceFolders(text: string, cwd: string): string[] {
  const folders = new Map<string, string>();
  const add = (path: string) => {
    const key = pathKey(path);
    if (key !== pathKey(cwd) && !folders.has(key)) folders.set(key, path);
  };
  const references = /`([^`\r\n]{1,4096})`|\]\(([^)\s]{1,4096})\)/g;
  for (const match of text.matchAll(references)) {
    if (folders.size >= MAX_MESSAGE_FOLDERS) break;
    const reference = (match[1] ?? match[2]).trim();
    if (!/[\\/]/.test(reference)) continue;
    const path = resolveWorkspacePath(reference, cwd);
    if (!path) continue;
    // Extensionless references may name a folder or a file.
    if (!/[\\/]$/.test(reference)) add(parentPath(path));
    add(path);
  }
  return [...folders.values()].slice(0, MAX_MESSAGE_FOLDERS);
}

/** The same project-relative reference placed under each folder the message names. */
export function messageFileCandidates(path: string, cwd: string, text: string): string[] {
  if (!isEqualOrInside(path, cwd) || pathKey(path) === pathKey(cwd)) return [];
  const relative = slash(path).slice(slash(cwd).replace(/\/+$/, "").length + 1);
  const seen = new Set([pathKey(path)]);
  const candidates: string[] = [];
  for (const folder of messageReferenceFolders(text, cwd)) {
    const candidate = joinPath(folder, relative);
    const key = pathKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Resolves a reference that does not exist at the project root against the
 * folders the message names. This works for ignored folders, which the
 * project file index leaves out.
 */
export async function resolveMessageFileReference(
  path: string,
  cwd: string | undefined,
  text: string,
): Promise<string> {
  if (!cwd) return path;
  const candidates = messageFileCandidates(path, cwd, text);
  if (candidates.length === 0) return path;
  const infos = await statFiles([path, ...candidates]).catch(() => []);
  const existing = infos.find((info) => info.isDir || info.mtimeMs != null);
  return existing?.path ?? path;
}
