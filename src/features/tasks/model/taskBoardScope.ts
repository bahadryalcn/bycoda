import { projectKey } from "../../../shared/lib/paths";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { BoardTask } from "./taskClient";

/** Host identities are authoritative. A path is only a bootstrap for an open tab. */
export type TaskProjectScope = {
  key: string;
  environmentId: string;
  projectId: string;
  machineId: string;
  machineName: string;
  cwd: string;
  name: string;
};

export function taskProjectIdentity(environmentId: string, projectId: string): string {
  return JSON.stringify([environmentId, projectId]);
}

export function taskMatchesProject(
  task: Pick<BoardTask, "machineId" | "projectId" | "cwd">,
  scope: string,
  machines: readonly RemoteMachine[],
): boolean {
  if (scope === "all") return true;
  if (scope.startsWith("path:")) return projectKey(task.cwd) === scope.slice(5);
  const machine = machines.find((entry) => entry.id === task.machineId);
  return Boolean(
    machine?.environmentId && taskProjectIdentity(machine.environmentId, task.projectId) === scope,
  );
}

export function initialTaskProjectScope(cwd?: string): string {
  return cwd ? `path:${projectKey(cwd)}` : "all";
}

export function scopeForOpenProject(cwd: string, projects: readonly TaskProjectScope[]): string {
  return (
    projects.find((project) => projectKey(project.cwd) === projectKey(cwd))?.key ??
    initialTaskProjectScope(cwd)
  );
}
