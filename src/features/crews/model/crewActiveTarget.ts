import {
  backgroundMachines,
  hostProjectCwd,
  machineProjects,
} from "../../automations/public/hostMachines";
import { HOST_CREW_ACTIVE } from "./crew";
import type { ActiveCrewMemberView } from "./crewActive";

/** What the host needs to open a member's session. */
export type ActiveSessionTarget = {
  machineId: string;
  cwd: string;
  projectId: string;
  sessionId: string;
};

/** The project the caller already addresses; its cwd is known without asking the host. */
export type KnownCrewProject = { machineId: string; projectId: string; cwd: string };

/**
 * Where the member's session opens. Another project's cwd comes from its host's project list;
 * throws when the host no longer has the session or the project.
 */
export async function activeSessionTarget(
  item: Pick<ActiveCrewMemberView, "machineId" | "projectId" | "sessionId">,
  known?: KnownCrewProject,
): Promise<ActiveSessionTarget> {
  if (!item.sessionId) throw new Error("This member has no session yet.");
  const base = { machineId: item.machineId, projectId: item.projectId, sessionId: item.sessionId };
  if (known && known.machineId === item.machineId && known.projectId === item.projectId)
    return { ...base, cwd: known.cwd };
  const machine = (await backgroundMachines(HOST_CREW_ACTIVE)).find(
    (entry) => entry.id === item.machineId,
  );
  const project = machine
    ? (await machineProjects(machine)).find((entry) => entry.id === item.projectId)
    : undefined;
  if (!machine || !project) throw new Error("This project is no longer available.");
  return { ...base, cwd: hostProjectCwd(machine, project) };
}
