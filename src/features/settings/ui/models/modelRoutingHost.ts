import { useQuery } from "@tanstack/react-query";
import { machineCapabilities } from "../../../automations/public/hostMachines";
import type { RemoteMachine } from "../../../connections/public/protocol";
import {
  isHostAuthorizationRefusal,
  presentRemoteError,
} from "../../../connections/public/remoteFailure";
import { HOST_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

/** Whether `machine` advertises model routing; a failed probe throws, it never reads as "no". */
export async function loadModelRoutingHost(machine: RemoteMachine) {
  const capabilities = await machineCapabilities(machine);
  return { machineId: machine.id, supported: capabilities.includes(HOST_MODEL_ROUTING) };
}

/** The capability probe of one Host; `error` is the single reason it could not be read. */
export function useModelRoutingHost(machine: RemoteMachine | undefined) {
  const query = useQuery({
    queryKey: ["settings", "model-routing-host", machine?.id],
    queryFn: () => loadModelRoutingHost(machine!),
    enabled: !!machine,
    retry: false,
  });
  return {
    data: query.data,
    pending: !!machine && query.isPending,
    error: query.error ? presentRemoteError(query.error, { explicit: true }) : undefined,
    /** The Host refused this computer's credential; reconnecting is the owner's choice. */
    revoked: query.error ? isHostAuthorizationRefusal(query.error) : false,
    retry: () => {
      void query.refetch();
    },
  };
}
