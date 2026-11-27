import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
import { RefreshCw, X } from "../../../shared/ui/icons";
import { useRemoteMachineOnline } from "../model/connections";
import { useMachineFocus } from "../hooks/useMachineFocus";
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
  showDiagnostics = true,
  quiet = false,
}: {
  machine: RemoteMachine;
  details?: boolean;
  /** List rows: say nothing while the machine is simply not connected; only live or problem states show. */
  quiet?: boolean;
  /** A detail surface can place the secondary host diagnostics in its own disclosure. */
  showDiagnostics?: boolean;
}) {
  useRemoteMachineOnline(machine.id);
  // A machine shown in settings is one the user is looking at: keep its status live.
  useMachineFocus(machine.environmentId);
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
            ? lifecycle.paused
              ? t("Automatic reconnect paused")
              : t("Not connected")
            : indicator.tone === "connecting"
              ? t("Connecting")
              : degraded
                ? t("Refresh pending")
                : t("Connected");
  const tone =
    needsSignIn(state.status) || state.status === "unreachable"
      ? "warning"
      : indicator.tone === "connected" && !degraded
        ? "success"
        : "neutral";
  if (quiet && !details && indicator.tone === "down" && tone === "neutral" && !lifecycle.paused)
    return null;
  // Health is readable whenever it is live or a problem; SSH capability is a separate type label.
  const badge = (
    <Badge variant="dot" size="sm" tone={tone}>
      <LiveText text={label} />
    </Badge>
  );
  if (!details) return badge;
  return (
    <div className="flex flex-col items-start gap-2">
      {badge}
      {state.error ? <ErrorDetails title={label} detail={state.error} /> : null}
      {showDiagnostics ? <RemoteConnectionDetails environmentId={machine.environmentId} /> : null}
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
        disabledReason={
          state.status === "identity-mismatch"
            ? t("This computer's identity changed. Remove it and add it again to reconnect.")
            : undefined
        }
        onClick={() => void reconnectRemoteMachine(machine.environmentId, { signIn: true })}
      >
        <RefreshCw aria-hidden className="icon-sm" />
      </Button>
      {reconnecting ? (
        <Button
          variant="ghost"
          iconOnly
          label={t("Stop reconnecting")}
          onClick={() => cancelRemoteReconnect(machine.environmentId)}
        >
          <X aria-hidden className="icon-sm" />
        </Button>
      ) : null}
    </>
  );
}
