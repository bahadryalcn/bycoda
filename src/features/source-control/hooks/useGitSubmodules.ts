import { useCallback, useEffect, useReducer, useState } from "react";
import { invokeWorkspace, subscribeGitChanged } from "../../../platform/tauri/fs";
import { joinPath, pathKey } from "../../../shared/lib/paths";

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

export function resetGitSubmoduleCache() {
  cached.clear();
}

const cacheKey = (cwd: string, includeRepositories: boolean) =>
  `${includeRepositories ? "repositories" : "submodules"}:${pathKey(cwd)}`;

function list(cwd: string, includeRepositories: boolean): Promise<Discovery> {
  const key = cacheKey(cwd, includeRepositories);
  const running = pending.get(key);
  if (running) return running;
  // Only the repository scan has a size bound to report; gitlink-only discovery answers a plain list.
  const request = invokeWorkspace<string[] | { paths: string[]; limit: DiscoveryLimit | null }>(
    "git_submodules",
    { cwd, ...(includeRepositories ? { includeRepositories: true } : {}) },
  ).then((result) => {
    const { paths, limit } = Array.isArray(result) ? { paths: result, limit: null } : result;
    const found = { modules: paths.map((path) => joinPath(cwd, path)), limit };
    cached.set(key, found);
    return found;
  });
  pending.set(key, request);
  const clear = () => {
    if (pending.get(key) === request) pending.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

/**
 * Read-only discovery, shared in flight and revalidated on Git changes or focus. `limits` names
 * the checkouts whose scan stopped at a size bound: their `modules` are real but incomplete.
 */
export function useGitSubmodules(
  paths: readonly string[],
  enabled: boolean,
  includeRepositories = false,
) {
  const rootsKey = JSON.stringify([...new Set(paths.filter((path) => path && path !== "~"))]);
  const key = `${includeRepositories}:${rootsKey}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key: "",
    modules: EMPTY,
    limits: NO_LIMITS,
  });
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const reload = useCallback(() => refresh(), []);

  useEffect(() => {
    if (!enabled) return;
    const roots: string[] = JSON.parse(rootsKey);
    if (!roots.length) return;
    let cancelled = false;
    void Promise.allSettled(roots.map((root) => list(root, includeRepositories))).then(
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
    const changed = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(reload, 250);
    };
    const resume = () => {
      if (!document.hidden) reload();
    };
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
    refresh: reload,
  };
}
