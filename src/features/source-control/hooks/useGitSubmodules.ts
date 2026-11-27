import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invokeWorkspace, subscribeGitChanged } from "../../../platform/tauri/fs";
import { joinPath, pathKey } from "../../../shared/lib/paths";
import { monotonicNow } from "../../../shared/lib/time/timestamps";
import { useMachineAvailability } from "../../connections/public/machineAvailability";

type Modules = Readonly<Record<string, readonly string[]>>;
/** The size bound that cut one checkout's repository scan short; its list is partial. */
export type DiscoveryLimit = "entries" | "directories" | "depth" | "repositories";
type Discovery = { modules: readonly string[]; limit: DiscoveryLimit | null };
type Limits = Readonly<Record<string, DiscoveryLimit>>;
type Snapshot = { key: string; modules: Modules; limits: Limits; error?: string };
const EMPTY: Modules = {};
const NO_LIMITS: Limits = {};
const pending = new Map<string, Promise<Discovery>>();
const cached = new Map<string, Discovery>();
/** A failed discovery waits this long, doubling per consecutive failure up to the cap. A scan
 * that times out on a loaded remote Host was restarted by every Git change, so agents that
 * commit continuously kept that Host spending its whole deadline on it about 100 times an hour. */
export const FAILED_DISCOVERY_BACKOFF_MS = 30_000;
const MAX_FAILED_DISCOVERY_BACKOFF_MS = 10 * 60_000;
const failures = new Map<string, { until: number; delayMs: number; reason: unknown }>();

export function resetGitSubmoduleCache() {
  cached.clear();
  failures.clear();
}

const cacheKey = (cwd: string, includeRepositories: boolean) =>
  `${includeRepositories ? "repositories" : "submodules"}:${pathKey(cwd)}`;

function list(cwd: string, includeRepositories: boolean, force: boolean): Promise<Discovery> {
  const key = cacheKey(cwd, includeRepositories);
  const running = pending.get(key);
  if (running) return running;
  const failed = failures.get(key);
  // Only an explicit refresh asks again before the backoff ends.
  if (!force && failed && monotonicNow() < failed.until) return Promise.reject(failed.reason);
  // Only the repository scan has a size bound to report; gitlink-only discovery answers a plain list.
  // A remote Host reuses a recent scan for every client unless an explicit refresh asks `fresh`.
  const request = invokeWorkspace<string[] | { paths: string[]; limit: DiscoveryLimit | null }>(
    "git_submodules",
    {
      cwd,
      ...(includeRepositories ? { includeRepositories: true } : {}),
      ...(force ? { fresh: true } : {}),
    },
  ).then(
    (result) => {
      const { paths, limit } = Array.isArray(result) ? { paths: result, limit: null } : result;
      const found = { modules: paths.map((path) => joinPath(cwd, path)), limit };
      cached.set(key, found);
      failures.delete(key);
      return found;
    },
    (reason: unknown) => {
      const delayMs = Math.min(
        Math.max((failures.get(key)?.delayMs ?? 0) * 2, FAILED_DISCOVERY_BACKOFF_MS),
        MAX_FAILED_DISCOVERY_BACKOFF_MS,
      );
      failures.set(key, { until: monotonicNow() + delayMs, delayMs, reason });
      throw reason;
    },
  );
  pending.set(key, request);
  const clear = () => {
    if (pending.get(key) === request) pending.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

/**
 * One checkout's answer. The repository scan walks the whole working tree (seconds of CPU on a
 * large checkout, every open slowed by file-filter drivers), so it runs only for the first load
 * of a checkout in the app session and for an explicit refresh. Every other revalidation (Git
 * changes, focus) re-reads just the Git index and folds its gitlinks into the last inventory: a
 * new submodule appears, a removed one leaves, standalone repositories stay as scanned.
 */
async function discover(root: string, includeRepositories: boolean, force: boolean) {
  if (!includeRepositories) return list(root, false, force);
  const inventoryKey = cacheKey(root, true);
  const inventory = cached.get(inventoryKey);
  if (force || !inventory) return list(root, true, force);
  const linksKey = cacheKey(root, false);
  const before = new Set(cached.get(linksKey)?.modules);
  const links = (await list(root, false, false)).modules;
  const now = new Set(links);
  const merged = {
    modules: [
      ...inventory.modules.filter((path) => !before.has(path) || now.has(path)),
      ...links.filter((path) => !inventory.modules.includes(path)),
    ],
    limit: inventory.limit,
  };
  cached.set(inventoryKey, merged);
  return merged;
}

/**
 * Read-only discovery, shared in flight and revalidated on Git changes or focus (gitlinks only
 * once a repository inventory exists; see `discover`). `limits` names the checkouts whose scan
 * stopped at a size bound: their `modules` are real but incomplete.
 */
export function useGitSubmodules(
  paths: readonly string[],
  wanted: boolean,
  includeRepositories = false,
) {
  // The roots of one view share a machine; one that cannot be asked is not read.
  const available = useMachineAvailability(paths[0]).available;
  const enabled = wanted && available;
  const rootsKey = JSON.stringify([...new Set(paths.filter((path) => path && path !== "~"))]);
  const key = `${includeRepositories}:${rootsKey}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: "",
    modules: EMPTY,
    limits: NO_LIMITS,
  });
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const reload = useCallback(() => refresh(), []);
  // Set by an explicit refresh only: it alone reruns the repository scan and asks a remote Host
  // for a fresh one; Git changes and focus wait out a failure's backoff.
  const forced = useRef(false);
  const refreshNow = useCallback(() => {
    forced.current = true;
    refresh();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const roots: string[] = JSON.parse(rootsKey);
    if (!roots.length) return;
    let cancelled = false;
    const force = forced.current;
    forced.current = false;
    void Promise.allSettled(roots.map((root) => discover(root, includeRepositories, force))).then(
      (results) => {
        if (cancelled) return;
        setSnapshot((previous) => {
          const modules: Record<string, readonly string[]> = {};
          const limits: Record<string, DiscoveryLimit> = {};
          let error: string | undefined;
          results.forEach((result, index) => {
            const root = roots[index];
            if (result.status === "fulfilled") {
              modules[root] = result.value.modules;
              if (result.value.limit) limits[root] = result.value.limit;
            } else {
              const known =
                cached.get(cacheKey(root, includeRepositories)) ??
                (previous.key === key
                  ? { modules: previous.modules[root], limit: previous.limits[root] ?? null }
                  : undefined);
              if (known?.modules) {
                modules[root] = known.modules;
                if (known.limit) limits[root] = known.limit;
              }
              error = String(result.reason);
              // The panel shows only a summary; the log keeps which checkout failed and why.
              console.warn("[source-control] repository discovery failed", root, error);
            }
          });
          return { key, modules, limits, error };
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, rootsKey, includeRepositories, revision]);

  useEffect(() => {
    if (!enabled) return;
    const roots: string[] = JSON.parse(rootsKey);
    if (!roots.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delayMs: number) => {
      clearTimeout(timer);
      if (document.hidden) return;
      if (delayMs <= 0) reload();
      else timer = setTimeout(reload, delayMs);
    };
    const changed = () => schedule(250);
    const resume = () => schedule(0);
    const stops = roots.map((cwd) => subscribeGitChanged(changed, { cwd }));
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, rootsKey, reload]);

  const known = (JSON.parse(rootsKey) as string[]).flatMap((root) => {
    const found = cached.get(cacheKey(root, includeRepositories));
    return found ? [[root, found] as const] : [];
  });
  return {
    modules:
      snapshot.key === key
        ? snapshot.modules
        : Object.fromEntries(known.map(([root, found]) => [root, found.modules])),
    limits:
      snapshot.key === key
        ? snapshot.limits
        : Object.fromEntries(
            known.flatMap(([root, found]) => (found.limit ? [[root, found.limit]] : [])),
          ),
    error: snapshot.key === key ? snapshot.error : undefined,
    refresh: refreshNow,
  };
}
