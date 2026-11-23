import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { Tooltip, OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Laptop, MoreHorizontal, Server } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { buildIdentity } from "../../../shared/model/build-info";
import {
  loadRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../../settings/public/settings";
import { ConnectionSyncLine } from "./ConnectionSyncLine";
import { LocalHostModeSwitch } from "./LocalHostModeSwitch";
import { MachineRoutesLine } from "./MachineRoutesLine";
import type { MachineProbe } from "./useMachineProbes";
import { useMachineRouteSummary } from "./useMachineRouteSummary";
import { isLocalSyncMachine } from "../model/localSync";
import {
  isMachineEnabled,
  isMachineTurningOff,
  setMachineEnabled,
  subscribeMachineSwitch,
} from "../model/machineEnabled";
import {
  MACHINE_STATUS_TONE,
  machineStatus,
  machineSummary,
  machineSummaryText,
  reconnectingEndsIn,
  type MachineStatus,
} from "../model/machineSummary";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";
import { isReconnecting, subscribeReconnecting } from "../model/remoteReconnect";
import { machineContext, machineLabel } from "../model/machineIdentity";
import type { RemoteMachine } from "../model/protocol";

/** A machine's connection state. Until this page's own check returns, it shows
 * what the rest of the app (the project rail) last learned about the machine,
 * so the two never disagree. */
function useMachineConnection(machine: RemoteMachine, probed?: MachineProbe) {
  const environmentId = machine.environmentId;
  const shared = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(environmentId),
    () => readRemoteConnection(environmentId),
  );
  const enabled = useSyncExternalStore(
    subscribeMachineSwitch,
    () => isMachineEnabled(environmentId),
    () => true,
  );
  const turningOff = useSyncExternalStore(
    subscribeMachineSwitch,
    () => isMachineTurningOff(environmentId),
    () => false,
  );
  const reconnecting = useSyncExternalStore(
    subscribeReconnecting,
    () => isReconnecting(environmentId),
    () => false,
  );
  const autoReconnect = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  const [now, setNow] = useState(Date.now);
  const endsIn = reconnectingEndsIn(shared, now);
  // The shared grace elapses with no event of its own; re-render when it does so
  // "Reconnecting" turns into "Offline" without waiting for the next probe.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- A timer cannot be computed in render: it wakes the row when the shared grace ends and cancels on cleanup.
  useEffect(() => {
    if (endsIn === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), endsIn + 50);
    return () => clearTimeout(timer);
  }, [endsIn]);
  const status = machineStatus({
    enabled: enabled || isLocalSyncMachine(machine),
    connection: shared,
    reconnecting,
    autoReconnect,
    probed,
    now,
  });
  return { status, enabled, turningOff, error: shared.error };
}

/** Why a status deserves a word more than its label gives; shown behind an info icon. */
function statusReason(status: MachineStatus, probed?: MachineProbe, error?: string) {
  if (status === "connected" && probed === "provider")
    return t("Install a supported provider on the host.");
  if ((status === "offline" || status === "reconnecting") && error) return error;
  return undefined;
}

export function MachineRow({
  machine,
  machines,
  probed,
  version,
  needsUpdate,
  showDetails,
  editing,
  busy,
  revoking,
  menuOpen,
  onUpdateHost,
  onReconnect,
  onToggleMenu,
  onToggleDetails,
  onSyncNow,
}: {
  machine: RemoteMachine;
  machines: RemoteMachine[];
  probed?: MachineProbe;
  /** The build the machine reported on its latest check. */
  version?: string;
  needsUpdate: boolean;
  /** The routes panel is open: asked for by the routes button or the row menu. */
  showDetails: boolean;
  editing: boolean;
  busy: boolean;
  revoking: boolean;
  menuOpen: boolean;
  onUpdateHost: () => void;
  onReconnect: () => void;
  onToggleMenu: (anchor: HTMLElement) => void;
  onToggleDetails: () => void;
  onSyncNow: () => void;
}) {
  const local = isLocalSyncMachine(machine);
  const context = machineContext(machines, machine);
  const connection = useMachineConnection(machine, probed);
  const routes = useMachineRouteSummary(machine, probed);
  const summary = machineSummary({
    routeKind: local ? undefined : routes.kind,
    status: connection.status,
    version,
    desktopVersion: buildIdentity?.buildId,
    routeCount: local ? 0 : routes.count,
  });
  const reason = statusReason(connection.status, probed, connection.error);
  const Icon = local ? Laptop : Server;
  return (
    <div
      {...surfaceAttributes(
        { variant: editing ? "selected" : undefined },
        "flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5",
      )}
    >
      <Icon aria-hidden className="icon-lg mt-0.5 shrink-0" tone="muted" />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <Tooltip label={machine.name} when={local ? "always" : "overflow"}>
            <Text as="span" size="secondary" weight="medium" truncate>
              {local ? t("This computer") : machine.name}
            </Text>
          </Tooltip>
          {!local && context ? (
            <OverflowTooltip label={context}>
              <Text tone="muted" truncate className="min-w-0">
                {context}
              </Text>
            </OverflowTooltip>
          ) : null}
        </div>
        <Text
          as="div"
          tone="muted"
          className="flex min-w-0 flex-wrap items-center gap-x-3"
          data-machine-summary
          aria-label={machineSummaryText(summary)}
        >
          {summary.parts.map((part) =>
            part.id === "status" ? (
              <span key={part.id} className="inline-flex items-center gap-x-1">
                <Badge variant="dot" size="sm" tone={MACHINE_STATUS_TONE[connection.status]}>
                  {part.text}
                </Badge>
                {reason ? (
                  <InfoPopover label={t("About this status")} className="shrink-0">
                    <Text as="p">{reason}</Text>
                  </InfoPopover>
                ) : null}
              </span>
            ) : (
              <span key={part.id}>{part.text}</span>
            ),
          )}
          {summary.routes && !local ? (
            <span className="inline-flex items-center whitespace-nowrap">
              <Button
                variant="link"
                size="sm"
                expanded={showDetails}
                chevron="end"
                onClick={onToggleDetails}
                type="button"
              >
                {summary.routes}
              </Button>
            </span>
          ) : null}
        </Text>
        <ConnectionSyncLine machineId={machine.id} onSyncNow={onSyncNow} />
        {local ? <LocalHostModeSwitch /> : null}
        {showDetails ? (
          <Text
            as="div"
            size="caption"
            tone="muted"
            leading="inherit"
            className="connection-details"
          >
            <MachineRoutesLine machine={machine} />
            {machine.ssh?.port ? (
              <Text as="div" size="micro" tone="muted" className="mt-1">
                {t("SSH port")} <Code tone="primary">{machine.ssh.port}</Code>
              </Text>
            ) : null}
          </Text>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {machine.ssh && needsUpdate && connection.enabled ? (
          <Button
            stableWidth
            disabled={busy}
            onClick={onUpdateHost}
            variant="secondary"
            className="shrink-0"
            type="button"
          >
            {t("Update Host")}
          </Button>
        ) : machine.ssh && probed === "offline" && connection.enabled ? (
          <Button
            stableWidth
            disabled={busy}
            onClick={onReconnect}
            variant="secondary"
            className="shrink-0"
            type="button"
          >
            {t("Reconnect")}
          </Button>
        ) : null}
        {!local ? (
          <>
            {connection.turningOff ? (
              <Text tone="muted" size="secondary" as="span">
                {t("Turning off…")}
              </Text>
            ) : null}
            <Switch
              aria-label={t("Use {p0}", { p0: machineLabel(machines, machine) })}
              checked={connection.enabled}
              disabled={busy || revoking}
              onCheckedChange={(on) => setMachineEnabled(machine.environmentId, on)}
            />
          </>
        ) : null}
        <Button
          stableWidth
          iconOnly
          variant="ghost"
          label={t("Actions for {p0}", { p0: machineLabel(machines, machine) })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={busy || revoking}
          onClick={(event) => onToggleMenu(event.currentTarget)}
          type="button"
        >
          <MoreHorizontal aria-hidden className="icon-md" />
        </Button>
      </div>
    </div>
  );
}
