import { z } from "zod";
import { ModelRoutingTargetSchema } from "./model-routing";
import { SessionRuntimeModeSchema } from "./session-commands";

const identity = z.string().min(1).max(300);
export const WorkSourceSchema = z.strictObject({
  kind: z.enum([
    "task.worker",
    "task.reviewer",
    "task.repair",
    "task.recovery",
    "goal.planner",
    "goal.finalReview",
    "steward",
    "automation",
    "crew.coordinator",
    "crew.member",
    "assistant",
    "social.generation",
    "delegation.advisor",
    "delegation.subagent",
  ]),
  id: identity,
  /** Stable producer occurrence, not a fresh ID on every scheduling tick. */
  occurrence: identity,
});
export const WorkWaitSchema = z.strictObject({
  code: z.enum([
    "capacity",
    "projectCapacity",
    "dailyLimit",
    "usageLimit",
    "permission",
    "model",
    "configuration",
    "dependency",
    "owner",
  ]),
  message: z.string().min(1),
});
export const WorkSubmissionSchema = z.strictObject({
  source: WorkSourceSchema,
  projectId: identity.optional(),
  rootWorkId: identity.optional(),
  /** Immutable producer input; domain records remain authoritative projections. */
  payload: z.record(z.string(), z.unknown()),
});
export const WorkTargetSchema = z.strictObject({
  model: ModelRoutingTargetSchema,
  runtimeMode: SessionRuntimeModeSchema,
  permissionRevision: identity,
  execution: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("project"),
      projectId: identity,
      workspaceId: identity.optional(),
      worktreeCwd: z.string().min(1).optional(),
    }),
    z.strictObject({ kind: z.literal("room"), threadId: identity }),
    z.strictObject({ kind: z.literal("helper"), helperId: identity }),
  ]),
});
export const WorkReceiptSchema = z.strictObject({ sessionId: identity, runId: identity });
export const WorkOutcomeSchema = z.strictObject({
  status: z.enum(["succeeded", "failed", "cancelled", "findings"]),
  message: z.string().optional(),
});
export const WorkRecordSchema = WorkSubmissionSchema.extend({
  id: identity,
  requestId: identity,
  state: z.enum(["queued", "waiting", "running", "unknown", "completed"]),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  reserved: z.boolean(),
  dispatchStarted: z.boolean(),
  stopRequested: z.boolean(),
  target: WorkTargetSchema.optional(),
  receipt: WorkReceiptSchema.optional(),
  wait: WorkWaitSchema.optional(),
  outcome: WorkOutcomeSchema.optional(),
});
export type WorkSource = z.infer<typeof WorkSourceSchema>;
export type WorkWait = z.infer<typeof WorkWaitSchema>;
export type WorkSubmission = z.infer<typeof WorkSubmissionSchema>;
export type WorkTarget = z.infer<typeof WorkTargetSchema>;
export type WorkReceipt = z.infer<typeof WorkReceiptSchema>;
export type WorkOutcome = z.infer<typeof WorkOutcomeSchema>;
export type WorkRecord = z.infer<typeof WorkRecordSchema>;
