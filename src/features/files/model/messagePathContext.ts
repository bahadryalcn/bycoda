import { listDir, statFiles } from "../../../platform/tauri/fs";
import {
  isEqualOrInside,
  joinPath,
  parentPath,
  pathKey,
  resolveWorkspacePath,
  slash,
} from "../../../shared/lib/paths";

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
    const paths = [path];
    // Replies sometimes include the project folder in a relative path, e.g.
    // `ui-tests/investor-deck/` while cwd already ends in `ui-tests`.
    // Keep the ordinary cwd-relative interpretation first; the alternate is
    // used only if metadata confirms that a requested file actually exists.
    const relative = reference.replace(/\\/g, "/");
    const projectFolder = slash(cwd).replace(/\/+$/, "").split("/").pop();
    const prefix = relative.split("/")[0];
    if (
      projectFolder &&
      pathKey(joinPath(cwd, prefix)) === pathKey(joinPath(cwd, projectFolder)) &&
      relative.includes("/")
    ) {
      const projectRelative = resolveWorkspacePath(reference, parentPath(cwd));
      if (projectRelative) paths.push(projectRelative);
    }
    for (const folder of paths) {
      // Extensionless references may name a folder or a file.
      if (!/[\\/]$/.test(reference)) add(parentPath(folder));
      add(folder);
    }
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

/** A session path ending in `/` names a folder the session listed. */
function sessionFolder(path: string): string {
  return path.endsWith("/") ? path.replace(/\/+$/, "") : parentPath(path);
}

function projectRelative(path: string, cwd: string): string | undefined {
  if (!isEqualOrInside(path, cwd) || pathKey(path) === pathKey(cwd)) return undefined;
  return slash(path).slice(slash(cwd).replace(/\/+$/, "").length + 1);
}

/**
 * The same project-relative reference beside files the session's tools
 * touched. An agent working in another folder names its files bare
 * (`read.rs`), and the project root is the wrong place to look for them.
 * Files with the same relative path come first, then their folders.
 */
export function sessionFileCandidates(
  path: string,
  cwd: string,
  sessionPaths: readonly string[],
): string[] {
  if (sessionPaths.length === 0) return [];
  const relative = projectRelative(path, cwd);
  if (!relative) return [];
  // Compare in the file's own key space so Windows paths match case-insensitively.
  const endsWithRelative = (file: string) => {
    const normalized = slash(file);
    const base = normalized.slice(0, -(relative.length + 1));
    return (
      normalized.length > relative.length + 1 &&
      normalized[base.length] === "/" &&
      pathKey(joinPath(base, relative)) === pathKey(normalized)
    );
  };
  const seen = new Set([pathKey(path)]);
  const exact: string[] = [];
  const nearby: string[] = [];
  const add = (list: string[], candidate: string) => {
    const key = pathKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(candidate);
  };
  for (const file of sessionPaths) {
    if (!file.endsWith("/") && endsWithRelative(file)) add(exact, file);
  }
  for (const file of sessionPaths) {
    if (nearby.length >= MAX_MESSAGE_FOLDERS) break;
    add(nearby, joinPath(sessionFolder(file), relative));
  }
  return [...exact, ...nearby];
}

const SESSION_SEARCH_MAX_FOLDERS = 4;
const SESSION_SEARCH_MAX_CHILDREN = 40;
/** Folders too large to list usefully, and never where an agent names sources. */
const SESSION_SEARCH_SKIPPED = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".venv",
  "venv",
  "target",
]);

/** A drive, home or other shallow folder holds unrelated projects. */
function tooBroadToSearch(folder: string, cwd: string): boolean {
  const local = slash(folder).replace(/^remote:\/\/[^/]+\//, "");
  return local.split("/").filter(Boolean).length < 3 || isEqualOrInside(cwd, folder);
}

/**
 * The reference one level below the folders the session worked in outside
 * the project, then below their parents: a session that touched
 * `bykit/temp/read.patch` finds `bykit/src/read.rs`. Inside the project the
 * file index already searches everywhere.
 */
async function sessionNeighborCandidates(
  relative: string,
  cwd: string,
  sessionPaths: readonly string[],
): Promise<string[]> {
  const folders = new Map<string, string>();
  for (const file of sessionPaths) {
    if (folders.size >= SESSION_SEARCH_MAX_FOLDERS) break;
    const folder = sessionFolder(file);
    if (!isEqualOrInside(folder, cwd) && !tooBroadToSearch(folder, cwd))
      folders.set(pathKey(folder), folder);
  }
  const roots = new Map<string, string>();
  for (const folder of folders.values()) {
    roots.set(pathKey(folder), folder);
    const parent = parentPath(folder);
    if (pathKey(parent) !== pathKey(folder) && !tooBroadToSearch(parent, cwd))
      roots.set(pathKey(parent), parent);
  }
  const listings = await Promise.all(
    [...roots.values()].map((root) => listDir(root).catch(() => [])),
  );
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const entries of listings) {
    let children = 0;
    for (const entry of entries) {
      if (!entry.isDir || SESSION_SEARCH_SKIPPED.has(entry.name)) continue;
      if (children++ >= SESSION_SEARCH_MAX_CHILDREN) break;
      const candidate = joinPath(entry.path, relative);
      const key = pathKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function firstExisting(infos: { path: string; isDir?: boolean; mtimeMs?: number | null }[]) {
  return infos.find((info) => info.isDir || info.mtimeMs != null)?.path;
}

/**
 * Resolves a reference that does not exist at the project root against the
 * folders the message names, then beside files the session touched, then one
 * folder further out. This works for ignored folders, which the project file
 * index leaves out.
 */
export async function resolveMessageFileReference(
  path: string,
  cwd: string | undefined,
  text: string,
  sessionPaths: readonly string[] = [],
): Promise<string> {
  if (!cwd) return path;
  const candidates = [
    ...messageFileCandidates(path, cwd, text),
    ...sessionFileCandidates(path, cwd, sessionPaths),
  ];
  if (candidates.length === 0) return path;
  const existing = firstExisting(await statFiles([path, ...candidates]).catch(() => []));
  if (existing) return existing;
  const relative = projectRelative(path, cwd);
  if (!relative || sessionPaths.length === 0) return path;
  const neighbors = await sessionNeighborCandidates(relative, cwd, sessionPaths);
  if (neighbors.length === 0) return path;
  return firstExisting(await statFiles(neighbors).catch(() => [])) ?? path;
}
