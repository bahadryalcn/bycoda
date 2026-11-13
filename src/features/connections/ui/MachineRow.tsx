import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { useSyncExternalStore } from "react";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Tooltip, OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Laptop, MoreHorizontal, Server } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ConnectionSyncLine } from "./ConnectionSyncLine";
import { MachineRoutesLine } from "./MachineRoutesLine";
import type { MachineProbe } from "./useMachineProbes";
import { isLocalSyncMachine } from "../model/localSync";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";
import { connectionIndicator } from "../model/remoteConnection";
import { machineContext, machineLabel } from "../model/machineIdentity";
import type { RemoteMachine } from "../model/protocol";

const PROBE_DETAIL: Record<MachineProbe, string> = {
  connected: "Connected",
  provider: "Connected · install a supported provider on the host",
  update: "Connected · host update needed for Explorer and Changes",
  offline: "Offline · reconnect to check access",
};
const PROBE_LABEL: Record<MachineProbe, string> = {
  connected: "Connected",
  provider: "Provider needed",
  update: "Update needed",
  offline: "Offline",
};
const PROBE_TONE: Record<MachineProbe, BadgeTone> = {
  connected: "success",
  provider: "warning",
  update: "warning",
  offline: "warning",
};

/** A machine's connection state. Until this page's own check returns, it shows
 * what the rest of the app (the project rail) last learned about the machine,
 * so the two never disagree. */
function useMachineConnection(environmentId: string, probed?: MachineProbe) {
  const shared = useSyncExternalStore(
    subscribeChanges,
    () => readRemoteConnection(environmentId),
    () => readRemoteConnection(environmentId),
  );
  const indicator = connectionIndicator(shared, false);
  const kind: MachineProbe | undefined =
    indicator.tone === "down"
      ? "offline"
      : (probed ?? (indicator.tone === "connected" ? "connected" : undefined));
  return {
    label: kind ? PROBE_LABEL[kind] : "Checking connection…",
    tone: (kind ? PROBE_TONE[kind] : "neutral") as BadgeTone,
    detail: kind && kind !== "connected" ? t(PROBE_DETAIL[kind]) : undefined,
  };
}

export function MachineRow({
  machine,
  machines,
  probed,
  needsUpdate,
  showDetails,
  editing,
  busy,
  revoking,
  menuOpen,
  onUpdateHost,
  onReconnect,
  onToggleMenu,
  onSyncNow,
}: {
  machine: RemoteMachine;
  machines: RemoteMachine[];
  probed?: MachineProbe;
  needsUpdate: boolean;
  /** The connection details are shown: asked for in the row menu, offline, or an update is needed. */
  showDetails: boolean;
  editing: boolean;
  busy: boolean;
  revoking: boolean;
  menuOpen: boolean;
  onUpdateHost: () => void;
  onReconnect: () => void;
  onToggleMenu: (anchor: HTMLElement) => void;
  onSyncNow: () => void;
}) {
  const local = isLocalSyncMachine(machine);
  const context = machineContext(machines, machine);
  const connection = useMachineConnection(machine.environmentId, probed);
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
          {!local ? (
            <Text tone="muted" className="shrink-0">
              {machine.ssh ? t("SSH") : t("Host URL")}
            </Text>
          ) : null}
        </div>
        {connection.detail ? (
          <Text as="div" tone="muted">
            {connection.detail}
          </Text>
        ) : null}
        <ConnectionSyncLine machineId={machine.id} onSyncNow={onSyncNow} />
        {showDetails ? (
          <Text
            as="div"
            size="caption"
            tone="muted"
            leading="inherit"
            className="connection-details"
          >
            <MachineRoutesLine machine={machine} />
            <Text as="div" tone="muted" wrap="anywhere" className="mt-1">
              {local
                ? t("Syncs projects and groups with the {p0} on this computer", {
                    p0: PRODUCT_IDENTITY.displayName,
                  })
                : machine.ssh
                  ? t("SSH · {p0}{p1}", { p0: machine.ssh.target, p1: "" })
                  : machine.endpoint}
            </Text>
            {machine.ssh ? (
              <Text
                as="div"
                size="micro"
                tone="muted"
                className="mt-1 flex flex-wrap gap-x-3 gap-y-1"
              >
                <span>
                  {t("SSH port")}{" "}
                  <Code tone="primary">{machine.ssh.port ?? t("From SSH config")}</Code>
                </span>
                <span>
                  {t("Host port")} <Code tone="primary">{machine.ssh.remotePort}</Code>
                </span>
              </Text>
            ) : null}
          </Text>
        ) : null}
        {machine.ssh && needsUpdate ? (
          <Text as="div" size="micro" tone="muted" className="mt-1">
            {t("Updating restarts the host and interrupts active agent turns.")}
          </Text>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="dot" size="sm" tone={connection.tone}>
          {t(connection.label)}
        </Badge>
        {machine.ssh && needsUpdate ? (
          <Button
            stableWidth
            disabled={busy}
            tooltip={t(
              "Downloads the matching host package and restarts the host; active agent turns will be interrupted",
            )}
            onClick={onUpdateHost}
            variant="secondary"
            className="shrink-0"
            type="button"
          >
            {t("Update Host")}
          </Button>
        ) : machine.ssh && probed === "offline" ? (
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
