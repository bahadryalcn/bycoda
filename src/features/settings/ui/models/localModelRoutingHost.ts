import { invoke } from "@tauri-apps/api/core";
import { machineCapabilities } from "../../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../../connections/public/localSync";
import type { RemoteMachine } from "../../../connections/public/protocol";
import { HOST_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

/** Routing Settings always edit this computer's Host, even from a remote project. */
export async function loadLocalModelRoutingHost() {
  const machines = await invoke<RemoteMachine[]>("remote_machines");
  const machine = machines?.find(isLocalSyncMachine);
  if (!machine) return { machineId: undefined, supported: false };
  const capabilities = await machineCapabilities(machine);
  return { machineId: machine.id, supported: capabilities.includes(HOST_MODEL_ROUTING) };
}
