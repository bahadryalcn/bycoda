import { useCallback, useEffect, useState } from "react";
import { isGitWatched, subscribeGitChanged } from "../../../platform/tauri/fs";

type Snapshot<T> = {
  key: string;
  data: T | null;
  loading: boolean;
  error: string | null;
};
// Results stay cached so a revisited panel opens with its last data, but the
// cache is a least-recently-used one: commit diffs, blame and history pages
// would otherwise pile up for as long as the window lives.
const MAX_CACHED_RESOURCES = 96;
const MAX_CACHED_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, unknown>();
const cacheSizes = new Map<string, number>();
let cachedBytes = 0;
const completed = new Map<string, { at: number; error: string | null }>();
const flights = new Map<string, Promise<unknown>>();
let generation = 0;
const RESUME_TTL_MS = 30_000;

/** Rough retained size: string characters at two bytes, a fixed cost per other node. */
function estimateBytes(value: unknown): number {
  let bytes = 0;
  let budget = 50_000;
  const pending: unknown[] = [value];
  while (pending.length && budget-- > 0) {
    const item = pending.pop();
    if (typeof item === "string") bytes += item.length * 2;
    else if (item && typeof item === "object") {
      bytes += 16;
      for (const child of Array.isArray(item) ? item : Object.values(item)) pending.push(child);
    } else bytes += 8;
  }
  return bytes;
}

function readCached<T>(key: string): T | undefined {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  // Reading refreshes recency: Map order is the eviction order.
  cache.delete(key);
  cache.set(key, value);
  return value as T;
}

function writeCached(key: string, data: unknown) {
  cachedBytes -= cacheSizes.get(key) ?? 0;
  cache.delete(key);
  const size = estimateBytes(data);
  cache.set(key, data);
  cacheSizes.set(key, size);
  cachedBytes += size;
  for (const oldest of cache.keys()) {
    if (cache.size <= MAX_CACHED_RESOURCES && cachedBytes <= MAX_CACHED_BYTES) break;
    // The entry just written always stays.
    if (oldest === key) break;
    cache.delete(oldest);
    cachedBytes -= cacheSizes.get(oldest) ?? 0;
    cacheSizes.delete(oldest);
    // Without its data a "completed" mark would make a refresh interval skip the read.
    completed.delete(oldest);
  }
}

/** Retain good data on refresh failure; ignore replies from a previous resource. */
export function useGitResource<T>(
  cwd: string,
  key: string,
  enabled: boolean,
  read: () => Promise<T>,
  watch = true,
  minRefreshMs = 0,
  quiet = false,
) {
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    key,
    data: readCached<T>(key) ?? null,
    loading: enabled && (!quiet || !completed.has(key)),
    error: completed.get(key)?.error ?? null,
  }));
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    setSnapshot((previous) => ({
      key,
      data: previous.key === key ? previous.data : (readCached<T>(key) ?? null),
      loading: enabled && (!quiet || !completed.has(key)),
      error: completed.get(key)?.error ?? null,
    }));
    if (!enabled) return;
    const load = async (force = false) => {
      const prior = completed.get(key);
      if (!force && prior && Date.now() - prior.at < minRefreshMs) {
        setSnapshot((previous) => ({ ...previous, loading: false }));
        return;
      }
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      if (!quiet || !completed.has(key))
        setSnapshot((previous) => ({ ...previous, loading: true }));
      try {
        let flight = flights.get(key) as Promise<T> | undefined;
        if (!flight) {
          const startedGeneration = generation;
          flight = read()
            .then((data) => {
              if (startedGeneration === generation) {
                writeCached(key, data);
                completed.set(key, { at: Date.now(), error: null });
              }
              return data;
            })
            .catch((error) => {
              if (startedGeneration === generation)
                completed.set(key, {
                  at: Date.now(),
                  error: error instanceof Error ? error.message : String(error),
                });
              throw error;
            })
            .finally(() => {
              if (flights.get(key) === flight) flights.delete(key);
            });
          flights.set(key, flight);
        }
        const data = await flight;
        if (cancelled) return;
        setSnapshot({ key, data, loading: false, error: null });
      } catch (error) {
        if (!cancelled)
          setSnapshot((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void load();
        }
      }
    };
    void load(nonce > 0);
    // Focus alone is no reason to rerun git: a watched checkout reports its own
    // changes, and others wait out the TTL. A change seen while hidden is. A
    // resource with its own refresh interval reads beyond `.git` (a pull
    // request), so the watcher does not cover it.
    const covered = minRefreshMs === 0;
    let missed = false;
    const changed = () => {
      if (document.hidden) missed = true;
      else void load();
    };
    const resume = () => {
      if (document.hidden) return;
      const prior = completed.get(key);
      const fresh =
        (covered && isGitWatched(cwd)) || (prior && Date.now() - prior.at < RESUME_TTL_MS);
      if (!missed && fresh) return;
      missed = false;
      void load();
    };
    const unsubscribe = watch ? subscribeGitChanged(changed, { cwd, refsOnly: true }) : () => {};
    if (watch) {
      window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", resume);
    }
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [cwd, key, enabled, read, watch, nonce, minRefreshMs, quiet]);
  const current =
    snapshot.key === key
      ? snapshot
      : {
          key,
          data: readCached<T>(key) ?? null,
          loading: enabled,
          error: null,
        };
  return { ...current, refresh };
}

export function resetGitResourceCache() {
  generation++;
  cache.clear();
  cacheSizes.clear();
  cachedBytes = 0;
  completed.clear();
  flights.clear();
}
