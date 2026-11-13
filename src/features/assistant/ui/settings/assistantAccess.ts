import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import type { DesktopControlConfiguration } from "../../../../shared/model/host-contracts/desktop-control";
import { applyAssistantWorkPreset, assistantWorkPreset } from "../../model/assistantWorkPresets";

export type AssistantAccessChoice = "ask" | "full";
type ComputerAccess = Pick<
  DesktopControlConfiguration,
  "enabled" | "permissionMode" | "allowPhysicalInput"
>;

/** A label describes all three current drafts, never just the job permission. */
export function assistantAccessMode(
  profile: AssistantProfilePatch,
  computer: ComputerAccess | undefined,
  commands: boolean | undefined,
  changes = false,
): AssistantAccessChoice | "custom" | "loading" {
  if (!computer || commands === undefined) return "loading";
  if (!computer.enabled || !computer.allowPhysicalInput) return "custom";
  const work = assistantWorkPreset(profile);
  if (
    profile.execution &&
    work === "free" &&
    computer.permissionMode === "full" &&
    commands &&
    changes
  )
    return "full";
  if (
    profile.execution &&
    work === "ask" &&
    computer.permissionMode === "ask" &&
    !commands &&
    !changes
  )
    return "ask";
  return "custom";
}

/** Called only by an explicit owner choice; mounting settings never expands grants. */
export function assistantAccessPatch(
  profile: AssistantProfilePatch,
  choice: AssistantAccessChoice,
) {
  return applyAssistantWorkPreset(profile, choice === "full" ? "free" : "ask");
}
