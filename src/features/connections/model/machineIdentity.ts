import type { RemoteMachine } from "./protocol";

type MachineIdentity = Pick<RemoteMachine, "id" | "name" | "endpoint" | "ssh">;

/**
 * Short address that tells same-named machines apart; empty when the name is already unique. Stored
 * machine names are never changed, so every surface that shows a Host name adds this hint instead.
 */
export function machineContext(
  machines: readonly MachineIdentity[],
  machine: MachineIdentity,
): string {
  const shared = machines.some((other) => other.id !== machine.id && other.name === machine.name);
  return shared ? (machine.ssh?.target ?? machine.endpoint) : "";
}

/** The machine name, with its address in parentheses when another machine shares the name. */
export function machineLabel(
  machines: readonly MachineIdentity[],
  machine: MachineIdentity,
): string {
  const context = machineContext(machines, machine);
  return context ? `${machine.name} (${context})` : machine.name;
}
