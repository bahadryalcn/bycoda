import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cachedRemoteCapabilities, subscribeRemoteCapabilities } from "./connections";
import { acquireRemoteHostRuntime } from "./remoteMachineChannel";
import {
  parseHostModelCatalog,
  persistModelCatalog,
  readPersistedModelCatalog,
  resetRemoteModelCatalogStoreForTests,
} from "./remoteModelCatalogStore";
import type { HostModelCatalog } from "./protocol";

/** The Host, project and environment that own one model catalog. */
export interface RemoteModelCatalogScope {
  machineId: string;
  environmentId: string;
  projectId: string;
}

type CatalogRequest = <T>(method: string, params?: unknown) => Promise<T>;

/** Capability under which a Host pushes `{ kind: "models" }` snapshots. */
const STREAM_CAPABILITY = "models.catalog.stream.v1";

const cachedCatalogs = new Map<string, HostModelCatalog>();
const CACHE_LIMIT = 64;

export const remoteModelCatalogScopeKey = (scope: RemoteModelCatalogScope) =>
  JSON.stringify([scope.machineId, scope.environmentId, scope.projectId]);

function rememberCatalog(key: string, catalog: HostModelCatalog) {
  cachedCatalogs.delete(key);
  cachedCatalogs.set(key, catalog);
  while (cachedCatalogs.size > CACHE_LIMIT)
    cachedCatalogs.delete(cachedCatalogs.keys().next().value!);
  persistModelCatalog(key, catalog);
}

/** Memory cache first, then the persisted last-known catalog. */
const knownCatalog = (key: string) => cachedCatalogs.get(key) ?? readPersistedModelCatalog(key);

/** Isolate UI harnesses that intentionally reuse machine/project identifiers. */
export function resetRemoteModelCatalogCacheForTests() {
  cachedCatalogs.clear();
  resetRemoteModelCatalogStoreForTests();
}

/** Simulate an app restart: forget memory, keep what was persisted. */
export function forgetRemoteModelCatalogMemoryForTests() {
  cachedCatalogs.clear();
}

interface CatalogState {
  key: string;
  catalog: HostModelCatalog | undefined;
  error: string;
  /** A response or snapshot arrived since mount (or since the last error). */
  fresh: boolean;
}

/**
 * Reads a Host's model catalog for one machine/environment/project scope. A
 * hosts that advertises `models.catalog.stream.v1` pushes snapshots over the WS
 * runtime; otherwise (or when the stream closes or fails) the progressive
 * `models.list` is polled. A result that arrives after the scope changed, the
 * pane was hidden, or the effect was replaced is dropped, and a scope switch
 * never shows the previous scope's catalog or error. The last good catalog is
 * persisted per scope and seeds the state; `stale` is true while that
 * remembered catalog is shown and nothing fresh has arrived (or after an
 * error). `refresh` restarts the read.
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
  const { projectId, machineId, environmentId } = scope;
  const [state, setState] = useState<CatalogState>(() => ({
    key,
    catalog: knownCatalog(key),
    error: "",
    fresh: false,
  }));
  const [refreshToken, setRefreshToken] = useState(0);
  // The read attempt whose stream closed or failed; that attempt polls instead.
  const [streamFailed, setStreamFailed] = useState("");
  const streaming = useSyncExternalStore(
    subscribeRemoteCapabilities,
    () => cachedRemoteCapabilities(environmentId)?.includes(STREAM_CAPABILITY) === true,
  );
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  }, [request]);

  // Reason: opens the Host stream or the polling loop for this scope and tears it down on change.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | undefined;
    let route: ReturnType<typeof acquireRemoteHostRuntime>;
    const attempt = `${key}\n${hostEnvironmentId ?? ""}\n${refreshToken}`;

    const apply = (value: HostModelCatalog) => {
      rememberCatalog(key, value);
      setState({ key, catalog: value, error: "", fresh: true });
    };
    const fail = (reason: unknown) =>
      setState((current) => ({
        key,
        catalog: current.key === key ? current.catalog : knownCatalog(key),
        error: String(reason),
        fresh: false,
      }));
    const poll = () => {
      const load = () =>
        void requestRef
          .current<HostModelCatalog>("models.list", { projectId, progressive: true })
          .then((value) => {
            if (disposed) return;
            apply(value);
            if (value.pending?.length) timer = setTimeout(load, 1000);
          })
          .catch((reason) => {
            if (!disposed) fail(reason);
          });
      load();
    };
    const fallBack = () => {
      if (!disposed) setStreamFailed(attempt);
    };

    if (streaming && streamFailed !== attempt) {
      try {
        route = acquireRemoteHostRuntime(machineId);
        release = route?.runtime.retain(
          { kind: "models", projectId },
          {
            parse: (data) => parseHostModelCatalog(data),
            commit: (value, input) => {
              if (disposed || !input.isCurrent()) return;
              apply(value);
            },
            closed: fallBack,
            onError: (error) => {
              fail(error);
              fallBack();
            },
          },
        );
      } catch {
        release = undefined;
      }
      if (!release) {
        route?.release();
        route = undefined;
        poll();
      }
    } else poll();

    return () => {
      disposed = true;
      clearTimeout(timer);
      release?.();
      route?.release();
    };
  }, [
    key,
    projectId,
    machineId,
    enabled,
    hostEnvironmentId,
    refreshToken,
    streaming,
    streamFailed,
  ]);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);
  const current = state.key === key ? state : undefined;
  const catalog = current ? current.catalog : knownCatalog(key);
  return {
    catalog,
    error: current?.error ?? "",
    /** True while the shown catalog is remembered data, not a fresh Host answer. */
    stale: catalog !== undefined && !current?.fresh,
    refresh,
  };
}
