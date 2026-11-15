import { invoke } from "@tauri-apps/api/core";
import { knownRemoteMachine } from "./connections";
import { invalidateConnection } from "./remoteLifecycle";

/** A machine was turned off: close its SSH tunnel and Host WebSocket now and detach in-flight
 * requests. The saved machine, credential, learned routes and cached sessions stay. */
export function closeTurnedOffMachine(
  environmentId: string,
  close: (machineId: string) => Promise<unknown> = (machineId) =>
    invoke("remote_close_connection", { machineId }),
): void {
  const machine = knownRemoteMachine(environmentId);
  if (!machine) return;
  invalidateConnection(environmentId);
  void Promise.resolve(close(machine.id)).catch(() => undefined);
}
