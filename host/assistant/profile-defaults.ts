import type { AssistantProfile } from "../../src/shared/model/host-contracts/assistant";
import { DEFAULT_WORKER_CONTEXT_SETTINGS } from "../../src/shared/model/assistantContext";
import { DEFAULT_ASSISTANT_POLICY } from "../../src/shared/model/assistantPolicy";

/** Profile values used until the owner saves a profile. */
export const assistantProfileDefaults: AssistantProfile = {
  name: "",
  showTitle: true,
  avatar: "",
  addressAs: "",
  language: "auto",
  autonomy: "report",
  allowRoutineQuestions: false,
  planApproval: "large",
  dailyTokenBudget: 0,
  perWakeTokenCap: 8000,
  enabled: false,
  keepAwakeWhileWorking: false,
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
