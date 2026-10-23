import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { RefreshCw, X } from "../../../shared/ui/icons";
import { useRemoteMachineOnline } from "../model/connections";
import type { RemoteMachine } from "../model/protocol";
import { connectionIndicator, needsSignIn } from "../model/remoteConnection";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";
import {
  isReconnecting,
  subscribeReconnecting,
  reconnectRemoteMachine,
  cancelRemoteReconnect,
} from "../model/remoteReconnect";
import { useRemoteLifecycle } from "../model/remoteLifecycle";
import { RemoteConnectionDetails } from "./RemoteConnectionDetails";

/** Shared host health badge. The compact row uses it bare; the details panel adds diagnostics. */
export function MachineStatus({
  machine,
  details = false,
  compact = false,
}: {
  machine: RemoteMachine;
  details?: boolean;
  compact?: boolean;
}) {
  useRemoteMachineOnline(machine.id);
  const state = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(machine.environmentId),
    () => readRemoteConnection(machine.environmentId),
  );
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    () => isReconnecting(machine.environmentId),
    () => false,
  );
  const lifecycle = useRemoteLifecycle(machine.environmentId);
  const degraded = Object.values(lifecycle.features).some((feature) => feature.status !== "ready");
  const indicator = connectionIndicator(state, reconnecting);
  const label = reconnecting
    ? t("Reconnecting")
    : state.status === "host-key"
      ? t("Review required")
      : state.status === "needs-auth"
        ? t("Authentication required")
        : state.status === "outdated-host"
          ? t("Update Host")
          : indicator.tone === "down"
            ? t("Not connected")
            : indicator.tone === "connecting"
              ? t("Connecting")
              : t(degraded ? "Refresh pending" : "Connected");
  const tone =
    needsSignIn(state.status) || state.status === "unreachable"
      ? "warning"
      : indicator.tone === "connected" && !degraded
        ? "success"
        : "neutral";
  // A healthy compact row keeps only the dot; every other state spells out its text.
  const dotOnly =
    compact &&
    !details &&
    !state.error &&
    !degraded &&
    !needsSignIn(state.status) &&
    indicator.tone === "connected";
  const badge = dotOnly ? (
    <Badge variant="dot" size="sm" tone={tone} title={label}>
      <span className="sr-only">{label}</span>
    </Badge>
  ) : (
    <Badge variant="dot" size="sm" tone={tone} title={label}>
      {label}
    </Badge>
  );
  if (!details) return badge;
  return (
    <div className="flex flex-col items-start gap-2" aria-live="polite">
      {badge}
      {state.error ? (
        <details
          className="w-full text-xs text-(--ui-text-muted)"
          open={needsSignIn(state.status) || undefined}
        >
          <summary className="cursor-pointer py-1">{t("Connection details")}</summary>
          <p className="mbs-1 break-words leading-relaxed">{state.error}</p>
        </details>
      ) : null}
      <RemoteConnectionDetails environmentId={machine.environmentId} />
    </div>
  );
}

export function ReconnectAction({ machine }: { machine: RemoteMachine }) {
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    () => isReconnecting(machine.environmentId),
    () => false,
  );
  const state = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(machine.environmentId),
    () => readRemoteConnection(machine.environmentId),
  );
  return (
    <>
      <Button
        variant="ghost"
        iconOnly
        label={t("Reconnect")}
        loading={reconnecting}
        disabled={state.status === "identity-mismatch"}
        onClick={() => void reconnectRemoteMachine(machine.environmentId, { signIn: true })}
      >
        <RefreshCw aria-hidden className="icon-sm" />
      </Button>
      {reconnecting ? (
        <Button
          variant="ghost"
          iconOnly
          label={t("Cancel reconnect")}
          onClick={() => cancelRemoteReconnect(machine.environmentId)}
        >
          <X aria-hidden className="icon-sm" />
        </Button>
      ) : null}
    </>
  );
}
