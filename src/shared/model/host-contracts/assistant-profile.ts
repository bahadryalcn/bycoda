import { z } from "zod";
import {
  SessionProviderSchema,
  SessionRuntimeModeSchema,
  ModelSettingsSchema,
} from "./session-commands";

/** Smallest daily budget the assistant accepts: below it even one supervisor review cannot run. */
export const ASSISTANT_MIN_DAILY_TOKEN_BUDGET = 20_000;

/** Assistant profile settings: the owner-editable patch and the execution profile it embeds. */
export const AssistantExecutionSchema = z.strictObject({
  harness: SessionProviderSchema,
  model: z.string().min(1).max(200),
  modelSettings: ModelSettingsSchema,
  runtimeMode: SessionRuntimeModeSchema,
  maxRunMinutes: z.number().int().min(1).max(10080),
});
export type AssistantExecution = z.infer<typeof AssistantExecutionSchema>;

export const AssistantProfilePatchSchema = z.strictObject({
  name: z.string().max(80).optional(),
  showTitle: z.boolean().optional(),
  avatar: z.string().max(200).optional(),
  addressAs: z.string().max(100).optional(),
  addressFrequency: z.enum(["always", "sometimes", "never"]).optional(),
  tone: z.enum(["friendly", "neutral", "formal", "casual", "blunt"]).optional(),
  allowProfanity: z.boolean().optional(),
  persona: z.string().max(2000).optional(),
  confirmJobs: z.boolean().optional(),
  language: z.string().max(40).optional(),
  autonomy: z.enum(["report", "jobs", "chief"]).optional(),
  allowRoutineQuestions: z.boolean().optional(),
  planApproval: z.enum(["always", "large", "never"]).optional(),
  dailyTokenBudget: z
    .number()
    .int()
    .min(ASSISTANT_MIN_DAILY_TOKEN_BUDGET)
    .max(1_000_000_000)
    .optional(),
  perWakeTokenCap: z.number().int().min(1000).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  keepAwakeWhileWorking: z.boolean().optional(),
  setupComplete: z.boolean().optional(),
  voiceSetupComplete: z.boolean().optional(),
  voiceNarration: z.boolean().optional(),
  proactiveSpeech: z.enum(["never", "return", "important"]).optional(),
  quietStart: z.number().int().min(0).max(23).optional(),
  quietEnd: z.number().int().min(0).max(23).optional(),
  chiefSoftContext: z.number().int().min(10000).max(1_000_000).optional(),
  chiefHardContext: z.number().int().min(20000).max(2_000_000).optional(),
  workerSoftContext: z.number().int().min(10000).max(1_000_000).optional(),
  workerHardContext: z.number().int().min(10000).max(1_000_000).optional(),
  workerCompactPercent: z.number().int().min(1).max(99).optional(),
  workerHandoffPercent: z.number().int().min(1).max(99).optional(),
  stallMinutes: z.number().int().min(5).max(1440).optional(),
  idleMinutes: z.number().int().min(1).max(1440).optional(),
  awayMinutes: z.number().int().min(2).max(10080).optional(),
  chiefWakeLimit: z.number().int().min(1).max(120).optional(),
  nudgeLimit: z.number().int().min(0).max(2).optional(),
  activeStart: z.number().int().min(0).max(23).optional(),
  activeEnd: z.number().int().min(0).max(23).optional(),
  notificationPresent: z.enum(["all", "urgent", "none"]).optional(),
  notificationAway: z.enum(["all", "urgent", "none"]).optional(),
  notificationDnd: z.literal("none").optional(),
  summaryRefreshMessages: z.number().int().min(10).max(200).optional(),
  observationTaskDone: z.boolean().optional(),
  observationTaskNeedsInput: z.boolean().optional(),
  execution: AssistantExecutionSchema.nullable().optional(),
  chiefExecution: AssistantExecutionSchema.nullable().optional(),
  replyExecution: AssistantExecutionSchema.nullable().optional(),
  planningExecution: AssistantExecutionSchema.nullable().optional(),
});
export type AssistantProfilePatch = z.infer<typeof AssistantProfilePatchSchema>;
