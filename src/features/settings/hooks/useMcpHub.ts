import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import {
  withDirectServer,
  type McpLoadingPolicy,
  type McpLoadingState,
  type McpOAuthServer,
} from "../model/mcp";
import { cacheMcpLoading, getCachedMcpLoading } from "../model/mcpSettingsCache";

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
  /** Hub name of the server with a sign-in or sign-out request in flight. */
  busy: string;
  dismissError: () => void;
  refresh: () => Promise<void>;
  setMode: (mode: McpLoadingPolicy["mode"]) => Promise<void>;
  setDirect: (name: string, direct: boolean) => Promise<void>;
  signIn: (name: string) => Promise<void>;
  signOut: (name: string) => Promise<void>;
};

/**
 * Owner-only Host state for MCP: the loading policy, the secret-free hub inventory and the
 * Host-held sign-ins. A global view reads without a project so only user-wide sources show.
 */
export function useMcpHub(cwd: string, globalOnly: boolean): McpHub {
  const scope = globalOnly ? undefined : cwd;
  const cacheKey = scope ?? "";
  const [loading, setLoading] = useState<McpLoadingState | undefined>(() =>
    getCachedMcpLoading(cacheKey),
  );
  const [oauth, setOauth] = useState<McpOAuthServer[]>();
  const [pending, setPending] = useState(!loading);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [waiting, setWaiting] = useState("");
  const [busy, setBusy] = useState("");
  const machine = useRef<RemoteMachine | undefined>(undefined);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const params = scope ? { cwd: scope } : {};

  async function host() {
    if (machine.current) return machine.current;
    const machines = await invoke<RemoteMachine[]>("remote_machines");
    const local = machines?.find(isLocalSyncMachine);
    if (!local) throw new Error("Local host unavailable");
    machine.current = local;
    return local;
  }

  async function load() {
    const version = ++epoch.current;
    try {
      const target = await host();
      const [nextLoading, nextOauth] = await Promise.all([
        remoteRequest<McpLoadingState>(target.id, "mcp.hub.loading.get", params),
        remoteRequest<{ servers: McpOAuthServer[] }>(target.id, "mcp.oauth.status", params),
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
          t("bycoda Host status unavailable. Check the local host connection, then refresh."),
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
    };
  }, [cacheKey]);

  const stateOf = useEffectEvent((name: string) => oauth?.find((s) => s.name === name)?.state);
  const poll = useEffectEvent(() => load());
  // Reason: the browser redirect completes on the Host, so poll until the state changes or the Host gives up.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- polls the Host while one sign-in is open; cleared on completion, timeout or unmount
  useEffect(() => {
    if (!waiting) return;
    const before = stateOf(waiting);
    const timer = setInterval(() => {
      void poll().then((next) => {
        const state = next?.find((server) => server.name === waiting)?.state;
        if (next && state !== before) setWaiting("");
      });
    }, POLL_MS);
    const stop = setTimeout(() => setWaiting(""), WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [waiting]);

  async function savePolicy(policy: McpLoadingPolicy) {
    if (inFlight.current || !machine.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await remoteRequest<{ policy: McpLoadingPolicy }>(
        machine.current.id,
        "mcp.hub.loading.set",
        { mode: policy.mode, direct: policy.direct },
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

  async function oauthAction(name: string, method: "mcp.oauth.start" | "mcp.oauth.signOut") {
    if (inFlight.current || !machine.current) return;
    inFlight.current = true;
    setBusy(name);
    setError("");
    try {
      if (method === "mcp.oauth.start") {
        const { authorizationUrl } = await remoteRequest<{ authorizationUrl: string }>(
          machine.current.id,
          method,
          { name, ...params },
        );
        await openExternal(authorizationUrl);
        setWaiting(name);
      } else {
        await remoteRequest(machine.current.id, method, { name, ...params });
        setWaiting("");
        await load();
      }
    } catch {
      setError(
        method === "mcp.oauth.start"
          ? t("Sign-in could not be started. Check the server, then try again.")
          : t("Sign-out failed. Try again."),
      );
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  return {
    loading,
    oauth,
    pending,
    error,
    saving,
    waiting,
    busy,
    dismissError: () => setError(""),
    refresh: async () => void (await load()),
    setMode: async (mode) => {
      if (loading && !loading.corrupt) await savePolicy({ ...loading.policy, mode });
    },
    setDirect: async (name, direct) => {
      if (loading && !loading.corrupt)
        await savePolicy(withDirectServer(loading.policy, name, direct));
    },
    signIn: (name) => oauthAction(name, "mcp.oauth.start"),
    signOut: (name) => oauthAction(name, "mcp.oauth.signOut"),
  };
}
