import type { RemoteMachine } from "./protocol";

/** What a machine is reached by. A rename or any other display field is not part of it. */
export function machineRouteKey(machine: RemoteMachine): string {
  return JSON.stringify([
    machine.id,
    machine.environmentId,
    machine.endpoint,
    machine.localHost ?? false,
    machine.ssh ?? null,
  ]);
}

/** True when both lists reach the same machines the same way, whatever their order or names. */
export function sameMachineRoutes(a: readonly RemoteMachine[], b: readonly RemoteMachine[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(machineRouteKey));
  return b.every((machine) => keys.has(machineRouteKey(machine)));
}
