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
//
// Every list pass walks the whole distinct-cwd working set in order, so a
// small count-bounded cache evicts each entry before the scan reaches it again
// and turns every pass into synchronous lookups. Entries are therefore kept
// while they are used and swept only after sitting idle; the hard cap is a
// safety net far above any real working set, and in-flight refreshes are
// capped so one pass cannot flood the shared filesystem thread pool.
const NORMALIZED_PATH_TTL_MS = 5_000;
const NORMALIZED_PATH_IDLE_MS = 10 * 60_000;
const NORMALIZED_PATH_SWEEP_MS = 60_000;
const NORMALIZED_PATH_SWEEP_FROM = 1_024;
const NORMALIZED_PATH_LIMIT = 65_536;
const MAX_REFRESHES = 8;
type Entry = { value: string; at: number; used: number; refreshing: boolean };
const normalizedPaths = new Map<string, Entry>();
let lastSweep = 0;
let refreshes = 0;

/** Forgets every resolved path, for workers that must not trust earlier jobs' mappings. */
export function resetProjectPathCache() {
  normalizedPaths.clear();
  lastSweep = 0;
}

function expand(path: string): string {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\")
    ? join(homedir(), path.slice(1))
    : path;
}

function canonical(value: string, platform: NodeJS.Platform): string {
  const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return platform === "win32" || platform === "darwin" ? slashed.toLowerCase() : slashed;
}

/** Drops paths nobody asked about for a while; hot paths are never touched. */
function sweepIdle(now: number) {
  if (normalizedPaths.size <= NORMALIZED_PATH_SWEEP_FROM) return;
  if (now - lastSweep < NORMALIZED_PATH_SWEEP_MS) return;
  lastSweep = now;
  for (const [key, entry] of normalizedPaths)
    if (now - entry.used >= NORMALIZED_PATH_IDLE_MS) normalizedPaths.delete(key);
}

function remember(key: string, entry: Entry) {
  normalizedPaths.delete(key);
  normalizedPaths.set(key, entry);
  sweepIdle(entry.at);
  while (normalizedPaths.size > NORMALIZED_PATH_LIMIT)
    normalizedPaths.delete(normalizedPaths.keys().next().value!);
}

function refresh(key: string, expanded: string, platform: NodeJS.Platform, entry: Entry) {
  entry.refreshing = true;
  refreshes++;
  realpath.native(expanded, (error, resolved) => {
    refreshes--;
    // A missing project folder compares as written, like the first lookup.
    const value = canonical(error ? expanded : resolved, platform);
    if (normalizedPaths.get(key) === entry)
      remember(key, { value, at: Date.now(), used: entry.used, refreshing: false });
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
  const now = Date.now();
  if (known) {
    known.used = now;
    // An expired value stays served; a refresh over the cap is retried by the
    // next lookup instead of queueing behind the others.
    if (now - known.at >= NORMALIZED_PATH_TTL_MS && !known.refreshing && refreshes < MAX_REFRESHES)
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
  remember(key, { value, at: now, used: now, refreshing: false });
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
