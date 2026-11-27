import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import {
  withDirectServer,
  type ManagedMcpConfig,
  type ManagedMcpRequest,
  type McpLoadingPolicy,
  type McpLoadingState,
  type McpOAuthServer,
} from "../model/mcp";
import { cacheMcpLoading, getCachedMcpLoading } from "../model/mcpSettingsCache";
import type { RemoteMcpConfigTarget } from "../model/mcpConfigTarget";

/** The browser sign-in is abandoned by the Host after this long, so polling stops with it. */
const WAIT_MS = 5 * 60_000;
const POLL_MS = 2_000;

export type McpHub = {
  loading?: McpLoadingState;
  oauth?: McpOAuthServer[];
  /** First read has not answered yet. */
  pending: boolean;
  error: string;
  saving: boolean;
  /** Hub name of the server whose browser sign-in is open. */
  waiting: string;
  /** Hub name of the server with a cancellable sign-in. */
  signingIn?: string;
  /** Hub name of the server with a sign-in or sign-out request in flight. */
  busy: string;
  dismissError: () => void;
  refresh: () => Promise<void>;
  setMode: (mode: McpLoadingPolicy["mode"]) => Promise<void>;
  setDirect: (name: string, direct: boolean) => Promise<void>;
  signIn: (name: string) => Promise<void>;
  cancelSignIn?: () => void;
  signOut: (name: string) => Promise<void>;
  accountProfile?: (name: string) => Promise<string | undefined>;
  manageServer?: (
    scope: "user" | "project",
    input: ManagedMcpRequest,
  ) => Promise<{ name: string; revision: string; config: ManagedMcpConfig } | { removed: true }>;
  projectCredentials?: (
    operation: "status" | "set" | "clear",
    name: string,
    values?: Record<string, string>,
  ) => Promise<{ configured: boolean; kind: "http" | "stdio" }>;
};

/**
 * Owner-only Host state for MCP: the loading policy, the secret-free hub inventory and the
 * Host-held sign-ins. A global view reads without a project so only user-wide sources show.
 */
export function useMcpHub(
  cwd: string,
  globalOnly: boolean,
  remote?: RemoteMcpConfigTarget,
): McpHub {
  const scope = globalOnly ? undefined : cwd;
  const cacheKey = remote
    ? JSON.stringify([remote.machineId, remote.environmentId, remote.projectId])
    : (scope ?? "");
  const [loading, setLoading] = useState<McpLoadingState | undefined>(() =>
    getCachedMcpLoading(cacheKey),
  );
  const [oauth, setOauth] = useState<McpOAuthServer[]>();
  const [pending, setPending] = useState(!loading);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState("");
  const [signingIn, setSigningIn] = useState("");
  const [busy, setBusy] = useState("");
  const machine = useRef<RemoteMachine | undefined>(undefined);
  const activeSignIn = useRef<AbortController | undefined>(undefined);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const params = scope ? (remote ? { projectId: remote.projectId } : { cwd: scope }) : {};

  async function machineId() {
    if (remote) return remote.machineId;
    if (machine.current) return machine.current.id;
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    const local = machines?.find(isLocalSyncMachine);
    if (!local) throw new Error("Local host unavailable");
    machine.current = local;
    return local.id;
  }

  function request<T>(
    target: string,
    method: string,
    data: Record<string, unknown>,
    interactive = false,
  ): Promise<T> {
    return remote
      ? remoteRequest<T>(target, method, data, false, interactive, remote.environmentId)
      : remoteRequest<T>(target, method, data);
  }

  async function load(interactive = false) {
    const version = ++epoch.current;
    try {
      const target = await machineId();
      const [nextLoading, nextOauth] = await Promise.all([
        request<McpLoadingState>(target, "mcp.hub.loading.get", params, interactive),
        request<{ servers: McpOAuthServer[] }>(target, "mcp.oauth.status", params, interactive),
      ]);
      if (version !== epoch.current) return undefined;
      cacheMcpLoading(cacheKey, nextLoading);
      setLoading(nextLoading);
      setOauth(nextOauth.servers);
      setError("");
      return nextOauth.servers;
    } catch {
      if (version === epoch.current)
        setError(
          t("MCP session status is unavailable. Check the computer’s connection and refresh."),
        );
      return undefined;
    } finally {
      if (version === epoch.current) setPending(false);
    }
  }

  const loadOnMount = useEffectEvent(() => void load());
  // Reason: read Host-owned loading and sign-in state per view; stale replies are dropped by epoch.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps Host-owned MCP state in step while mounted; epoch drops stale replies
  useEffect(() => {
    const replies = epoch;
    loadOnMount();
    return () => {
      replies.current++;
      activeSignIn.current?.abort();
      activeSignIn.current = undefined;
    };
  }, [cacheKey]);

  const stateOf = useEffectEvent((name: string) => oauth?.find((s) => s.name === name));
  const poll = useEffectEvent(() => load());
  const finishWaiting = useEffectEvent((attempt: AbortController) => finishSignIn(attempt));
  const relayedSignIn = !!remote;
  // Reason: the browser redirect completes on the Host, so poll until the state changes or the Host gives up.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- polls the Host while one sign-in is open; cleared on completion, timeout or unmount
  useEffect(() => {
    if (!waiting || relayedSignIn) return;
    const attempt = activeSignIn.current;
    if (!attempt) return;
    const before = stateOf(waiting);
    const timer = setInterval(() => {
      void poll().then((next) => {
        const status = next?.find((server) => server.name === waiting);
        if (next && (status?.state !== before?.state || status?.inherited !== before?.inherited))
          finishWaiting(attempt);
      });
    }, POLL_MS);
    const stop = setTimeout(() => finishWaiting(attempt), WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [waiting, relayedSignIn]);

  async function savePolicy(policy: McpLoadingPolicy) {
    if (activeSignIn.current || inFlight.current || (!remote && !machine.current)) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await request<{ policy: McpLoadingPolicy }>(
        await machineId(),
        "mcp.hub.loading.set",
        { mode: policy.mode, direct: policy.direct },
        true,
      );
      setLoading((current) => {
        const next = current && { ...current, policy: result.policy };
        if (next) cacheMcpLoading(cacheKey, next);
        return next;
      });
    } catch {
      // Refetch first: a successful read clears errors, and this one must stay visible.
      await load();
      setError(t("Saving MCP loading failed. The previous setting is still active."));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function finishSignIn(attempt: AbortController) {
    if (activeSignIn.current !== attempt) return;
    activeSignIn.current = undefined;
    setSigningIn("");
    setBusy("");
    setWaiting("");
  }

  async function signIn(name: string) {
    if (activeSignIn.current || inFlight.current || (!remote && !machine.current)) return;
    const attempt = new AbortController();
    const { signal } = attempt;
    activeSignIn.current = attempt;
    setSigningIn(name);
    setBusy(name);
    setError("");
    let closeCallback: (() => Promise<unknown>) | undefined;
    let cancelHost: (() => Promise<unknown>) | undefined;
    let keepWaiting = false;
    const cancel = () => {
      void closeCallback?.();
      void cancelHost?.().catch(() => {
        if (signal.reason === "user" && !activeSignIn.current) setError(t("Sign-in failed"));
      });
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const target = await machineId();
      if (signal.aborted) return;
      const binding = remote
        ? await invoke<{ id: string; port: number }>("mcp_oauth_callback_bind")
        : undefined;
      if (binding) {
        let closing: Promise<unknown> | undefined;
        closeCallback = () =>
          (closing ??= invoke("mcp_oauth_callback_cancel", { id: binding.id }).catch(
            () => undefined,
          ));
      }
      if (signal.aborted) return;
      const { authorizationUrl } = await request<{ authorizationUrl: string }>(
        target,
        "mcp.oauth.start",
        { name, ...params, ...(binding && { callbackPort: binding.port }) },
        true,
      );
      const authorization = new URL(authorizationUrl);
      const state = authorization.searchParams.get("state");
      if (!state) throw new Error("MCP sign-in is missing its callback state.");
      cancelHost = () => request(target, "mcp.oauth.cancel", { name, ...params, state }, true);
      if (signal.aborted) {
        cancel();
        return;
      }
      if (
        binding &&
        authorization.searchParams.get("redirect_uri") !==
          `http://127.0.0.1:${binding.port}/callback`
      ) {
        await cancelHost().catch(() => undefined);
        if (!signal.aborted) setError(t("Update needed"));
        return;
      }
      await openExternal(authorizationUrl);
      if (signal.aborted) return;
      setWaiting(name);
      if (!binding) {
        keepWaiting = true;
        setBusy("");
        return;
      }
      const result = await invoke<{ state: string; code?: string; error?: string }>(
        "mcp_oauth_callback_wait",
        { id: binding.id, state },
      );
      if (signal.aborted) return;
      setSigningIn("");
      setWaiting("");
      const { status } = await request<{ status: "success" | "cancelled" | "failure" }>(
        target,
        "mcp.oauth.complete",
        { name, ...params, ...result },
        true,
      );
      if (!signal.aborted) {
        await load();
        if (status === "failure" && !signal.aborted) setError(t("Sign-in failed"));
      }
    } catch {
      if (!signal.aborted) {
        void cancelHost?.().catch(() => undefined);
        setError(t("Sign-in could not be started. Check the server, then try again."));
      }
    } finally {
      await closeCallback?.();
      if (!keepWaiting) finishSignIn(attempt);
    }
  }

  function cancelSignIn() {
    const attempt = activeSignIn.current;
    if (!attempt) return;
    attempt.abort("user");
    finishSignIn(attempt);
  }

  async function signOut(name: string) {
    if (activeSignIn.current || inFlight.current || (!remote && !machine.current)) return;
    inFlight.current = true;
    setBusy(name);
    setError("");
    try {
      await request(await machineId(), "mcp.oauth.signOut", { name, ...params }, true);
      await load();
    } catch {
      setError(t("Sign-out failed. Try again."));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  return {
    loading,
    manageServer: loading?.managedServers
      ? async (scope, input) => {
          if (scope === "project" && !params.cwd && !params.projectId)
            throw new Error(t("Unavailable"));
          const result = await request<
            { name: string; revision: string; config: ManagedMcpConfig } | { removed: true }
          >(
            await machineId(),
            "mcp.hub.servers",
            { ...(scope === "project" ? params : {}), ...input },
            true,
          );
          if (input.action !== "get") await load(true);
          return result;
        }
      : undefined,
    oauth,
    pending,
    error,
    saving,
    waiting,
    signingIn,
    busy,
    dismissError: () => setError(""),
    refresh: async () => void (await load(true)),
    setMode: async (mode) => {
      if (loading && !loading.corrupt) await savePolicy({ ...loading.policy, mode });
    },
    setDirect: async (name, direct) => {
      if (loading && !loading.corrupt)
        await savePolicy(withDirectServer(loading.policy, name, direct));
    },
    signIn,
    cancelSignIn,
    signOut,
    accountProfile: async (name) => {
      const result = await request<{ servers: McpOAuthServer[] }>(
        await machineId(),
        "mcp.oauth.status",
        { ...params, profileFor: name },
      );
      return result.servers.find((server) => server.name === name)?.profile;
    },
    projectCredentials:
      scope || loading?.managedServers
        ? async (operation, name, values) => {
            const result = await request<{ configured: boolean; kind: "http" | "stdio" }>(
              await machineId(),
              `mcp.projectCredentials.${operation}`,
              {
                ...(!scope
                  ? { global: true }
                  : remote
                    ? { projectId: remote.projectId }
                    : { cwd: scope }),
                name,
                ...(values && { values }),
              },
              true,
            );
            if (operation !== "status") {
              setLoading((current) => {
                if (!current?.inventory) return current;
                const next = {
                  ...current,
                  inventory: current.inventory.map((server) =>
                    server.name === name
                      ? { ...server, projectCredentialsConfigured: result.configured }
                      : server,
                  ),
                };
                cacheMcpLoading(cacheKey, next);
                return next;
              });
              await load();
            }
            return result;
          }
        : undefined,
  };
}
