import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { machineCapabilities } from "../../automations/public/hostMachines";
import type { RemoteMachine } from "../../connections/public/protocol";
import { ModelChoiceField } from "../../model-routing/public/choice";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import {
  HOST_MODEL_ROUTING,
  type ModelRoutingItemChoice,
  type ModelRoutingRole,
} from "../../../shared/model/host-contracts/model-routing";

/** Initialize a fresh draft from the selected Host's routing capability. */
export function useTaskModelRouting(
  machine: RemoteMachine | undefined,
  newItem: boolean,
  value: ModelRoutingItemChoice | undefined,
) {
  const capability = useQuery({
    queryKey: [
      "task-model-routing-capability",
      machine?.id,
      machine?.endpoint,
      machine?.environmentId,
    ],
    enabled: !!machine,
    queryFn: () => machineCapabilities(machine!),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const supported = !!machine && capability.data?.includes(HOST_MODEL_ROUTING) === true;
  // Fresh drafts follow the role; persisted legacy rows and owner choices remain fixed.
  const choice = newItem && supported && value === undefined ? { kind: "default" as const } : value;
  return { supported, choice };
}

/** Per-item routing with the existing picker retained for fixed and legacy Hosts. */
export function TaskModelChoiceField({
  machine,
  routingRole,
  value,
  onChange,
  supported,
  fixed,
  fixedLabel,
  disabled,
}: {
  machine?: RemoteMachine;
  routingRole: ModelRoutingRole;
  value?: ModelRoutingItemChoice;
  onChange: (choice: ModelRoutingItemChoice) => void;
  supported: boolean;
  fixed: ReactNode;
  /** Supplying the fixed identity opts into the compact model-routing chip. */
  fixedLabel?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <ModelChoiceField
      routingRole={routingRole}
      machineId={machine?.id}
      supported={supported}
      value={value}
      onChange={onChange}
      allowDefault
      fixed={fixed}
      disabled={disabled}
      {...(fixedLabel === undefined ? {} : { presentation: "chip" as const, fixedLabel })}
      onManage={() => openModelsSettings("roles")}
    />
  );
}
