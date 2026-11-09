import { z } from "zod";
import { SafeCounterSchema } from "./schemas";
import {
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "./session-commands";

// Schedule arithmetic, text limits and local timezone semantics stay with the
// existing automation parser/scheduler. These are the paired Host's six RPCs.
export const AutomationScheduleSchema = z.strictObject({
  scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly"]),
  minute: SafeCounterSchema.max(59),
  time: z.string(),
  dayOfWeek: SafeCounterSchema.max(6),
});
export const AutomationRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
const editable = {
  ...AutomationScheduleSchema.shape,
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  projectId: z.string(),
  harness: SessionProviderSchema,
  model: z.string(),
  modelSettings: ModelSettingsSchema.optional(),
  runtimeMode: SessionRuntimeModeSchema,
  maxRunMinutes: SafeCounterSchema.max(10_080).optional(),
  maxRunsPerDay: SafeCounterSchema.max(1_000).optional(),
  enabled: z.boolean().optional(),
  isolate: z.boolean().optional(),
};
const metadata = {
  nextRunAt: SafeCounterSchema.optional(),
  lastRunAt: SafeCounterSchema.optional(),
  lastRunStatus: AutomationRunStatusSchema.optional(),
  lastRunError: z.string().optional(),
  lastSessionId: z.string().optional(),
  needsInput: z.boolean().optional(),
  createdAt: SafeCounterSchema.optional(),
  updatedAt: SafeCounterSchema.optional(),
};
// Existing callers may resubmit a complete row; the owner ignores runtime fields
// and compares only parsed editable fields for expectedConfiguration CAS.
export const AutomationConfigurationSchema = z.strictObject({ ...editable, ...metadata });
export const AutomationSavePayloadSchema = AutomationConfigurationSchema.extend({
  expectedConfiguration: AutomationConfigurationSchema.optional(),
});
export const HostAutomationSchema = AutomationConfigurationSchema.extend({
  modelSettings: ModelSettingsSchema,
  maxRunMinutes: SafeCounterSchema.max(10_080),
  maxRunsPerDay: SafeCounterSchema.max(1_000),
  enabled: z.boolean(),
  nextRunAt: SafeCounterSchema,
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
});
export const HostAutomationRunSchema = z.strictObject({
  cleanupPending: z.boolean().optional(),
  id: z.string(),
  automationId: z.string(),
  trigger: z.enum(["scheduled", "manual"]),
  scheduledFor: SafeCounterSchema,
  createdAt: SafeCounterSchema,
  startedAt: SafeCounterSchema.optional(),
  completedAt: SafeCounterSchema.optional(),
  status: AutomationRunStatusSchema,
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  error: z.string().optional(),
  needsInput: z.boolean().optional(),
  workspaceId: z.string().optional(),
  activityId: z.string().optional(),
});
export const AutomationsEmptyParamsSchema = z.strictObject({});
export const AutomationsPreviewParamsSchema = z.strictObject({
  schedule: AutomationScheduleSchema,
});
export const AutomationsSaveParamsSchema = z.strictObject({
  automation: AutomationSavePayloadSchema,
});
export const AutomationsIdParamsSchema = z.strictObject({ automationId: z.string() });
export const AutomationsPreviewResultSchema = z.strictObject({
  timeZone: z.string(),
  nextRunAt: SafeCounterSchema,
});
export const AutomationsDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });
export type HostAutomation = z.infer<typeof HostAutomationSchema>;
export type HostAutomationRun = z.infer<typeof HostAutomationRunSchema>;
export type AutomationPreview = z.infer<typeof AutomationsPreviewResultSchema>;
