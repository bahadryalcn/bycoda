import type { AssistantProfilePatch } from "../../../shared/model/host-contracts/assistant";

/** One answer to "how freely may the assistant work?". Each preset sets the five job controls
 * together; any other combination is "custom" and keeps the owner's individual choices. */
export type AssistantWorkPreset = "watch" | "ask" | "free";

type PresetValues = Required<
  Pick<AssistantProfilePatch, "autonomy" | "planApproval" | "confirmJobs" | "allowRoutineQuestions">
> & { runtimeMode: "supervised" | "full-access" };

export const ASSISTANT_WORK_PRESETS: Record<AssistantWorkPreset, PresetValues> = {
  watch: {
    autonomy: "report",
    planApproval: "always",
    confirmJobs: true,
    allowRoutineQuestions: false,
    runtimeMode: "supervised",
  },
  ask: {
    autonomy: "chief",
    planApproval: "large",
    confirmJobs: true,
    allowRoutineQuestions: true,
    runtimeMode: "supervised",
  },
  free: {
    autonomy: "chief",
    planApproval: "never",
    confirmJobs: false,
    allowRoutineQuestions: true,
    runtimeMode: "full-access",
  },
};

/** English i18n keys: label and one-line description per preset. */
export const ASSISTANT_WORK_PRESET_TEXT: Record<
  AssistantWorkPreset,
  { label: string; description: string }
> = {
  watch: {
    label: "Only watch",
    description: "Talks with you and reports what happens. Starts no jobs.",
  },
  ask: {
    label: "Work and ask",
    description: "Runs jobs you assign. Asks before commands, file changes and big plans.",
  },
  free: {
    label: "Work freely",
    description: "Runs jobs without asking. Commands and file changes run without confirmation.",
  },
};

/** The preset the profile matches exactly, or "custom". A profile without a worker model
 * matches by its job controls alone, since there is no permission to compare. */
export function assistantWorkPreset(value: AssistantProfilePatch): AssistantWorkPreset | "custom" {
  for (const [name, preset] of Object.entries(ASSISTANT_WORK_PRESETS) as [
    AssistantWorkPreset,
    PresetValues,
  ][]) {
    if (
      value.autonomy === preset.autonomy &&
      (value.planApproval ?? "large") === preset.planApproval &&
      (value.confirmJobs ?? false) === preset.confirmJobs &&
      (value.allowRoutineQuestions ?? false) === preset.allowRoutineQuestions &&
      (!value.execution || value.execution.runtimeMode === preset.runtimeMode)
    )
      return name;
  }
  return "custom";
}

/** The profile patch a preset applies. The worker model is kept; only its permission changes.
 * A job preset without a worker model leaves `execution` for the caller to fill. */
export function applyAssistantWorkPreset(
  value: AssistantProfilePatch,
  name: AssistantWorkPreset,
): AssistantProfilePatch {
  const { runtimeMode, ...jobs } = ASSISTANT_WORK_PRESETS[name];
  return {
    ...jobs,
    ...(value.execution ? { execution: { ...value.execution, runtimeMode } } : {}),
  };
}
