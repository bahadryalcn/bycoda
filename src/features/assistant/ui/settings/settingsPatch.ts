import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import type { AssistantNotificationTarget } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";

/**
 * Every profile field the Settings footer Save persists. Explicit on purpose: a field
 * missing here renders in the dialog but is silently not saved.
 */
export const SETTINGS_PROFILE_FIELDS = [
  "permissionLevel",
  "permissionProjectIds",
  "criticalExclusions",
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
  "keepAwakeWhileAway",
  "urgentNotificationRepeats",
  "urgentNotificationIntervalMinutes",
  "notificationTelegram",
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

/** Recheck only a newly chosen destination; an unavailable saved one is never silently retargeted. */
export async function validateTelegramNotificationTarget(
  draft: AssistantProfilePatch,
  saved: AssistantProfilePatch,
  readTargets: () => Promise<readonly AssistantNotificationTarget[] | undefined>,
): Promise<void> {
  const target = draft.notificationTelegram;
  if (
    !target ||
    (target.accountId === saved.notificationTelegram?.accountId &&
      target.conversationId === saved.notificationTelegram.conversationId)
  )
    return;
  const targets = await readTargets();
  if (
    !targets?.some(
      (row) => row.accountId === target.accountId && row.conversationId === target.conversationId,
    )
  )
    throw new Error(t("The selected Telegram conversation is no longer allowed. Choose it again."));
}
