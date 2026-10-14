import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import { runMachineCommand } from "../../connections/model/remoteCommands";

/** A connected machine's skills: its personal ones, plus those of `projectCwd`
 * (a `remote://` project path on that machine) when given. The paths come
 * back as `remote://` paths. */
export async function listMachineSkills(
  environmentId: string,
  projectCwd = "",
): Promise<DiscoveredSkill[]> {
  const skills = await runMachineCommand(environmentId, "list_skills", {
    cwd: projectCwd,
  });
  return Array.isArray(skills) ? (skills as DiscoveredSkill[]) : [];
}
