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

/** Polling waits 1, 2, 4 ... s between reads, never more than 30 s. */
const POLL_BASE_MS = 1_000;
const POLL_MAX_MS = 30_000;
/** Re-reads while providers stay pending (about three minutes), then polling stops. */
const POLL_PENDING_LIMIT = 10;
/** Re-reads after failed reads (about two minutes), then the error stays until `refresh`. */
const POLL_RETRY_LIMIT = 8;
const pollDelay = (count: number) => Math.min(POLL_BASE_MS * 2 ** count, POLL_MAX_MS);

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

function retainCodexCatalog(
  value: HostModelCatalog,
  previous?: HostModelCatalog,
): HostModelCatalog {
  const models = previous?.models.codex;
  if (
    !models?.length ||
    value.models.codex !== undefined ||
    (!value.pending?.includes("codex") && !value.errors.codex) ||
    value.errors.codex?.startsWith("Codex CLI is not authenticated.") ||
    (value.accounts &&
      !value.accounts.codex?.some(
        (account) => account.id === "default" && account.status !== "signed-out",
      ))
  )
    return value;
  return { ...value, models: { ...value.models, codex: models } };
}

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
  /** The refresh token whose read last answered, answer or failure. */
  settled: number;
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
 * error). Polling is bounded: a failed read retries with exponential backoff
 * (up to 30 s, 8 times) while the last catalog and the error stay shown, a
 * catalog with pending providers is re-read with growing delays (10 times), and
 * a due read waits while the window is hidden. `refresh` restarts the read with
 * fresh budgets.
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
    settled: 0,
  }));
  const [{ token: refreshToken, force: forceRefresh }, setRefresh] = useState({
    token: 0,
    force: false,
  });
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
  // The refresh token whose forced read was already sent (answered or failed). A forced read is a one-shot argument.
  const spentRefresh = useRef(0);

  // Reason: opens the Host stream or the polling loop for this scope and tears it down on change.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | undefined;
    let unwatchVisibility: (() => void) | undefined;
    let route: ReturnType<typeof acquireRemoteHostRuntime>;
    const attempt = `${key}\n${hostEnvironmentId ?? ""}\n${refreshToken}`;

    const apply = (value: HostModelCatalog) => {
      const catalog = retainCodexCatalog(value, knownCatalog(key));
      rememberCatalog(key, catalog);
      setState({ key, catalog, error: "", fresh: catalog === value, settled: refreshToken });
    };
    const fail = (reason: unknown) =>
      setState((current) => ({
        key,
        catalog: current.key === key ? current.catalog : knownCatalog(key),
        error: String(reason),
        fresh: false,
        settled: refreshToken,
      }));
    const poll = () => {
      // Consecutive failed reads, and consecutive answers that still listed pending providers.
      let failures = 0;
      let waits = 0;
      // A due read is held back while the window is hidden and runs when it shows again.
      let held = false;
      const schedule = (delay: number) => {
        timer = setTimeout(() => {
          if (disposed) return;
          if (document.hidden) held = true;
          else load();
        }, delay);
      };
      const load = (refresh = false) =>
        void requestRef
          .current<HostModelCatalog>("models.list", {
            projectId,
            progressive: true,
            ...(refresh ? { refresh: true } : {}),
          })
          .then((value) => {
            if (disposed) return;
            apply(value);
            // The forced read is spent: let the effect return to the Host stream (polling hosts keep polling).
            if (forceRefresh && streaming)
              setRefresh((current) =>
                current.token === refreshToken && current.force
                  ? { token: current.token, force: false }
                  : current,
              );
            failures = 0;
            if (!value.pending?.length && !value.errors.codex) waits = 0;
            else if (waits < POLL_PENDING_LIMIT) schedule(pollDelay(waits++));
          })
          .catch((reason) => {
            if (disposed) return;
            // The remembered catalog stays shown with the error until a read answers.
            fail(reason);
            if (failures < POLL_RETRY_LIMIT) schedule(pollDelay(failures++));
          });
      const onVisible = () => {
        if (disposed || document.hidden || !held) return;
        held = false;
        load();
      };
      document.addEventListener("visibilitychange", onVisible);
      unwatchVisibility = () => document.removeEventListener("visibilitychange", onVisible);
      // A re-run of this effect for the same refresh token (scope, pane or Host change) reads normally.
      const forced = forceRefresh && spentRefresh.current !== refreshToken;
      if (forced) spentRefresh.current = refreshToken;
      load(forced);
    };
    const fallBack = () => {
      if (!disposed) setStreamFailed(attempt);
    };

    if (streaming && !forceRefresh && streamFailed !== attempt) {
      try {
        route = acquireRemoteHostRuntime(machineId);
        release = route?.runtime.retain(
          { kind: "models", projectId },
          {
            parse: (data) => parseHostModelCatalog(data),
            commit: (value, input) => {
              if (disposed || !input.isCurrent()) return;
              apply(value);
              if (value.errors.codex) fallBack();
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
      unwatchVisibility?.();
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
    forceRefresh,
    streaming,
    streamFailed,
  ]);

  const refresh = useCallback(
    () => setRefresh(({ token }) => ({ token: token + 1, force: false })),
    [],
  );
  const retry = useCallback(
    () => setRefresh(({ token }) => ({ token: token + 1, force: true })),
    [],
  );
  const current = state.key === key ? state : undefined;
  const catalog = current ? current.catalog : knownCatalog(key);
  return {
    catalog,
    error: current?.error ?? "",
    /** True while the shown catalog is remembered data, not a fresh Host answer. */
    stale: catalog !== undefined && !current?.fresh,
    /** True from a `refresh` until the Host answers or fails that read. */
    loading: enabled && !!current && current.settled !== refreshToken,
    refresh,
    retry,
  };
}
