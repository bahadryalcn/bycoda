import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/model/connections";
import type { RemoteMachine } from "../../connections/model/protocol";
import { runMachineCommand } from "../../connections/model/remoteCommands";
import { parseRemotePath } from "../../connections/model/remoteProjects";
import { invalidateSkills, SKILLS_CHANGE_EVENT } from "./skills";

import type { SkillInstallRequest, SkillInstallResult } from "./skillInstallTypes";
export {
  SKILL_INSTALL_PROVIDERS,
  type SkillInstallProvider,
  type SkillInstallRequest,
  type SkillInstallResult,
} from "./skillInstallTypes";

async function installationRequest(
  command: "skill_catalog_install" | "skill_catalog_install_status",
  request: SkillInstallRequest,
  machineId?: string,
): Promise<SkillInstallResult> {
  const remote = parseRemotePath(request.cwd);
  if (machineId || remote)
    return (await runMachineCommand(
      machineId ?? remote!.environmentId,
      command,
      request,
    )) as SkillInstallResult;
  const machine = await invoke<RemoteMachine | null>("local_host_connect");
  if (!machine) throw new Error("This computer's bycoda Host is not connected.");
  return await remoteRequest<SkillInstallResult>(machine.id, "workspace.run", {
    command,
    args: request,
  });
}

/** Read the same operation after an uncertain response; never resend a download automatically. */
export async function recommendedSkillInstallStatus(
  request: SkillInstallRequest,
  machineId?: string,
) {
  return await installationRequest("skill_catalog_install_status", request, machineId);
}

export async function installRecommendedSkill(request: SkillInstallRequest, machineId?: string) {
  let result: SkillInstallResult;
  try {
    result = await installationRequest("skill_catalog_install", request, machineId);
  } catch {
    // Transport failure can occur after publication. A read resolves that ambiguity.
    try {
      result = await recommendedSkillInstallStatus(request, machineId);
    } catch {
      throw new Error(
        "Installation outcome is unknown. Check this installation before trying again.",
      );
    }
  }
  if (result.status === "installed") {
    invalidateSkills();
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
  }
  return result;
}
