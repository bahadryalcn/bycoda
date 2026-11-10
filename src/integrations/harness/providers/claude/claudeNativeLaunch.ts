import type { HarnessSessionInput } from "../../core/types";
import { nativeReadOnly } from "../../core/nativeToolLimits";
import { runtimeModeToPermission } from "./claudeProtocol";
import type { ClaudeNativeLimits } from "./claudeToolLimits";

/**
 * Permission mode and tool limits of one Claude launch. A crew read-only member loses file
 * edits and shell and never runs above `default`, whatever the run's mode.
 */
export function claudeNativeLaunch(
  input: Pick<HarnessSessionInput, "intent" | "runtimeMode" | "modelSettings" | "skillPolicy">,
): ClaudeNativeLimits & { permissionMode: ReturnType<typeof runtimeModeToPermission> } {
  const readOnly = nativeReadOnly(input.modelSettings);
  return {
    disabledSkills: input.skillPolicy?.disabledNames,
    ...(readOnly ? { nativeReadOnly: true } : {}),
    permissionMode:
      input.intent === "plan"
        ? "plan"
        : readOnly
          ? "default"
          : runtimeModeToPermission(input.runtimeMode),
  };
}
