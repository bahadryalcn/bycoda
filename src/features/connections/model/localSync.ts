import type { RemoteMachine } from "./protocol";

/** Must match the name the Rust `local_host_connect` command saves. */
export const LOCAL_SYNC_MACHINE_NAME = "This computer (local sync)";

/** The machine this desktop links to automatically for local project and
 * group sync; it is the desktop's own host, not a remote one. */
export function isLocalSyncMachine(machine: RemoteMachine): boolean {
  if ((!machine.localHost && machine.name !== LOCAL_SYNC_MACHINE_NAME) || machine.ssh) return false;
  try {
    const url = new URL(machine.endpoint);
    return (
      url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/** Machines that can host a remote project; the local sync link cannot. */
export function remoteProjectMachines(machines: RemoteMachine[]): RemoteMachine[] {
  return machines.filter((machine) => !isLocalSyncMachine(machine));
}
