import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
  ModelRoutingStatusResultSchema,
  type ModelRoutingEntry,
  type ModelRoutingEntryStatus,
} from "../../../shared/model/host-contracts/model-routing";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { remoteRequest } from "../../connections/public/connections";

export type LocalModelOrder = { entries: ModelRoutingEntry[]; statuses: ModelRoutingEntryStatus[] };

/** The local Host's main model order with each entry's live quota. Undefined when the Host has
 * no routing or does not answer in time. Never rejects. */
export async function loadLocalModelOrder(): Promise<LocalModelOrder | undefined> {
  try {
    return await withTimeout(
      (async () => {
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        const local = machines.find(isLocalSyncMachine);
        if (!local || !(await machineCapabilities(local)).includes(HOST_MODEL_ROUTING)) return;
        const [state, status] = await Promise.all([
          remoteRequest(local.id, "modelRouting.get", {}),
          remoteRequest(local.id, "modelRouting.status", {}),
        ]);
        return {
          entries: ModelRoutingGetResultSchema.parse(state).state.entries,
          statuses: ModelRoutingStatusResultSchema.parse(status).entries,
        };
      })(),
      10_000,
      "Local model order",
    );
  } catch {
    return;
  }
}
