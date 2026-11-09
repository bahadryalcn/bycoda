import { z } from "zod";
import { AutomationScheduleSchema } from "./automations";
import { SafeCounterSchema } from "./schemas";
import {
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "./session-commands";

// The existing owner retains ID/text/time semantics, defaults and scheduling.
// This is the finite wire inventory for its five actual RPCs.
export const StewardRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
export const StewardRunSchema = z.strictObject({
  workspaceId: z.string().optional(),
  activityId: z.string().optional(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  startedAt: SafeCounterSchema,
  worktreeCwd: z.string().optional(),
  branch: z.string().optional(),
  error: z.string().optional(),
});
export const HostStewardInputSchema = z.strictObject({
  ...AutomationScheduleSchema.shape,
  minute: AutomationScheduleSchema.shape.minute.optional(),
  dayOfWeek: AutomationScheduleSchema.shape.dayOfWeek.optional(),
  id: z.string(),
  projectId: z.string(),
  enabled: z.boolean().optional(),
  harness: SessionProviderSchema,
  model: z.string(),
  modelSettings: ModelSettingsSchema.optional(),
  runtimeMode: SessionRuntimeModeSchema,
  focus: z.string().optional(),
  maxProposals: SafeCounterSchema.min(1).max(10).optional(),
  maxOpen: SafeCounterSchema.min(1).max(30).optional(),
  autoStart: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  isolate: z.boolean().optional(),
});
export const StewardConfigurationSchema = HostStewardInputSchema.extend({
  deliveryApprovalRequired: z.boolean().optional(),
  nextRunAt: SafeCounterSchema.optional(),
  lastRunAt: SafeCounterSchema.optional(),
  lastRunStatus: StewardRunStatusSchema.optional(),
  lastRunError: z.string().optional(),
  lastSessionId: z.string().optional(),
  lastProposed: SafeCounterSchema.optional(),
  declined: z.array(z.string()).optional(),
  run: StewardRunSchema.optional(),
  createdAt: SafeCounterSchema.optional(),
  updatedAt: SafeCounterSchema.optional(),
});
// Mobile editors can submit a complete row and a complete expected snapshot.
// Runtime fields are declared here; the owner compares only parsed configuration.
export const StewardSavePayloadSchema = StewardConfigurationSchema.extend({
  expectedConfiguration: StewardConfigurationSchema.optional(),
});
export const HostStewardSchema = StewardConfigurationSchema.extend({
  minute: AutomationScheduleSchema.shape.minute,
  dayOfWeek: AutomationScheduleSchema.shape.dayOfWeek,
  enabled: z.boolean(),
  modelSettings: ModelSettingsSchema,
  focus: z.string(),
  maxProposals: SafeCounterSchema.min(1).max(10),
  maxOpen: SafeCounterSchema.min(1).max(30),
  autoStart: z.boolean(),
  declined: z.array(z.string()),
  nextRunAt: SafeCounterSchema,
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
});
export const StewardsEmptyParamsSchema = z.strictObject({});
export const StewardsIdParamsSchema = z.strictObject({ stewardId: z.string() });
export const StewardsSaveParamsSchema = z.strictObject({
  steward: StewardSavePayloadSchema,
});
export const StewardsDeclineParamsSchema = z.strictObject({
  taskId: z.string(),
});
export const StewardsListResultSchema = z.array(HostStewardSchema);
export const StewardsDeleteResultSchema = z.strictObject({
  deleted: z.literal(true),
});
export const StewardsDeclineResultSchema = z.strictObject({
  declined: z.literal(true),
});

export type HostSteward = z.infer<typeof HostStewardSchema>;
export type StewardRun = z.infer<typeof StewardRunSchema>;
export type StewardSavePayload = z.infer<typeof StewardSavePayloadSchema>;
