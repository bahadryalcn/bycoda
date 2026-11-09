import { realpath, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Project lists are rebuilt several times a second, each time matching every
// registered and desktop cwd. A synchronous realpath blocks the whole Host
// event loop; over 100+ projects that took seconds on a busy Windows machine
// and pushed unrelated RPCs past their deadline. Only the first lookup of a
// path is synchronous. After the TTL the known value is still served while one
// asynchronous realpath refreshes it, so a retargeted junction is picked up
// within the TTL plus one refresh.
const NORMALIZED_PATH_TTL_MS = 5_000;
const NORMALIZED_PATH_LIMIT = 512;
type Entry = { value: string; at: number; refreshing: boolean };
const normalizedPaths = new Map<string, Entry>();

function expand(path: string): string {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\")
    ? join(homedir(), path.slice(1))
    : path;
}

function canonical(value: string, platform: NodeJS.Platform): string {
  const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return platform === "win32" || platform === "darwin" ? slashed.toLowerCase() : slashed;
}

function remember(key: string, entry: Entry) {
  normalizedPaths.delete(key);
  normalizedPaths.set(key, entry);
  while (normalizedPaths.size > NORMALIZED_PATH_LIMIT)
    normalizedPaths.delete(normalizedPaths.keys().next().value!);
}

function refresh(key: string, expanded: string, platform: NodeJS.Platform, entry: Entry) {
  entry.refreshing = true;
  realpath.native(expanded, (error, resolved) => {
    // A missing project folder compares as written, like the first lookup.
    const value = canonical(error ? expanded : resolved, platform);
    if (normalizedPaths.get(key) === entry)
      remember(key, { value, at: Date.now(), refreshing: false });
    else entry.refreshing = false;
  });
}

export function normalizeProjectPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const key = `${platform}\0${path}`;
  const known = normalizedPaths.get(key);
  const expanded = expand(path);
  if (known) {
    if (Date.now() - known.at >= NORMALIZED_PATH_TTL_MS && !known.refreshing)
      refresh(key, expanded, platform, known);
    return known.value;
  }
  let resolved = expanded;
  try {
    resolved = realpathSync.native(expanded);
  } catch {
    /* project folder may be gone; compare as written */
  }
  const value = canonical(resolved, platform);
  remember(key, { value, at: Date.now(), refreshing: false });
  return value;
}

/** Equal strings always name the same folder; only differing spellings need the filesystem. */
export function sameProjectPath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return a === b || normalizeProjectPath(a, platform) === normalizeProjectPath(b, platform);
}
