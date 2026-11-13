import { z } from "zod";
import { MODEL_ROUTING_MAX_ENTRIES } from "./host-contracts/model-routing";
import {
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "./host-contracts/session-commands";

/** Read-only compatibility view of the Host main model order, plus the legacy seed row shape. */
export const ASSISTANT_MODEL_POOL_ROLES = ["worker", "planning", "chief", "reply"] as const;
export const AssistantModelPoolRoleSchema = z.enum(ASSISTANT_MODEL_POOL_ROLES);
export type AssistantModelPoolRole = z.infer<typeof AssistantModelPoolRoleSchema>;

const id = z.string().min(1).max(200);

export const AssistantModelPoolRowSchema = z.strictObject({
  id,
  harness: SessionProviderSchema,
  providerAccountId: id.optional(),
  model: z.string().min(1).max(200),
  modelSettings: ModelSettingsSchema,
  runtimeMode: SessionRuntimeModeSchema,
  maxRunMinutes: z.number().int().min(1).max(10080),
  roles: z.array(AssistantModelPoolRoleSchema).min(1).max(4),
  /** Omitted means 0. */
  minRemainingPercent: z.number().int().min(0).max(100).optional(),
  unknownLimit: z.enum(["use", "skip"]),
});
export type AssistantModelPoolRow = z.infer<typeof AssistantModelPoolRowSchema>;

export const ASSISTANT_MODEL_POOL_MAX_ROWS = MODEL_ROUTING_MAX_ENTRIES;
export const AssistantModelPoolSchema = z.strictObject({
  rows: z.array(AssistantModelPoolRowSchema).max(ASSISTANT_MODEL_POOL_MAX_ROWS),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantModelPool = z.infer<typeof AssistantModelPoolSchema>;

/** Compatibility response; routing-backed views always set `derived` to false. */
export const AssistantModelPoolResponseSchema = AssistantModelPoolSchema.extend({
  derived: z.boolean(),
});
export type AssistantModelPoolResponse = z.infer<typeof AssistantModelPoolResponseSchema>;

export const AssistantModelPoolGetSchema = z.strictObject({ op: z.literal("models.pool.get") });
export const AssistantModelPoolOps = [AssistantModelPoolGetSchema] as const;
