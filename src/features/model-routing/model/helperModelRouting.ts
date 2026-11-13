import { invoke } from "@tauri-apps/api/core";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
  type ModelRoutingRole,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { remoteMachineFor } from "../../connections/public/connections";
import { remoteRequest } from "../../connections/public/connections";
import { resolveModelRouting } from "./modelRoutingClient";

export type HelperModelRole = Extract<ModelRoutingRole, `text.${string}`>;
/** One short deadline covers discovery and resolution. Never rejects. */
export async function resolveHelperModel(
  role: HelperModelRole,
  options: { machineId?: string; cwd?: string } = {},
): Promise<ModelRoutingTarget | undefined> {
  try {
    return await withTimeout(
      (async () => {
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        const remote = options.cwd ? parseRemotePath(options.cwd) : undefined;
        const remoteMachine = remote ? await remoteMachineFor(remote.environmentId) : undefined;
        if (remote && !remoteMachine) return;
        const machineId = options.machineId ?? remoteMachine?.id;
        const machine = machineId
          ? machines.find((item) => item.id === machineId)
          : machines.find(isLocalSyncMachine);
        if (!machine || !(await machineCapabilities(machine)).includes(HOST_MODEL_ROUTING)) return;
        const state = ModelRoutingGetResultSchema.parse(
          await remoteRequest(machine.id, "modelRouting.get", {}),
        ).state;
        if (!state.roles[role]) return;
        const result = await resolveModelRouting(machine.id, { role });
        return result.ok ? result.target : undefined;
      })(),
      500,
      "Helper model routing",
    );
  } catch {
    return;
  }
}
