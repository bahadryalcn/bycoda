import { Disclosure } from "../../../shared/ui/Disclosure";
import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
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
  showDiagnostics = true,
}: {
  machine: RemoteMachine;
  details?: boolean;
  compact?: boolean;
  /** A detail surface can place the secondary host diagnostics in its own disclosure. */
  showDiagnostics?: boolean;
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
  // Health is always readable; SSH capability is a separate type label.
  const badge = (
    <Badge variant="dot" size="sm" tone={tone}>
      <LiveText text={label} />
    </Badge>
  );
  if (!details) return badge;
  return (
    <div className="flex flex-col items-start gap-2">
      {badge}
      {state.error ? (
        <Disclosure
          size="sm"
          className="w-full text-ui-caption text-(--ui-text-muted)"
          defaultOpen={needsSignIn(state.status)}
          summary={t("Connection details")}
        >
          <p className="break-words leading-relaxed">{state.error}</p>
        </Disclosure>
      ) : null}
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
