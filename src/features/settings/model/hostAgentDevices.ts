import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";

async function localHost(): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error("bycoda Host on this computer is not running.");
  return machine;
}

function agentDevices(value: unknown): boolean {
  const flag = (value as { agentDevices?: unknown } | null)?.agentDevices;
  // An older Host does not report the switch.
  if (typeof flag !== "boolean") throw new Error("This Host does not support this setting yet.");
  return flag;
}

/** Whether agents on this computer's Host may use device tools. */
export async function loadHostAgentDevices(): Promise<boolean> {
  const machine = await localHost();
  return agentDevices(await remoteRequest<unknown>(machine.id, "host.settings.get"));
}

/** Stores the switch on this computer's Host; resolves with the value the Host now holds. */
export async function saveHostAgentDevices(enabled: boolean): Promise<boolean> {
  const machine = await localHost();
  return agentDevices(
    await remoteRequest<unknown>(machine.id, "host.settings.save", {
      agentDevices: enabled,
    }),
  );
}
