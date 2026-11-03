import { z } from "zod";
import { SafeCounterSchema } from "./schemas";
import { SessionProviderSchema, SessionRuntimeModeSchema } from "./session-commands";
import {
  GoalBudgetSchema,
  GoalBudgetUsageSchema,
  GoalWorkspaceSchema,
  GoalAcceptanceReportSchema,
} from "./goals";
export const TaskStatusSchema = z.enum([
  "todo",
  "queued",
  "running",
  "verifying",
  "review",
  "done",
  "blocked",
]);
/** Structural inventory only; storage owns semantic validation, defaults and authority. */
export const TaskBudgetSchema = GoalBudgetSchema;
export const TaskBudgetUsageSchema = GoalBudgetUsageSchema;
export const TaskWorkspaceSchema = GoalWorkspaceSchema;
export const TaskAcceptanceReportSchema = GoalAcceptanceReportSchema;
export const TaskPreflightRequirementSchema = z.strictObject({
  kind: z.enum(["source", "skill", "connection", "tool"]),
  id: z.string(),
  required: z.boolean().optional(),
});
const readiness = z.enum(["ready", "blocked", "unknown"]);
export const TaskPreflightResultSchema = z.strictObject({
  checkedAt: SafeCounterSchema,
  state: readiness,
  items: z.array(
    z.strictObject({
      key: z.string(),
      label: z.string(),
      state: readiness,
      required: z.boolean(),
      detail: z.string().optional(),
      checkedAt: SafeCounterSchema.optional(),
    }),
  ),
});
const textMap = z.record(z.string(), z.string());
const reviewerConfig = z.strictObject({
  harness: SessionProviderSchema,
  model: z.string(),
  modelSettings: textMap,
  instructions: z.string(),
});
const inputFields = {
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  projectId: z.string(),
  harness: SessionProviderSchema,
  model: z.string(),
  runtimeMode: SessionRuntimeModeSchema,
  modelSettings: textMap.optional(),
  maxRunMinutes: z.number().optional(),
  providerAccountId: z.string().optional(),
  budget: TaskBudgetSchema.optional(),
  preflightRequirements: z.array(TaskPreflightRequirementSchema).optional(),
  workflowId: z.string().optional(),
  workflowVersion: z.number().optional(),
  crewDefinitionId: z.string().optional(),
  crewRunId: z.string().optional(),
  crewScopes: z.array(z.string()).optional(),
  crewReviewFingerprint: z.string().optional(),
  reviewerConfig: reviewerConfig.nullable().optional(),
  isolate: z.boolean().optional(),
  workspace: TaskWorkspaceSchema.optional(),
  position: z.number().optional(),
  verifyCommand: z.string().optional(),
  review: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  continueUntilDone: z.boolean().optional(),
  goalId: z.string().optional(),
  source: z.enum(["manual", "goal", "steward"]).optional(),
  stewardId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
};
export const TaskReviewNoteSchema = z.strictObject({
  id: z.string(),
  finding: z.string(),
  suggestion: z.string().optional(),
  details: z.string().optional(),
  kind: z.enum(["finding", "suggestion"]),
  category: z.enum(["code", "external"]).optional(),
  sessionId: z.string().optional(),
  sessionIds: z.array(z.string()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  occurrences: z.number(),
  readAt: z.number().optional(),
  resolvedAt: z.number().optional(),
});
export const TaskDeliveryArtifactsSchema = z.strictObject({
  paths: z.array(z.string()),
  hashes: textMap,
  sourceFingerprint: z.string(),
  targetFingerprint: z.string(),
  targetHashes: z.record(z.string(), z.string().nullable()),
  blockers: z.array(z.string()),
  planToken: z.string(),
  sourceHead: z.string(),
  targetDirectory: z.string(),
});
export const TaskEvaluationSchema = z.strictObject({
  accepted: z.boolean(),
  reviewMinutes: z.number(),
  corrections: z.number(),
  recordedAt: z.number().optional(),
});
export const TaskVerificationSchema = z.strictObject({
  command: z
    .strictObject({ exitCode: z.number().nullable(), output: z.string(), timedOut: z.boolean() })
    .optional(),
  review: z
    .strictObject({ verdict: z.enum(["pass", "fail"]), note: z.string(), sessionId: z.string() })
    .optional(),
  acceptance: TaskAcceptanceReportSchema.optional(),
});
const metadataFields = {
  workspaceId: z.string().optional(),
  workspaceGenerationId: z.string().optional(),
  workspaceActivityId: z.string().optional(),
  deliveryState: z.enum(["awaitingOwner", "merged", "published"]).optional(),
  deliveryOperationId: z.string().optional(),
  artifactDeliveryPending: z.boolean().optional(),
  artifactDeliveryActivityId: z.string().optional(),
  deliveryArtifacts: TaskDeliveryArtifactsSchema.optional(),
  deliveryApprovalRequired: z.boolean().optional(),
  finalization: z
    .strictObject({
      branch: z.string(),
      head: z.string(),
      status: z.string(),
      diff: z.string(),
      fingerprint: z.string(),
      clean: z.boolean(),
    })
    .optional(),
  evaluation: TaskEvaluationSchema.optional(),
  budgetUsage: TaskBudgetUsageSchema.optional(),
  budgetStop: z.string().optional(),
  preflight: TaskPreflightResultSchema.optional(),
  crewExecutionId: z.string().optional(),
  status: TaskStatusSchema.optional(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  runStall: z
    .strictObject({
      sessionId: z.string(),
      runId: z.string(),
      lastActivityAt: SafeCounterSchema,
      detectedAt: SafeCounterSchema,
    })
    .optional(),
  error: z.string().optional(),
  retryFeedback: z.string().optional(),
  repairAttempts: z.number().optional(),
  reviewFailureCount: z.number().optional(),
  awaitingOwnerRestart: z.boolean().optional(),
  blockedTakeover: z
    .strictObject({ at: z.number(), previousSessionId: z.string().optional(), blocker: z.string() })
    .optional(),
  repairNote: z.string().optional(),
  checkFailureFingerprint: z.string().optional(),
  repairStop: z
    .strictObject({ reason: z.enum(["external", "no_progress", "limit"]), message: z.string() })
    .optional(),
  ownerNotices: z
    .array(
      z.strictObject({
        id: z.string(),
        kind: z.enum(["remaining_finding", "external_check", "auto_continued", "info"]),
        message: z.string(),
        at: z.number(),
      }),
    )
    .optional(),
  completedWithFindings: z.boolean().optional(),
  attemptHistory: z
    .array(
      z.strictObject({
        attempt: z.number(),
        at: z.number(),
        workerSessionId: z.string().optional(),
        reviewerSessionId: z.string(),
        workerSummary: z.string(),
        verdict: z.enum(["pass", "fail"]),
        reviewOnly: z.boolean().optional(),
        note: z.string(),
        findings: z.array(z.string()),
        workspaceFingerprint: z.string().optional(),
      }),
    )
    .optional(),
  reviewOnly: z.boolean().optional(),
  reviewNotes: z.array(TaskReviewNoteSchema).optional(),
  branch: z.string().optional(),
  worktreeCwd: z.string().optional(),
  baseBranch: z.string().optional(),
  baseCommit: z.string().optional(),
  deliveryCwd: z.string().optional(),
  merged: z.boolean().optional(),
  autoMerged: z.boolean().optional(),
  mergedAt: z.number().optional(),
  deliveredCommit: z.string().optional(),
  artifactPaths: z.array(z.string()).optional(),
  artifactHashes: textMap.optional(),
  deliveryRequested: z.boolean().optional(),
  dependencyArtifactsPrepared: z.boolean().optional(),
  verification: TaskVerificationSchema.optional(),
  reviewer: z
    .strictObject({
      sessionId: z.string().optional(),
      runId: z.string().optional(),
      startedAt: z.number(),
      acceptanceRequired: z.boolean().optional(),
      workspaceFingerprint: z.string().optional(),
      error: z.string().optional(),
      verdictRepairAttempts: z.number().optional(),
      verdictRepairPending: z.boolean().optional(),
      recoveryPending: z.boolean().optional(),
    })
    .optional(),
  diffStat: z.string().optional(),
  mergeError: z.string().optional(),
  deliveryNote: z.string().optional(),
  mergeRepair: z
    .strictObject({
      baseHead: z.string(),
      conflicts: z.array(z.string()),
      attempts: z.number(),
      prepared: z.boolean().optional(),
      replayCommit: z.string().optional(),
      replayStarted: z.boolean().optional(),
    })
    .optional(),
  historyRecovery: z
    .array(
      z.strictObject({
        branch: z.string(),
        worktreeCwd: z.string().optional(),
        baseCommit: z.string(),
        head: z.string(),
      }),
    )
    .optional(),
  mergeRetry: z.strictObject({ fingerprint: z.string(), after: z.number() }).optional(),
  cleanupError: z.string().optional(),
  cleanupRetryAfter: z.number().optional(),
  cleanupArchives: z.array(z.string()).optional(),
  needsInput: z.boolean().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
};
export const TaskConfigurationSchema = z.strictObject({ ...inputFields, ...metadataFields });
export const TaskPayloadSchema = TaskConfigurationSchema.extend({
  expectedConfiguration: TaskConfigurationSchema.optional(),
  expectedUpdatedAt: z.number().optional(),
});
export const HostTaskSchema = TaskConfigurationSchema.extend({
  assistantFollowups: z
    .strictObject({ delivered: SafeCounterSchema, unconfirmed: SafeCounterSchema })
    .optional(),
  modelSettings: textMap,
  maxRunMinutes: z.number(),
  reviewerConfig: reviewerConfig.optional(),
  status: TaskStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  evaluation: TaskEvaluationSchema.extend({ recordedAt: z.number() }).optional(),
});
export const TasksEmptyParamsSchema = z.strictObject({});
export const TasksListParamsSchema = z.strictObject({ projectId: z.string().optional() });
export const TasksEventsParamsSchema = z.strictObject({
  after: SafeCounterSchema,
  limit: SafeCounterSchema.optional(),
});
export const TasksSaveParamsSchema = z.strictObject({ task: TaskPayloadSchema });
export const TasksIdParamsSchema = z.strictObject({ taskId: z.string() });
export const TasksMoveParamsSchema = TasksIdParamsSchema.extend({ to: TaskStatusSchema });
export const TasksReorderParamsSchema = z.strictObject({ taskIds: z.array(z.string()) });
export const TasksRetargetParamsSchema = TasksIdParamsSchema.extend({
  workspace: TaskWorkspaceSchema.optional(),
  autoMerge: z.boolean().optional(),
});
export const TasksNotesReadParamsSchema = TasksIdParamsSchema.extend({
  noteIds: z.array(z.string()),
});
export const TasksNotesResolveParamsSchema = TasksIdParamsSchema.extend({
  noteId: z.string(),
  resolved: z.boolean(),
});
export const TasksDeleteParamsSchema = TasksIdParamsSchema.extend({
  discard: z.boolean().optional(),
  expectedUpdatedAt: SafeCounterSchema.optional(),
});
export const TasksEvaluationSaveParamsSchema = TasksIdParamsSchema.extend({
  evaluation: TaskEvaluationSchema,
  expectedUpdatedAt: SafeCounterSchema.optional(),
});
export const TaskSnapshotSchema = z.strictObject({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  updatedAt: SafeCounterSchema,
  goalId: z.string().optional(),
});
export const TasksSnapshotResultSchema = z.strictObject({
  tasks: z.array(TaskSnapshotSchema),
  cursor: SafeCounterSchema,
  historyAvailableFrom: SafeCounterSchema,
});
export const TasksEventsResultSchema = z.strictObject({
  events: z.array(
    z.strictObject({
      sequence: SafeCounterSchema,
      projectId: z.string(),
      taskId: z.string(),
      status: TaskStatusSchema,
      effectiveAt: SafeCounterSchema,
      deleted: z.boolean(),
      task: TaskSnapshotSchema.optional(),
    }),
  ),
  cursor: SafeCounterSchema,
  hasMore: z.boolean(),
  historyAvailableFrom: SafeCounterSchema,
});
export const TasksDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });
export type TaskIdentity = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  updatedAt: number;
};
export type TaskSnapshotResult = z.infer<typeof TasksSnapshotResultSchema>;
export type TaskEventsResult = z.infer<typeof TasksEventsResultSchema>;
export type TaskPreflightResult = z.infer<typeof TaskPreflightResultSchema>;
