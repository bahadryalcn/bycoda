import type { AssistantProfile } from "../../src/shared/model/host-contracts/assistant";
import { DEFAULT_WORKER_CONTEXT_SETTINGS } from "../../src/shared/model/assistantContext";
import { DEFAULT_ASSISTANT_POLICY } from "../../src/shared/model/assistantPolicy";
import type { AssistantRepository } from "./repository";

/** Profile values used until the owner saves a profile. */
export const assistantProfileDefaults: AssistantProfile = {
  permissionLevel: undefined,
  permissionProjectIds: [],
  criticalExclusions: [
    "pushMain",
    "deleteProject",
    "deleteSession",
    "sendMessages",
    "computerUse",
    "spend",
  ],
  name: "",
  showTitle: true,
  avatar: "",
  addressAs: "",
  addressFrequency: "sometimes",
  tone: "friendly",
  allowProfanity: false,
  persona: "",
  confirmJobs: false,
  language: "auto",
  autonomy: "report",
  allowRoutineQuestions: false,
  planApproval: "large",
  dailyTokenBudget: 0,
  perWakeTokenCap: 8000,
  enabled: false,
  keepAwakeWhileWorking: false,
  keepAwakeWhileAway: true,
  urgentNotificationRepeats: 2,
  urgentNotificationIntervalMinutes: 30,
  notificationTelegram: null,
  setupComplete: false,
  voiceSetupComplete: false,
  voiceNarration: false,
  proactiveSpeech: "return",
  quietStart: 22,
  quietEnd: 8,
  chiefSoftContext: 150000,
  chiefHardContext: 250000,
  ...DEFAULT_WORKER_CONTEXT_SETTINGS,
  ...DEFAULT_ASSISTANT_POLICY,
  stallMinutes: 15,
  execution: null,
  chiefExecution: null,
  replyExecution: null,
  planningExecution: null,
  version: 0,
  updatedAt: 0,
};

/** The saved profile with defaults filled in for fields an older record lacks. */
export async function readAssistantProfile(
  repository: Pick<AssistantRepository, "get">,
): Promise<AssistantProfile> {
  const row = await repository.get<AssistantProfile>("profile", "profile");
  if (!row) return { ...assistantProfileDefaults };
  return Object.fromEntries(
    Object.keys(assistantProfileDefaults).map((key) => [
      key,
      row[key as keyof AssistantProfile] ?? assistantProfileDefaults[key as keyof AssistantProfile],
    ]),
  ) as AssistantProfile;
}
