import { projectName } from "../../../shared/lib/paths";
import { hostProjectCwd } from "../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { HostProject, RemoteMachine } from "../../connections/public/protocol";

/** This computer first, then other machines by name: the running app is the default choice. */
export function orderCrewMachines(machines: readonly RemoteMachine[]): RemoteMachine[] {
  return [...machines].sort(
    (a, b) =>
      Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)) || a.name.localeCompare(b.name),
  );
}

/** The project a crew view on `machine` should use: the opened project on its own
 * machine, else the project with the same folder name there, else the first one. */
export function crewCwdOn(
  machine: RemoteMachine,
  projects: readonly HostProject[],
  cwd: string,
  homeMachineId: string | undefined,
): string | undefined {
  if (machine.id === homeMachineId) return cwd;
  const name = projectName(cwd).toLowerCase();
  const project =
    projects.find((entry) => projectName(entry.cwd).toLowerCase() === name) ?? projects[0];
  return project ? hostProjectCwd(machine, project) : undefined;
}
