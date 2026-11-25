import { useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Laptop, Plus, Server } from "../../../shared/ui/icons";
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

/**
 * Where a draft session runs. `projectMachines` lists the environment ids that
 * already hold a copy of the session's project, with `""` for this computer;
 * when given, those machines come first and the others read "Add to <machine>"
 * (selecting one still calls `onSelect`). Omit it for sessions without a project.
 */
export function SessionMachinePicker({
  environmentId,
  projectMachines,
  onSelect,
  disabled,
  label,
}: {
  environmentId?: string;
  projectMachines?: readonly string[];
  onSelect?: (environmentId: string | undefined) => void;
  disabled?: boolean;
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
            : undefined;
    return {
      value: id,
      label: statusLabel ? `${name} · ${statusLabel}` : name,
      icon: <Server className="icon-xs" aria-hidden="true" />,
      disabled: unavailable,
    };
  };
  const remoteChoices = remoteMachines.map((machine, index) =>
    remoteChoice(
      machine.environmentId,
      machineLabel(remoteMachines, machine),
      statuses[index] ?? "connecting",
    ),
  );
  const all = [local, ...remoteChoices];
  const options = (() => {
    if (!projectMachines) return all;
    const holds = (choice: SelectChoice) => projectMachines.includes(choice.value);
    const add = (choice: SelectChoice): SelectChoice => ({
      ...choice,
      label: t("Add to {p0}", { p0: choice.value ? choice.label : t("this computer") }),
      icon: <Plus className="icon-xs" aria-hidden="true" />,
    });
    return [...all.filter(holds), ...all.filter((choice) => !holds(choice)).map(add)];
  })();
  const value = selectedEnvironmentId ?? local.value;
  let selected = all.find((option) => option.value === value);
  if (!selected) {
    selected = {
      ...remoteChoice(value, t("Remote computer"), loaded ? "missing" : "connecting"),
      disabled: true,
    };
    all.push(selected);
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
      label={label ?? t("Run on")}
      hideLabel
      fieldSize="sm"
      value={value}
      options={options}
      onValueChange={(next) => onSelect(next || undefined)}
    />
  );
}
