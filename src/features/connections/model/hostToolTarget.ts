import { isLocalSyncMachine } from "./localSync";
import type { RemoteMachine } from "./protocol";
import { parseRemotePath } from "./remoteProjects";

export type HostToolTarget =
  | { kind: "project" }
  | { kind: "local" }
  | { kind: "machine"; machineId: string };

export function hostToolTargetKey(target: HostToolTarget): string {
  return target.kind === "machine" ? `machine:${target.machineId}` : target.kind;
}

/** A chooser never registers the conversation's directory on another host. */
export function targetIsProjectHost(
  cwd: string,
  target: HostToolTarget,
  machines: readonly RemoteMachine[],
): boolean {
  if (!cwd.trim()) return false;
  if (target.kind === "project") return true;
  const remote = parseRemotePath(cwd);
  if (target.kind === "local") return !remote && !cwd.startsWith("remote://");
  const machine = machines.find((entry) => entry.id === target.machineId);
  if (!machine) return false;
  return remote
    ? machine.environmentId === remote.environmentId
    : !cwd.startsWith("remote://") && isLocalSyncMachine(machine);
}

export const hostToolTargetOwnsProject = targetIsProjectHost;

/** Prefer the current local host over old saved local links and duplicate IDs. */
export function dedupeHostToolMachines(
  local: RemoteMachine | null,
  saved: readonly RemoteMachine[],
): RemoteMachine[] {
  const machines: RemoteMachine[] = [];
  const ids = new Set<string>();
  const environments = new Set<string>();
  for (const machine of [...(local ? [{ ...local, localHost: true }] : []), ...saved]) {
    if (local && machine.id !== local.id && isLocalSyncMachine(machine)) continue;
    if (ids.has(machine.id) || (machine.environmentId && environments.has(machine.environmentId)))
      continue;
    ids.add(machine.id);
    if (machine.environmentId) environments.add(machine.environmentId);
    machines.push(machine);
  }
  return machines;
}
