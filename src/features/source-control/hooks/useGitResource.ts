import { useCallback, useEffect, useState } from "react";
import { isGitWatched, subscribeGitChanged } from "../../../platform/tauri/fs";

type Snapshot<T> = {
  key: string;
  data: T | null;
  loading: boolean;
  error: string | null;
};
const cache = new Map<string, unknown>();
const completed = new Map<string, { at: number; error: string | null }>();
const flights = new Map<string, Promise<unknown>>();
let generation = 0;
const RESUME_TTL_MS = 30_000;

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
    data: (cache.get(key) as T | undefined) ?? null,
    loading: enabled && (!quiet || !completed.has(key)),
    error: completed.get(key)?.error ?? null,
  }));
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    setSnapshot((previous) => ({
      key,
      data: previous.key === key ? previous.data : ((cache.get(key) as T | undefined) ?? null),
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
                cache.set(key, data);
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
          data: (cache.get(key) as T | undefined) ?? null,
          loading: enabled,
          error: null,
        };
  return { ...current, refresh };
}

export function resetGitResourceCache() {
  generation++;
  cache.clear();
  completed.clear();
  flights.clear();
}
