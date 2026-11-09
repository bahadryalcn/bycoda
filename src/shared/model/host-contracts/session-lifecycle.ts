import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";
import { IdentifierSchema } from "./schemas";

const SessionIdParams = z.strictObject({ sessionId: IdentifierSchema });
export const SessionLifecycleRecordSchema = z.strictObject({
  sessionId: z.string(),
  state: z.enum(["active", "settling", "settled"]),
  participants: z.array(
    z.strictObject({ userId: z.string().nullable(), role: z.literal("owner") }),
  ),
  settleRequestedAt: z.number().optional(),
  settledAt: z.number().optional(),
  settledBy: z.enum(["owner", "auto"]).optional(),
  keepActive: z.boolean().optional(),
});

const AutoDays = z.number().int().min(1).max(365).nullable();

/** An older Host answers without `archiveAfterDays`; an omitted one in a change keeps the saved. */
export const AutoSettleSettingsSchema = z.strictObject({
  afterDays: AutoDays,
  archiveAfterDays: AutoDays.optional(),
});

const SessionTaskLinkSchema = z.strictObject({
  sessionId: z.string(),
  taskId: z.string(),
  linkedAt: z.number(),
});

export const SESSION_LIFECYCLE_RPC = {
  "sessions.lifecycle.get": {
    params: SessionIdParams,
    result: SessionLifecycleRecordSchema,
    query: true,
  },
  "sessions.lifecycle.list": {
    params: z.strictObject({}),
    result: z.strictObject({
      records: z.array(SessionLifecycleRecordSchema),
      autoSettle: AutoSettleSettingsSchema,
    }),
    query: true,
  },
  "sessions.lifecycle.settle": {
    params: SessionIdParams,
    result: SessionLifecycleRecordSchema,
    query: false,
  },
  "sessions.lifecycle.unsettle": {
    params: SessionIdParams,
    result: SessionLifecycleRecordSchema,
    query: false,
  },
  "sessions.lifecycle.configure": {
    params: AutoSettleSettingsSchema,
    result: AutoSettleSettingsSchema,
    query: false,
  },
  "sessions.taskLink.get": {
    params: SessionIdParams,
    result: z.strictObject({ taskId: z.string().nullable() }),
    query: true,
  },
  "sessions.taskLink.link": {
    params: z.strictObject({ sessionId: IdentifierSchema, taskId: IdentifierSchema }),
    result: SessionTaskLinkSchema,
    query: false,
  },
  "sessions.taskLink.unlink": {
    params: SessionIdParams,
    result: z.strictObject({ unlinked: z.boolean() }),
    query: false,
  },
  "sessions.taskLink.listForTask": {
    params: z.strictObject({ taskId: IdentifierSchema }),
    result: z.strictObject({ sessionIds: z.array(z.string()) }),
    query: true,
  },
} as const;

export type SessionLifecycleMethod = keyof typeof SESSION_LIFECYCLE_RPC;

/** The caller passes its workflow builder in, as `decisionModelsMethods` does. */
export function sessionLifecycleMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: SessionLifecycleMethod): HostRpcMethodDefinition => {
    const schema = SESSION_LIFECYCLE_RPC[method];
    return workflow("sessions.lifecycle.v2", schema.params, schema.result, schema.query);
  };
  return {
    "sessions.lifecycle.get": operation("sessions.lifecycle.get"),
    "sessions.lifecycle.list": operation("sessions.lifecycle.list"),
    "sessions.lifecycle.settle": operation("sessions.lifecycle.settle"),
    "sessions.lifecycle.unsettle": operation("sessions.lifecycle.unsettle"),
    "sessions.lifecycle.configure": operation("sessions.lifecycle.configure"),
    "sessions.taskLink.get": operation("sessions.taskLink.get"),
    "sessions.taskLink.link": operation("sessions.taskLink.link"),
    "sessions.taskLink.unlink": operation("sessions.taskLink.unlink"),
    "sessions.taskLink.listForTask": operation("sessions.taskLink.listForTask"),
  };
}
