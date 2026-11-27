import {
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Laptop, Plus, Server } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useRemoteMachines } from "../model/connections";
import { isLocalSyncMachine, remoteProjectMachines } from "../model/localSync";
import { isMachineEnabled, subscribeDisabledMachines } from "../model/machineEnabled";
import { machineLabel } from "../model/machineIdentity";
import { blocksSending, type RemoteConnectionStatus } from "../model/remoteConnection";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";

type MachineChoice = { value: string; label: string; icon: ReactNode; disabled?: boolean };

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
  triggerRef,
  returnFocusRef,
  label,
}: {
  environmentId?: string;
  projectMachines?: readonly string[];
  onSelect?: (environmentId: string | undefined) => void;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerRef, () => buttonRef.current!);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
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
  const local: MachineChoice = {
    value: "",
    label: t("This computer"),
    icon: <Laptop className="icon-xs" aria-hidden="true" />,
  };
  const remoteChoice = (id: string, name: string, status: MachineStatus): MachineChoice => {
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
    const holds = (choice: MachineChoice) => projectMachines.includes(choice.value);
    const add = (choice: MachineChoice): MachineChoice => ({
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

  const menuLabel = label ?? t("Run on");
  return (
    <>
      <Button
        ref={(node) => {
          buttonRef.current = node;
          setAnchor(node);
        }}
        type="button"
        variant="chip"
        data-composer-chip="machine"
        aria-label={`${menuLabel}: ${selected.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        startIcon={selected.icon}
        // Pointer presses must not move focus to the chip: no lingering focus frame (keyboard focus still shows the cue).
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        className="min-w-0 max-w-52"
      >
        <Text truncate tone="inherit">
          {selected.label}
        </Text>
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={menuLabel}
          side="top"
          align="start"
          size="sm"
          returnFocusRef={returnFocusRef}
          items={options.map((option) => ({
            kind: "item" as const,
            id: option.value,
            label: option.label,
            icon: option.icon,
            disabled: option.disabled,
            checked: option.value === value,
            selectionRole: "radio" as const,
          }))}
          onPick={(next) => onSelect(next || undefined)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
