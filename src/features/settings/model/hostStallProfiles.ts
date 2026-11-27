import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";

async function localHost(): Promise<RemoteMachine> {
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error("bycoda Host on this computer is not running.");
  return machine;
}

function stallProfiles(value: unknown): boolean {
  const flag = (value as { stallProfiles?: unknown } | null)?.stallProfiles;
  // An older Host does not report the switch.
  if (typeof flag !== "boolean") throw new Error("This Host does not support this setting yet.");
  return flag;
}

/** Whether this computer's Host saves a CPU profile when its event loop stalls repeatedly. */
export async function loadHostStallProfiles(): Promise<boolean> {
  const machine = await localHost();
  return stallProfiles(await remoteRequest<unknown>(machine.id, "host.settings.get"));
}

/** Stores the switch on this computer's Host; resolves with the value the Host now holds. */
export async function saveHostStallProfiles(enabled: boolean): Promise<boolean> {
  const machine = await localHost();
  return stallProfiles(
    await remoteRequest<unknown>(machine.id, "host.settings.save", { stallProfiles: enabled }),
  );
}
