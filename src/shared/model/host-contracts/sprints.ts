import { z } from "zod";
import { SafeCounterSchema } from "./schemas";
import { TaskStatusSchema } from "./tasks";

// Portable structural inventory. HostSprints owns text/Unicode/point policy,
// planning CAS, source cursors, lifecycle gates and immutable completed reports.
export const SprintProjectRefSchema = z.strictObject({
  environmentId: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  name: z.string(),
});
export const SprintTaskRefSchema = z.strictObject({
  environmentId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
});
export const SprintFieldsSchema = z.strictObject({
  name: z.string(),
  goal: z.string().optional(),
  projects: z.array(SprintProjectRefSchema),
  capacityPoints: z.number().nullable(),
  projectCapacities: z.record(z.string(), z.number()),
  startsAt: SafeCounterSchema.optional(),
  endsAt: SafeCounterSchema.optional(),
});
export const HostSprintSchema = SprintFieldsSchema.extend({
  id: z.string(),
  state: z.enum(["planned", "active", "completed", "archived"]),
  revision: SafeCounterSchema,
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
  startedAt: SafeCounterSchema.optional(),
  completedAt: SafeCounterSchema.optional(),
});
export const SprintCommandSchema = z.strictObject({
  requestId: z.string(),
  expectedRevision: SafeCounterSchema,
});
export const SprintCreateInputSchema = SprintFieldsSchema.extend({
  id: z.string(),
  requestId: z.string(),
});
export const SprintUpdateInputSchema = SprintFieldsSchema.partial().extend({
  ...SprintCommandSchema.shape,
  goal: z.string().nullable().optional(),
  startsAt: SafeCounterSchema.nullable().optional(),
  endsAt: SafeCounterSchema.nullable().optional(),
});
export const SprintCompleteInputSchema = SprintCommandSchema.extend({
  rollover: z
    .strictObject({ taskKeys: z.array(z.string()), targetSprintId: z.string().nullable() })
    .optional(),
});
export const SprintPlanItemSchema = SprintTaskRefSchema.extend({
  sprintId: z.string().nullable(),
  storyPoints: z.number().nullable(),
  revision: SafeCounterSchema,
});
export const SprintPlanInputSchema = SprintTaskRefSchema.extend({
  ...SprintCommandSchema.shape,
  sprintId: z.string().nullable(),
  storyPoints: z.number().nullable().optional(),
});
export const SprintTaskSnapshotSchema = z.strictObject({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  updatedAt: z.number(),
  goalId: z.string().optional(),
});
export const SprintGoalContextSchema = z.strictObject({
  environmentId: z.string(),
  goalId: z.string(),
  sprintId: z.string().nullable(),
  revision: SafeCounterSchema,
});
export const SprintGoalContextInputSchema = SprintGoalContextSchema.omit({ revision: true }).extend(
  SprintCommandSchema.shape,
);
export const SprintSourceEventSchema = z.strictObject({
  sequence: SafeCounterSchema.min(1),
  projectId: z.string(),
  taskId: z.string(),
  status: TaskStatusSchema,
  effectiveAt: z.number(),
  deleted: z.boolean(),
  task: SprintTaskSnapshotSchema.optional(),
});
export const SprintIngestInputSchema = z.strictObject({
  environmentId: z.string(),
  snapshot: z
    .strictObject({
      tasks: z.array(SprintTaskSnapshotSchema),
      cursor: SafeCounterSchema,
      historyAvailableFrom: z.number().optional(),
    })
    .optional(),
  events: z.array(SprintSourceEventSchema).optional(),
  cursor: SafeCounterSchema,
  fromCursor: SafeCounterSchema.optional(),
  historyGap: z.boolean().optional(),
  visibleProjectIds: z.array(z.string()).optional(),
  caughtUp: z.boolean().optional(),
});
export const SprintSourceStateSchema = z.strictObject({
  environmentId: z.string(),
  cursor: SafeCounterSchema,
  syncedAt: SafeCounterSchema,
  historyAvailableFrom: z.number().optional(),
  visibleProjectIds: z.array(z.string()).optional(),
  caughtUp: z.boolean().optional(),
});
export const SprintReportTaskSchema = SprintPlanItemSchema.extend({
  title: z.string(),
  status: TaskStatusSchema,
  deleted: z.boolean(),
  updatedAt: z.number(),
});
export const SprintTotalsSchema = z.strictObject({
  tasks: SafeCounterSchema,
  points: z.number(),
  completedPoints: z.number(),
  remainingPoints: z.number(),
  unestimated: SafeCounterSchema,
  deleted: SafeCounterSchema,
});
export const SprintLedgerEntrySchema = z.strictObject({
  sequence: SafeCounterSchema,
  sprintId: z.string(),
  at: z.number(),
  effectiveAt: z.number().optional(),
  kind: z.enum(["scope", "estimate", "status", "start", "complete", "update"]),
  taskKey: z.string().optional(),
  totals: SprintTotalsSchema,
  projects: z.record(z.string(), SprintTotalsSchema).optional(),
});
export const SprintReportSchema = z.strictObject({
  sprint: HostSprintSchema,
  tasks: z.array(SprintReportTaskSchema),
  totals: SprintTotalsSchema,
  projects: z.record(z.string(), SprintTotalsSchema),
  ledger: z.array(SprintLedgerEntrySchema),
  sources: z.array(SprintSourceStateSchema),
  frozen: z.boolean(),
});
export const SprintBoardSchema = z.strictObject({
  sprints: z.array(HostSprintSchema),
  planning: z.array(SprintPlanItemSchema),
  sources: z.array(SprintSourceStateSchema),
  contexts: z.array(SprintGoalContextSchema).optional(),
});
export const SprintsEmptyParamsSchema = z.strictObject({});
export const SprintsIdParamsSchema = z.strictObject({ id: z.string() });
export const SprintsCreateParamsSchema = z.strictObject({ input: SprintCreateInputSchema });
export const SprintsUpdateParamsSchema = SprintsIdParamsSchema.extend({
  input: SprintUpdateInputSchema,
});
export const SprintsCommandParamsSchema = SprintsIdParamsSchema.extend({
  input: SprintCommandSchema,
});
export const SprintsCompleteParamsSchema = SprintsIdParamsSchema.extend({
  input: SprintCompleteInputSchema,
});
export const SprintsPlanParamsSchema = z.strictObject({ input: SprintPlanInputSchema });
export const SprintsIngestParamsSchema = z.strictObject({ input: SprintIngestInputSchema });
export const SprintsGoalContextParamsSchema = z.strictObject({
  input: SprintGoalContextInputSchema,
});
export const SprintsGetResultSchema = HostSprintSchema.nullable();
export type HostSprint = z.infer<typeof HostSprintSchema>;
export type SprintBoard = z.infer<typeof SprintBoardSchema>;
export type SprintCreateInput = z.infer<typeof SprintCreateInputSchema>;
export type SprintUpdateInput = z.infer<typeof SprintUpdateInputSchema>;
export type SprintCommand = z.infer<typeof SprintCommandSchema>;
export type SprintCompleteInput = z.infer<typeof SprintCompleteInputSchema>;
export type SprintPlanInput = z.infer<typeof SprintPlanInputSchema>;
export type SprintPlanItem = z.infer<typeof SprintPlanItemSchema>;
export type SprintReport = z.infer<typeof SprintReportSchema>;
export type SprintIngestInput = z.infer<typeof SprintIngestInputSchema>;
export type SprintSourceState = z.infer<typeof SprintSourceStateSchema>;
export type SprintGoalContextInput = z.infer<typeof SprintGoalContextInputSchema>;
export type SprintGoalContext = z.infer<typeof SprintGoalContextSchema>;
