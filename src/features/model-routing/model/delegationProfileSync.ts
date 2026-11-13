import { invoke } from "@tauri-apps/api/core";
import {
  HOST_MODEL_ROUTING,
  ModelRoutingGetResultSchema,
  type ModelRoutingState,
} from "../../../shared/model/host-contracts/model-routing";
import { machineCapabilities } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections/public/protocol";
import { remoteRequest } from "../../connections/public/connections";
import { refreshRendererDelegation } from "./delegationProfileStorage";

/** Refresh the composer copy from authoritative Host layers. */
export async function syncDelegationProfile(state: ModelRoutingState): Promise<ModelRoutingState> {
  refreshRendererDelegation(state.delegation);
  return state;
}

let started = false;
let lastState = "";
let running = false;
// shortcut: polls because the Host has no model-routing change event; Settings saves refresh
// the local copy at once. Upgrade to a Host change event when one exists.
const SYNC_INTERVAL_MS = 60_000;
/** Started by renderer entry points; refresh also runs while Settings is closed. */
export function startDelegationProfileSync(): void {
  if (started) return;
  started = true;
  let timer: number | undefined;
  const tick = async () => {
    if (running) return;
    running = true;
    window.clearTimeout(timer);
    try {
      const machines = await invoke<RemoteMachine[]>("remote_machines");
      const machine = machines?.find(isLocalSyncMachine);
      if (!machine || !(await machineCapabilities(machine)).includes(HOST_MODEL_ROUTING)) return;
      const state = ModelRoutingGetResultSchema.parse(
        await remoteRequest(machine.id, "modelRouting.get", {}),
      ).state;
      const identity = JSON.stringify([machine.id, state]);
      if (identity === lastState) return;
      refreshRendererDelegation(state.delegation);
      lastState = identity;
    } catch {
      // Keep renderer defaults and retry after transient Host/storage failures.
    } finally {
      running = false;
      timer = window.setTimeout(() => {
        void tick();
      }, SYNC_INTERVAL_MS);
    }
  };
  window.addEventListener("focus", () => {
    void tick();
  });
  void tick();
}
