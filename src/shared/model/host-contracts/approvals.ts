import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

const id = z.string().min(1).max(200);
const text = z.string().max(20000);
const label = z.string().max(200);
// The manifest allows only length checks; the registry compares the exact value.
const signature = z.string().min(64).max(64);
const timestamp = z.number().int().nonnegative();

const detailText = z.string().max(65536);
/** Structured preview of an Inbox write, the same shape the desktop dialog renders. */
export const ApprovalDetailsSchema = z.strictObject({
  action: z.enum(["comment", "review", "pr-action"]),
  project: detailText,
  provider: detailText,
  target: detailText,
  replyTo: detailText.optional(),
  thread: detailText.optional(),
  body: detailText.optional(),
  review: z
    .strictObject({
      event: detailText,
      commitId: detailText,
      body: detailText,
      comments: z
        .array(
          z.strictObject({
            path: detailText,
            line: z.number().int(),
            startLine: z.number().int().optional(),
            side: detailText,
            body: detailText,
          }),
        )
        .max(500),
    })
    .optional(),
  prAction: detailText.optional(),
  headSha: detailText.optional(),
});

/** One approval the desktop shows natively, as the desktop mirrors it to the Host. */
export const ApprovalMirrorEntrySchema = z.strictObject({
  id,
  title: label,
  message: text,
  confirmLabel: label,
  cancelLabel: label,
  deadline: timestamp,
  /** False for secret entry and physical desktop input: the phone only learns that something waits. */
  remote: z.boolean(),
  /** Structured preview of the same operation `message` states, when native supplied one. */
  details: ApprovalDetailsSchema.optional(),
  signature,
});
export type ApprovalMirrorEntry = z.infer<typeof ApprovalMirrorEntrySchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalViewSchema = ApprovalMirrorEntrySchema.extend({
  status: ApprovalStatusSchema,
  /** Who answered: the phone through `approvals.decide`, or the owner at the computer. */
  decidedBy: z.enum(["phone", "desktop"]).optional(),
  decidedAt: timestamp.optional(),
  /** Present on expired entries: the sentence the phone and desktop show. */
  notice: z.string().max(500).optional(),
});
export type ApprovalView = z.infer<typeof ApprovalViewSchema>;

export const ApprovalOutcomeSchema = z.strictObject({
  id,
  /** `answered`: the owner clicked on the computer; `ended`: timeout, revocation or window closed. */
  outcome: z.enum(["answered", "ended"]),
  approved: z.boolean().optional(),
});

/** Owner-only approvals mirrored from the desktop so a paired phone can answer the remote ones. */
export const APPROVALS_RPC = {
  "approvals.mirror": {
    params: z.strictObject({
      upsert: z.array(ApprovalMirrorEntrySchema).max(24),
      remove: z.array(ApprovalOutcomeSchema).max(24),
    }),
    result: z.strictObject({ accepted: z.number().int().min(0).max(24) }),
    query: false,
  },
  "approvals.list": {
    params: z.strictObject({}),
    result: z.strictObject({ approvals: z.array(ApprovalViewSchema).max(200) }),
    query: true,
  },
  "approvals.decide": {
    params: z.strictObject({ id, signature, approved: z.boolean() }),
    result: z.strictObject({
      id,
      status: ApprovalStatusSchema,
      approved: z.boolean(),
      /** True when an earlier decision already won; `approved` then reports that decision. */
      alreadyDecided: z.boolean(),
    }),
    query: false,
  },
  "approvals.decisions": {
    params: z.strictObject({}),
    result: z.strictObject({
      decisions: z.array(z.strictObject({ id, signature, approved: z.boolean() })).max(24),
    }),
    query: true,
  },
} as const;

export type ApprovalsMethod = keyof typeof APPROVALS_RPC;

/** The caller passes its workflow builder in, as `activityMethods` does. */
export function approvalsMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: ApprovalsMethod): HostRpcMethodDefinition => {
    const schema = APPROVALS_RPC[method];
    return workflow("approvals.v1", schema.params, schema.result, schema.query);
  };
  return {
    "approvals.mirror": operation("approvals.mirror"),
    "approvals.list": operation("approvals.list"),
    "approvals.decide": operation("approvals.decide"),
    "approvals.decisions": operation("approvals.decisions"),
  };
}
