import { z } from "zod";

export const AssistantNotificationKindSchema = z.enum([
  "briefing",
  "job.done",
  "job.waiting",
  "job.failed",
  "job.stalled",
  "budget.exhausted",
  "owner.question",
  "task.done",
  "task.needsInput",
]);
export type AssistantNotificationKind = z.infer<typeof AssistantNotificationKindSchema>;
export const AssistantJobHoldReasonSchema = z.enum([
  "report",
  "hours",
  "budget",
  "paused",
  "noExecution",
  "disabled",
]);
/** Why a queued job is not starting. */
export type AssistantJobHoldReason = z.infer<typeof AssistantJobHoldReasonSchema>;
/** Opt-in snapshot data that older strict clients cannot parse. */
export const AssistantSnapshotFeaturesSchema = z
  .array(z.enum(["jobHolds", "jobStalled"]))
  .max(8)
  .optional();
