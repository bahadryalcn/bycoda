import { useCallback, useEffect, useReducer, useState } from "react";
import { invokeWorkspace, subscribeGitChanged } from "../../../platform/tauri/fs";
import { joinPath, pathKey } from "../../../shared/lib/paths";

type Modules = Readonly<Record<string, readonly string[]>>;
type Snapshot = { key: string; modules: Modules; error?: string };
const EMPTY: Modules = {};
const pending = new Map<string, Promise<string[]>>();
const cached = new Map<string, readonly string[]>();

export function resetGitSubmoduleCache() {
  cached.clear();
}

const cacheKey = (cwd: string, includeRepositories: boolean) =>
  `${includeRepositories ? "repositories" : "submodules"}:${pathKey(cwd)}`;

function list(cwd: string, includeRepositories: boolean): Promise<string[]> {
  const key = cacheKey(cwd, includeRepositories);
  const running = pending.get(key);
  if (running) return running;
  const request = invokeWorkspace<string[]>("git_submodules", {
    cwd,
    ...(includeRepositories ? { includeRepositories: true } : {}),
  }).then((paths) => {
    const modules = paths.map((path) => joinPath(cwd, path));
    cached.set(key, modules);
    return modules;
  });
  pending.set(key, request);
  const clear = () => {
    if (pending.get(key) === request) pending.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

/** Read-only discovery, shared in flight and revalidated on Git changes or focus. */
export function useGitSubmodules(
  paths: readonly string[],
  enabled: boolean,
  includeRepositories = false,
) {
  const rootsKey = JSON.stringify([...new Set(paths.filter((path) => path && path !== "~"))]);
  const key = `${includeRepositories}:${rootsKey}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: "", modules: EMPTY });
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
          let error: string | undefined;
          results.forEach((result, index) => {
            const root = roots[index];
            if (result.status === "fulfilled") modules[root] = result.value;
            else {
              const known =
                cached.get(cacheKey(root, includeRepositories)) ??
                (previous.key === key ? previous.modules[root] : undefined);
              if (known) modules[root] = known;
              error = String(result.reason);
            }
          });
          return { key, modules, error };
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

  return {
    modules:
      snapshot.key === key
        ? snapshot.modules
        : Object.fromEntries(
            (JSON.parse(rootsKey) as string[]).flatMap((root) => {
              const modules = cached.get(cacheKey(root, includeRepositories));
              return modules ? [[root, modules]] : [];
            }),
          ),
    error: snapshot.key === key ? snapshot.error : undefined,
    refresh: reload,
  };
}
