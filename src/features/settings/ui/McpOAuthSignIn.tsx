import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Text } from "../../../shared/ui/Text";
import { remoteRequest } from "../../connections/public/connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import type { McpOAuthServer, McpOAuthState } from "../model/mcp";
import { SettingsFeedback } from "../../../shared/ui/settings";
import styles from "./McpOAuthSignIn.module.css";

/** The browser sign-in is abandoned by the Host after this long, so polling stops with it. */
const WAIT_MS = 5 * 60_000;
const POLL_MS = 2_000;

const STATE_TONE: Record<McpOAuthState, BadgeTone> = {
  none: "neutral",
  "signed-in": "success",
  expired: "warning",
  error: "danger",
};

const stateLabel = (state: McpOAuthState) =>
  state === "signed-in"
    ? t("Signed in")
    : state === "expired"
      ? t("Expired")
      : state === "error"
        ? t("Sign-in failed")
        : t("Not signed in");

/** Owner-only: Host-held OAuth sign-in for HTTP MCP servers so they can load on demand. */
export function McpOAuthSignIn({ cwd }: { cwd: string }) {
  const [servers, setServers] = useState<McpOAuthServer[]>();
  const [machine, setMachine] = useState<RemoteMachine>();
  const [busy, setBusy] = useState("");
  const [waiting, setWaiting] = useState("");
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const pending = useRef(false);

  async function load(local = machine) {
    const version = ++epoch.current;
    try {
      let target = local;
      if (!target) {
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        target = machines?.find(isLocalSyncMachine);
        if (!target) throw new Error("Local host unavailable");
      }
      const result = await remoteRequest<{ servers: McpOAuthServer[] }>(
        target.id,
        "mcp.oauth.status",
        { cwd },
      );
      if (version !== epoch.current) return undefined;
      setMachine(target);
      setServers(result.servers);
      return result.servers;
    } catch {
      if (version === epoch.current)
        setError(
          t("MCP sign-in status unavailable. Check the local host connection, then refresh."),
        );
      return undefined;
    }
  }
  const loadOnMount = useEffectEvent(() => void load());
  // Reason: read the Host sign-in state on mount and per project; stale replies are dropped by epoch.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps Host-owned sign-in state in step while mounted; epoch drops stale replies
  useEffect(() => {
    const replies = epoch;
    loadOnMount();
    return () => {
      replies.current++;
    };
  }, [cwd]);

  const stateOf = useEffectEvent(
    (name: string) => servers?.find((server) => server.name === name)?.state,
  );
  const poll = useEffectEvent(() => load());
  // Reason: the browser redirect completes on the Host, so poll status until the row changes or the Host gives up.
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

  async function signIn(name: string) {
    if (!machine || pending.current) return;
    pending.current = true;
    setBusy(name);
    setError("");
    try {
      const { authorizationUrl } = await remoteRequest<{ authorizationUrl: string }>(
        machine.id,
        "mcp.oauth.start",
        { name, cwd },
      );
      await openExternal(authorizationUrl);
      setWaiting(name);
    } catch {
      setError(t("Sign-in could not be started. Check the server, then try again."));
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  async function signOut(name: string) {
    if (!machine || pending.current) return;
    pending.current = true;
    setBusy(name);
    setError("");
    try {
      await remoteRequest(machine.id, "mcp.oauth.signOut", { name, cwd });
      setWaiting("");
      await load();
    } catch {
      setError(t("Sign-out failed. Try again."));
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  if (!servers?.length && !error) return null;
  return (
    <Text
      as="section"
      size="secondary"
      tone="inherit"
      leading="inherit"
      className={styles.section}
      aria-labelledby="mcp-oauth-heading"
    >
      <div className={styles.header}>
        <Heading size="item" level={2} id="mcp-oauth-heading">
          {t("MCP sign-in")}
        </Heading>
        <InfoPopover className="shrink-0">
          <p>{t("Signing in lets the Host keep the login and load the server on demand.")}</p>
        </InfoPopover>
      </div>
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
      {waiting && (
        <SettingsFeedback state="loading" immediate>
          {t("Finish signing in in your browser…")}
        </SettingsFeedback>
      )}
      {servers?.map((server) => (
        <div key={server.name} className={styles.row} data-server={server.name}>
          <Text truncate className={styles.name}>
            {server.name}
          </Text>
          <Badge size="sm" tone={STATE_TONE[server.state]}>
            {stateLabel(server.state)}
          </Badge>
          <div className={styles.actions}>
            {server.state !== "signed-in" && (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === server.name}
                disabled={!!busy || waiting === server.name}
                onClick={() => void signIn(server.name)}
              >
                {t("Sign in")}
              </Button>
            )}
            {(server.state === "signed-in" || server.state === "expired") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onClick={() => void signOut(server.name)}
              >
                {t("Sign out")}
              </Button>
            )}
          </div>
        </div>
      ))}
    </Text>
  );
}
