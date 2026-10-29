import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HostModelCatalog } from "./protocol";

/** The Host, project and environment that own one model catalog. */
export interface RemoteModelCatalogScope {
  machineId: string;
  environmentId: string;
  projectId: string;
}

type CatalogRequest = <T>(method: string, params?: unknown) => Promise<T>;

const cachedCatalogs = new Map<string, HostModelCatalog>();
const CACHE_LIMIT = 64;

export const remoteModelCatalogScopeKey = (scope: RemoteModelCatalogScope) =>
  JSON.stringify([scope.machineId, scope.environmentId, scope.projectId]);

function rememberCatalog(key: string, catalog: HostModelCatalog) {
  cachedCatalogs.delete(key);
  cachedCatalogs.set(key, catalog);
  while (cachedCatalogs.size > CACHE_LIMIT) cachedCatalogs.delete(cachedCatalogs.keys().next().value!);
}

/** Isolate UI harnesses that intentionally reuse machine/project identifiers. */
export function resetRemoteModelCatalogCacheForTests() {
  cachedCatalogs.clear();
}

interface CatalogState {
  key: string;
  catalog: HostModelCatalog | undefined;
  error: string;
}

/**
 * Reads a Host's progressive model catalog for one machine/environment/project
 * scope. A read that finishes after the scope changed, the pane was hidden, or
 * the effect was replaced is dropped, and a scope switch never shows the
 * previous scope's catalog or error. `refresh` restarts the read.
 */
export function useRemoteModelCatalog({
  scope,
  enabled,
  hostEnvironmentId,
  request,
}: {
  scope: RemoteModelCatalogScope;
  /** Reads run only while the Host is described and the pane is visible. */
  enabled: boolean;
  /** A replaced Host (new environment) restarts the read. */
  hostEnvironmentId: string | undefined;
  request: CatalogRequest;
}) {
  const key = remoteModelCatalogScopeKey(scope);
  const { projectId } = scope;
  const [state, setState] = useState<CatalogState>(() => ({
    key,
    catalog: cachedCatalogs.get(key),
    error: "",
  }));
  const [refreshToken, setRefreshToken] = useState(0);
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void requestRef
        .current<HostModelCatalog>("models.list", { projectId, progressive: true })
        .then((value) => {
          if (disposed) return;
          rememberCatalog(key, value);
          setState({ key, catalog: value, error: "" });
          if (value.pending?.length) timer = setTimeout(load, 1000);
        })
        .catch((reason) => {
          if (disposed) return;
          setState((current) => ({
            key,
            catalog: current.key === key ? current.catalog : cachedCatalogs.get(key),
            error: String(reason),
          }));
        });
    load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, projectId, enabled, hostEnvironmentId, refreshToken]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);
  const current = state.key === key ? state : undefined;
  return {
    catalog: current ? current.catalog : cachedCatalogs.get(key),
    error: current?.error ?? "",
    refresh,
  };
}
