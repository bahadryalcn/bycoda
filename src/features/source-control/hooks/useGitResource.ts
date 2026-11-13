import { useCallback, useEffect, useRef, useState } from "react";
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
type FlightGroup = { latest?: Promise<unknown>; pending: number; latestPending: boolean };
const flights = new Map<string, FlightGroup>();
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
  const refreshKey = useRef<string | null>(null);
  const refresh = useCallback(() => {
    refreshKey.current = key;
    setNonce((value) => value + 1);
  }, [key]);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    key,
    data: readCached<T>(key) ?? null,
    loading: enabled && (!quiet || !completed.has(key)),
    error: completed.get(key)?.error ?? null,
  }));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep this resource's admitted reads synchronized with checkout notifications and resume events until unmount.
  useEffect(() => {
    const forced = refreshKey.current === key;
    refreshKey.current = null;
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
      const readGeneration = generation;
      if (!quiet || !completed.has(key))
        setSnapshot((previous) => ({ ...previous, loading: true }));
      try {
        // An explicit refresh follows a change: a read already running may
        // predate it, so it is replaced, and its late answer is not kept.
        const group: FlightGroup = flights.get(key) ?? { pending: 0, latestPending: false };
        let flight = !force && group.latestPending ? (group.latest as Promise<T>) : undefined;
        if (!flight) {
          const startedGeneration = generation;
          const current = () =>
            startedGeneration === generation &&
            flights.get(key) === group &&
            group.latest === flight;
          flight = read()
            .then((data) => {
              if (current()) {
                writeCached(key, data);
                completed.set(key, { at: Date.now(), error: null });
              }
              return data;
            })
            .catch((error) => {
              if (current())
                completed.set(key, {
                  at: Date.now(),
                  error: error instanceof Error ? error.message : String(error),
                });
              throw error;
            })
            .finally(() => {
              if (group.latest === flight) group.latestPending = false;
              group.pending--;
              if (!group.pending && flights.get(key) === group) flights.delete(key);
            });
          // Retain the latest identity until every superseded physical read
          // settles, including gaps between completed replacement requests.
          group.latest = flight;
          group.latestPending = true;
          group.pending++;
          flights.set(key, group);
        }
        // A sibling can replace a shared read. Follow its outcome even if it
        // completed before this obsolete read; the global cache alone is not enough.
        let outcomeGroup = group;
        while (true) {
          const outcome = await flight.then(
            (data) => ({ success: true as const, data }),
            (error: unknown) => ({ success: false as const, error }),
          );
          if (cancelled || readGeneration !== generation) return;
          outcomeGroup = flights.get(key) ?? outcomeGroup;
          const replacement = outcomeGroup.latest as Promise<T> | undefined;
          if (replacement && replacement !== flight) {
            flight = replacement;
            continue;
          }
          if (!outcome.success) throw outcome.error;
          setSnapshot({ key, data: outcome.data, loading: false, error: null });
          break;
        }
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
    void load(forced);
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
