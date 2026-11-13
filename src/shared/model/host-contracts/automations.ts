import { z } from "zod";
import { SafeCounterSchema } from "./schemas";
import { ModelRoutingItemChoiceSchema, ModelRoutingTargetSchema } from "./model-routing";
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
  template: z
    .strictObject({ kind: z.literal("project-scan"), sourceStewardId: z.string() })
    .optional(),
  trigger: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("continuous"),
        minimumGapMinutes: SafeCounterSchema.min(1).max(10_080),
      }),
      z.strictObject({
        kind: z.literal("event"),
        event: z.enum(["task.finished", "task.blocked", "session.waiting", "automation.failed"]),
      }),
    ])
    .optional(),
  ...AutomationScheduleSchema.shape,
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  projectId: z.string(),
  harness: SessionProviderSchema,
  providerAccountId: z.string().min(1).max(200).optional(),
  modelChoice: ModelRoutingItemChoiceSchema.optional(),
  model: z.string(),
  modelSettings: ModelSettingsSchema.optional(),
  runtimeMode: SessionRuntimeModeSchema,
  maxRunMinutes: SafeCounterSchema.max(10_080).optional(),
  maxRunsPerDay: SafeCounterSchema.max(1_000).optional(),
  missedRunGraceMinutes: SafeCounterSchema.max(43_200).optional(),
  enabled: z.boolean().optional(),
  isolate: z.boolean().optional(),
};
export const NativeAutomationMigrationSchema = z.strictObject({
  automationId: z.string(),
  receipt: z.string().min(1).max(200),
  targetHostId: z.string(),
  snapshot: z.string().min(1).max(32_000_000),
  phase: z.enum(["prepared", "committed"]),
  hostAutomationId: z.string().optional(),
});
const metadata = {
  nativeMigrationState: z
    .strictObject({
      receipt: z.string(),
      fingerprint: z.string(),
      phase: z.enum(["prepared", "committed"]),
      sourceAutomationId: z.string(),
    })
    .optional(),
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
  expectedAbsent: z.boolean().optional(),
  nativeMigration: NativeAutomationMigrationSchema.optional(),
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
  execution: ModelRoutingTargetSchema.optional(),
  maxRunMinutes: SafeCounterSchema.max(10_080).optional(),
  cleanupPending: z.boolean().optional(),
  id: z.string(),
  automationId: z.string(),
  trigger: z.enum(["scheduled", "manual", "event"]),
  scheduledFor: SafeCounterSchema,
  createdAt: SafeCounterSchema,
  startedAt: SafeCounterSchema.optional(),
  completedAt: SafeCounterSchema.optional(),
  status: AutomationRunStatusSchema,
  nativeRunId: z.string().optional(),
  nativeSessionId: z.string().optional(),
  taskId: z.string().optional(),
  cancellationRequested: z.boolean().optional(),
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
/** Text-only preparation. These fields grant no execution or creation authority. */
export const AutomationProposalDraftSchema = z.strictObject({
  name: z.string().min(1).max(200),
  instruction: z.string().min(1).max(32_000),
  schedule: AutomationScheduleSchema.extend({
    time: z.string().min(5).max(5),
  }),
  timeZone: z.string().min(1).max(100),
  outputTarget: z.enum(["room", "projectTask"]),
});
export const AutomationsProposeParamsSchema = z.strictObject({
  operationId: z.string().min(1).max(200),
  request: z.string().min(1).max(32_000),
  projectId: z.string().min(1).max(200),
  currentExecution: z.strictObject({
    harness: SessionProviderSchema,
    model: z.string().min(1).max(200),
    modelSettings: ModelSettingsSchema,
  }),
});
export const AutomationsProposeResultSchema = AutomationProposalDraftSchema.extend({
  operationId: z.string(),
  projectId: z.string(),
  preview: AutomationsPreviewResultSchema,
  confirmationRequired: z.literal(true),
});
export type AutomationProposalDraft = z.infer<typeof AutomationProposalDraftSchema>;
export type AutomationProposal = z.infer<typeof AutomationsProposeResultSchema>;
export type AutomationProposalInput = z.infer<typeof AutomationsProposeParamsSchema>;
export const AutomationsDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });
export type HostAutomation = z.infer<typeof HostAutomationSchema>;
export type HostAutomationRun = z.infer<typeof HostAutomationRunSchema>;
export type AutomationPreview = z.infer<typeof AutomationsPreviewResultSchema>;
