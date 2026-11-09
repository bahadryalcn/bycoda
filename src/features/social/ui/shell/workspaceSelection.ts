import { pathKey } from "../../../../shared/lib/paths";
import { isLocalSyncMachine } from "../../../connections/public/localSync";
import type { HostProject, RemoteMachine } from "../../../connections/public/protocol";

/** One workspace choice: a computer alone (all projects), or a computer plus one project. */
export type WorkspaceChoice = { machineId: string; projectId?: string };

/** Authority Host first, then the Host saved last time, then this computer, then the first Host. */
export function pickPreferredMachine(
  machines: RemoteMachine[],
  authorityId: string | undefined,
  saved: string | null,
): RemoteMachine | undefined {
  const wanted = authorityId ?? saved;
  return (
    (wanted ? machines.find((machine) => machine.id === wanted) : undefined) ??
    machines.find(isLocalSyncMachine) ??
    machines[0]
  );
}

/** The project whose folder is the surface's working directory, if the Host lists it. */
export function projectIdForCwd(projects: HostProject[], cwd: string): string | undefined {
  const key = pathKey(cwd);
  return projects.find((project) => pathKey(project.cwd) === key)?.id;
}

/** Select option value for a workspace choice. JSON keeps machine and project ids apart. */
export function workspaceValue(machineId: string, projectId?: string): string {
  return JSON.stringify([machineId, projectId ?? null]);
}

export function parseWorkspaceValue(value: string): WorkspaceChoice {
  const [machineId, projectId] = JSON.parse(value) as [string, string | null];
  return { machineId, projectId: projectId ?? undefined };
}
