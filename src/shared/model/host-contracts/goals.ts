import { z } from "zod";
import { SafeCounterSchema } from "./schemas";
import { SessionProviderSchema, SessionRuntimeModeSchema } from "./session-commands";

// Structural wire inventory only. HostGoals retains semantic validation,
// Unicode/length policy, defaults, project ownership, budgets and lifecycle.
export const GoalBudgetSchema = z.strictObject({
  maxAgentMinutes: z.number().optional(),
  maxAttempts: z.number().optional(),
  maxTokens: z.number().optional(),
  warningPercent: z.number().optional(),
});
export const GoalBudgetUsageSchema = z.strictObject({
  historyComplete: z.boolean(),
  agentMinutes: z.number(),
  attempts: SafeCounterSchema,
  completedRuns: SafeCounterSchema,
  runningRuns: SafeCounterSchema,
  reportedTokens: z.number(),
  tokens: z.number().nullable(),
  tokensComplete: z.boolean(),
  unknownTokenRuns: SafeCounterSchema,
  reportedCostUsd: z.number().nullable(),
  estimatedCostUsd: z.null(),
  measuredAt: SafeCounterSchema,
});
export const GoalWorkspaceSchema = z.strictObject({
  checkoutCwd: z.string().optional(),
  baseBranch: z.string().optional(),
  branchName: z.string().optional(),
});
export const GoalVerifyDefaultsSchema = z.strictObject({
  verifyCommand: z.record(z.string(), z.string()).optional(),
  review: z.boolean().optional(),
});
export const HostGoalInputSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  projectIds: z.array(z.string()),
  leadProjectId: z.string(),
  harness: SessionProviderSchema,
  providerAccountId: z.string().optional(),
  model: z.string(),
  modelSettings: z.record(z.string(), z.string()).optional(),
  plannerExecution:z.strictObject({harness:SessionProviderSchema,providerAccountId:z.string().optional(),model:z.string(),modelSettings:z.record(z.string(),z.string()).optional()}).optional(),
  runtimeMode: SessionRuntimeModeSchema,
  maxRunMinutes: z.number().optional(),
  isolate: z.boolean().optional(),
  workspaces: z.record(z.string(), GoalWorkspaceSchema).optional(),
  maxRunningTasks: z.number().optional(),
  manualStart: z.boolean().optional(),
  verifyDefaults: GoalVerifyDefaultsSchema.optional(),
  approvePlan: z.boolean().optional(),
  planApprovalPolicy: z.enum(["always", "large", "never"]).optional(),
  autoMerge: z.boolean().optional(),
  continueUntilDone: z.boolean().optional(),
  finalReview: z.boolean().optional(),
  budget: GoalBudgetSchema.optional(),
});
export const GoalSettingsSchema = z.strictObject({
  autoMerge: z.boolean(),
  continueUntilDone: z.boolean(),
  maxRunningTasks: z.number(),
  maxRunMinutes: z.number(),
  budget: GoalBudgetSchema.optional(),
});
export const GoalPlanSchema = z.strictObject({
  tasks: z.array(
    z.strictObject({
      key: z.string(),
      project: z.string(),
      title: z.string(),
      prompt: z.string(),
      dependsOn: z.array(z.string()),
      projectId: z.string().optional(),
    }),
  ),
});
export const GoalAcceptanceReportSchema = z.strictObject({
  checkedAt: SafeCounterSchema,
  sessionId: z.string(),
  workspaceFingerprint: z.string().optional(),
  criteria: z.array(
    z.strictObject({
      criterionIndex: SafeCounterSchema,
      criterion: z.string(),
      verdict: z.enum(["verified", "failed", "unresolved"]),
      evidence: z.array(z.string()),
      note: z.string().optional(),
    }),
  ),
});
export const GoalFinalAcceptanceSchema = z.strictObject({
  status: z.enum(["pending", "running", "passed", "failed"]),
  taskFingerprint: z.string(),
  invalidatedTaskFingerprint: z.string().optional(),
  requestId: z.string().optional(),
  workspaceFingerprint: z.string().optional(),
  freshnessUnknown: z.boolean().optional(),
  accountedRunId: z.string().optional(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  executionWorkspace: z
    .strictObject({ cwd: z.string(), workspaceId: z.string().optional() })
    .optional(),
  startedAt: SafeCounterSchema.optional(),
  completedAt: SafeCounterSchema.optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  recoveryPending: z.boolean().optional(),
  formatRepairAttempts: SafeCounterSchema.optional(),
  acceptance: GoalAcceptanceReportSchema.optional(),
});
export const HostGoalSchema = HostGoalInputSchema.extend({
  awaitingOwnerRestart:z.boolean().optional(),
  modelSettings: z.record(z.string(), z.string()),
  maxRunMinutes: z.number(),
  verifyDefaults: GoalVerifyDefaultsSchema.extend({ review: z.boolean() }),
  approvePlan: z.boolean(),
  deliveryApprovalRequired: z.boolean().optional(),
  status: z.enum(["planning", "awaiting-approval", "running", "done", "blocked", "cancelled"]),
  plan: GoalPlanSchema.optional(),
  planError: z.string().optional(),
  error: z.string().optional(),
  finalAcceptance: GoalFinalAcceptanceSchema.optional(),
  finalAcceptanceHistory: z.array(GoalFinalAcceptanceSchema).optional(),
  budgetUsage: GoalBudgetUsageSchema.optional(),
  budgetStop: z.string().optional(),
  feedback: z.string().optional(),
  plannerSessionId: z.string().optional(),
  plannerRunId: z.string().optional(),
  plannerStartedAt: SafeCounterSchema.optional(),
  plannerRepairAttempts: SafeCounterSchema.optional(),
  plannerRecoveryPending: z.boolean().optional(),
  taskIds: z.array(z.string()),
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
});
export const GoalsEmptyParamsSchema = z.strictObject({});
export const GoalsCreateParamsSchema = z.strictObject({ goal: HostGoalInputSchema });
export const GoalsIdParamsSchema = z.strictObject({ goalId: z.string() });
export const GoalsRecheckParamsSchema = GoalsIdParamsSchema.extend({
  expectedUpdatedAt: SafeCounterSchema,
});
export const GoalsUpdateParamsSchema = GoalsRecheckParamsSchema.extend({
  settings: GoalSettingsSchema,
});
export const GoalsReplanParamsSchema = GoalsIdParamsSchema.extend({
  feedback: z.string().optional(),
});
export const GoalsDeleteParamsSchema = GoalsIdParamsSchema.extend({
  withTasks: z.boolean().optional(),
});
export const GoalsListResultSchema = z.array(HostGoalSchema);
export const GoalsDeleteResultSchema = z.strictObject({ deleted: z.literal(true) });
export type HostGoal = z.infer<typeof HostGoalSchema>;
