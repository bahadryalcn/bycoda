import { useSyncExternalStore, type Ref } from "react";
import { useT } from "../../../shared/i18n";
import { Laptop, Server } from "../../../shared/ui/icons";
import { Select, type SelectChoice } from "../../../shared/ui/Select";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useRemoteMachines } from "../model/connections";
import { isLocalSyncMachine, remoteProjectMachines } from "../model/localSync";
import { isMachineEnabled, subscribeDisabledMachines } from "../model/machineEnabled";
import { machineLabel } from "../model/machineIdentity";
import { blocksSending, type RemoteConnectionStatus } from "../model/remoteConnection";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";

type MachineStatus = RemoteConnectionStatus | "disabled" | "missing";

function subscribeMachineStatus(listener: () => void) {
  const stopHealth = subscribeChanges(listener);
  const stopDisabled = subscribeDisabledMachines(listener);
  return () => {
    stopHealth();
    stopDisabled();
  };
}

function machineStatus(environmentId: string): MachineStatus {
  if (!isMachineEnabled(environmentId)) return "disabled";
  return readRemoteConnection(environmentId).status;
}

export function SessionMachinePicker({
  environmentId,
  onSelect,
  disabled,
  triggerRef,
  label,
}: {
  environmentId?: string;
  onSelect?: (environmentId: string | undefined) => void;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  label?: string;
}) {
  const t = useT();
  const { machines, loaded } = useRemoteMachines();
  const remoteMachines = remoteProjectMachines(machines);
  const selectedEnvironmentId = machines.some(
    (machine) => machine.environmentId === environmentId && isLocalSyncMachine(machine),
  )
    ? undefined
    : environmentId;
  const readStatuses = () =>
    remoteMachines.map((machine) => machineStatus(machine.environmentId)).join(",");
  const statuses = useSyncExternalStore(subscribeMachineStatus, readStatuses, readStatuses).split(
    ",",
  ) as MachineStatus[];
  const local: SelectChoice = {
    value: "",
    label: t("This computer"),
    icon: <Laptop className="icon-xs" aria-hidden="true" />,
  };
  const remoteChoice = (id: string, name: string, status: MachineStatus): SelectChoice => {
    const unavailable = status === "disabled" || status === "missing" || blocksSending(status);
    const statusLabel =
      status === "disabled"
        ? t("Disabled")
        : unavailable
          ? t("Offline")
          : status === "connecting"
            ? t("Connecting")
            : t("Connected");
    return {
      value: id,
      label: `${name} · ${statusLabel}`,
      icon: <Server className="icon-xs" aria-hidden="true" />,
      disabled: unavailable,
    };
  };
  const options = [
    local,
    ...remoteMachines.map((machine, index) =>
      remoteChoice(
        machine.environmentId,
        machineLabel(remoteMachines, machine),
        statuses[index] ?? "connecting",
      ),
    ),
  ];
  const value = selectedEnvironmentId ?? local.value;
  let selected = options.find((option) => option.value === value);
  if (!selected) {
    selected = {
      ...remoteChoice(value, t("Remote computer"), loaded ? "missing" : "connecting"),
      disabled: true,
    };
    options.push(selected);
  }

  if (disabled || !onSelect) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {selected.icon}
        <OverflowTooltip label={selected.label}>
          <Text truncate>{selected.label}</Text>
        </OverflowTooltip>
      </span>
    );
  }

  return (
    <Select
      ref={triggerRef}
      label={label ?? t("Run on")}
      hideLabel
      fieldSize="sm"
      value={value}
      options={options}
      onValueChange={(next) => onSelect(next || undefined)}
    />
  );
}
