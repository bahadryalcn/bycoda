import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";

/**
 * Every profile field the Settings footer Save persists. Explicit on purpose: a field
 * missing here renders in the dialog but is silently not saved.
 */
export const SETTINGS_PROFILE_FIELDS = [
  "execution",
  "chiefExecution",
  "replyExecution",
  "planningExecution",
  "allowRoutineQuestions",
  "confirmJobs",
  "name",
  "showTitle",
  "avatar",
  "addressAs",
  "addressFrequency",
  "language",
  "tone",
  "allowProfanity",
  "persona",
  "autonomy",
  "planApproval",
  "dailyTokenBudget",
  "perWakeTokenCap",
  "proactiveSpeech",
  "voiceNarration",
  "keepAwakeWhileWorking",
  "quietStart",
  "quietEnd",
  "chiefSoftContext",
  "chiefHardContext",
  "workerSoftContext",
  "workerHardContext",
  "workerCompactPercent",
  "workerHandoffPercent",
  "stallMinutes",
  "idleMinutes",
  "awayMinutes",
  "chiefWakeLimit",
  "nudgeLimit",
  "activeStart",
  "activeEnd",
  "notificationPresent",
  "notificationAway",
  "notificationDnd",
  "summaryRefreshMessages",
  "observationTaskDone",
  "observationTaskNeedsInput",
] as const satisfies readonly (keyof AssistantProfilePatch)[];

/** The profile patch for one Save, drawn only from the whitelist above. */
export function settingsProfilePatch(draft: AssistantProfilePatch): AssistantProfilePatch {
  const patch: Record<string, unknown> = {};
  for (const key of SETTINGS_PROFILE_FIELDS) patch[key] = draft[key];
  return patch as AssistantProfilePatch;
}
