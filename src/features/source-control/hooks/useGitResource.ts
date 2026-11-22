import { useMachineAvailability } from "../../connections/public/machineAvailability";
import {
  classifyFailureLifetime,
  useGracedFailure,
} from "../../connections/public/transientFailure";
import { useReloadOnReconnect } from "../../connections/public/useReloadOnReconnect";
import { useCallback, useEffect, useRef, useState } from "react";
import { isGitWatched, subscribeGitChanged } from "../../../platform/tauri/fs";

type Snapshot<T> = {
  key: string;
  data: T | null;
  loading: boolean;
  /** What the last read rejected with; unset after a success. */
  cause?: unknown;
  /** `data` and `cause` are the outcome of a read this hook finished since its
   * key, availability or refresh last changed, not only what the cache kept. Remote health
   * may learn only from such an outcome: a paused read is no answer from the machine. */
  settled: boolean;
};
// Results stay cached so a revisited panel opens with its last data, but the
// cache is a least-recently-used one: commit diffs, blame and history pages
// would otherwise pile up for as long as the window lives.
const MAX_CACHED_RESOURCES = 96;
const MAX_CACHED_BYTES = 16 * 1024 * 1024;
const cache = new Map<string, unknown>();
const cacheSizes = new Map<string, number>();
let cachedBytes = 0;
const completed = new Map<string, number>();
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
  if (pending.length) return Number.POSITIVE_INFINITY;
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

function writeCached(key: string, data: unknown): boolean {
  cachedBytes -= cacheSizes.get(key) ?? 0;
  cache.delete(key);
  cacheSizes.delete(key);
  const size = estimateBytes(data);
  if (!Number.isFinite(size)) {
    completed.delete(key);
    return false;
  }
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
  return true;
}

/** Retain good data on refresh failure; ignore replies from a previous resource. */
export function useGitResource<T>(
  cwd: string,
  key: string,
  wanted: boolean,
  read: () => Promise<T>,
  watch = true,
  minRefreshMs = 0,
  quiet = false,
) {
  // A machine that cannot be asked gets no reads; they start once it is available again.
  const available = useMachineAvailability(cwd).available;
  const enabled = wanted && available;
  const [nonce, setNonce] = useState(0);
  const refreshKey = useRef<string | null>(null);
  const retryRun = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(() => {
    refreshKey.current = key;
    setNonce((value) => value + 1);
  }, [key]);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({
    key,
    data: readCached<T>(key) ?? null,
    loading: enabled && (!quiet || !completed.has(key)),
    settled: false,
  }));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep this resource's admitted reads synchronized with checkout notifications and resume events until unmount.
  useEffect(() => {
    const forced = refreshKey.current === key;
    refreshKey.current = null;
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    // Throttle background refreshes of this mounted resource after a permanent
    // refusal without caching its error across visits.
    let lastPermanentFailure: number | undefined;
    // Progress is for a read someone waits on: the first one, or an explicit
    // refresh. A watcher or focus reload of shown data stays silent, or busy
    // checkouts (many agents committing) would keep the refresh control spinning.
    const shows = (force: boolean, data: T | null) =>
      (!quiet || !completed.has(key)) && (force || (data === null && !cache.has(key)));
    setSnapshot((previous) => ({
      key,
      data: previous.key === key ? previous.data : (readCached<T>(key) ?? null),
      loading: enabled && shows(forced, previous.key === key ? previous.data : null),
      settled: false,
    }));
    if (!enabled) return;
    const load = async (force = false) => {
      const prior = lastPermanentFailure ?? completed.get(key);
      if (!force && prior !== undefined && Date.now() - prior < minRefreshMs) {
        setSnapshot((previous) => ({ ...previous, loading: false }));
        return;
      }
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      const readGeneration = generation;
      setSnapshot((previous) =>
        shows(force, previous.key === key ? previous.data : null)
          ? { ...previous, loading: true }
          : previous,
      );
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
              if (current() && writeCached(key, data)) {
                completed.set(key, Date.now());
              }
              return data;
            })
            .catch((error) => {
              if (current()) completed.delete(key);
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
          lastPermanentFailure = undefined;
          setSnapshot({ key, data: outcome.data, loading: false, settled: true });
          break;
        }
      } catch (error) {
        lastPermanentFailure =
          classifyFailureLifetime(error) === "permanent" ? Date.now() : undefined;
        if (!cancelled)
          setSnapshot((previous) => ({
            ...previous,
            loading: false,
            cause: error,
            settled: true,
          }));
      } finally {
        inFlight = false;
        if (pending && !cancelled) {
          pending = false;
          void load();
        }
      }
    };
    retryRun.current = load;
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
      const prior = lastPermanentFailure ?? completed.get(key);
      const fresh =
        (covered && isGitWatched(cwd)) ||
        (prior !== undefined && Date.now() - prior < RESUME_TTL_MS);
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
      retryRun.current = null;
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [cwd, key, enabled, read, watch, nonce, minRefreshMs, quiet]);
  const current: Snapshot<T> =
    snapshot.key === key
      ? snapshot
      : {
          key,
          data: readCached<T>(key) ?? null,
          loading: enabled,
          settled: false,
        };
  const retry = () => retryRun.current?.();
  const error = enabled ? current.cause : undefined;
  const { visibleError, pending } = useGracedFailure({ error, retry, scope: key });
  useReloadOnReconnect(cwd, retry, {
    active: error != null && classifyFailureLifetime(error) === "transient",
  });
  return { ...current, error: visibleError ?? null, loading: current.loading || pending, refresh };
}

export function resetGitResourceCache() {
  generation++;
  cache.clear();
  cacheSizes.clear();
  cachedBytes = 0;
  completed.clear();
  flights.clear();
}
