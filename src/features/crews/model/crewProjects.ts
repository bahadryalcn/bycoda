import { t } from "../../../shared/i18n/core";
import { parentPath } from "../../../shared/lib/paths";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import type { HostDirectory, HostProject } from "../../connections/public/protocol";

/** The folder a new crew project is created in: next to the project the crew view is on. */
export function newCrewProjectParent(cwd: string): string {
  return parentPath(parseRemotePath(cwd)?.hostPath ?? cwd);
}

/** Why `name` cannot be a new project folder, or "" when it can. The Host validates again. */
export function crewProjectNameIssue(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return t("Name the project folder.");
  if (trimmed === "." || trimmed === ".." || /[\\/:*?"<>|]/.test(trimmed))
    return t("Use a folder name without slashes or special characters.");
  return "";
}

type Request = (machineId: string, method: string, params: unknown) => Promise<unknown>;

/** Creates the folder on the machine and registers it there as a project. */
export async function createCrewProject(
  request: Request,
  machineId: string,
  parent: string,
  name: string,
): Promise<HostProject> {
  const issue = crewProjectNameIssue(name);
  if (issue) throw new Error(issue);
  const folder = (await request(machineId, "projects.createDirectory", {
    path: parent,
    name: name.trim(),
  })) as HostDirectory;
  return (await request(machineId, "projects.open", { cwd: folder.path })) as HostProject;
}
