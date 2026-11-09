import { z } from "zod";
import {
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "./host-contracts/session-commands";

/** Owner-ordered models the Assistant must use for delegated work. Order is priority.
 * Carried only by the `models.pool.*` operations; it is not part of the profile or snapshot. */
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

export const ASSISTANT_MODEL_POOL_MAX_ROWS = 20;
export const AssistantModelPoolSchema = z.strictObject({
  rows: z.array(AssistantModelPoolRowSchema).max(ASSISTANT_MODEL_POOL_MAX_ROWS),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type AssistantModelPool = z.infer<typeof AssistantModelPoolSchema>;

/** Response shape; `derived` means nothing was saved and the rows mirror the profile. */
export const AssistantModelPoolResponseSchema = AssistantModelPoolSchema.extend({
  derived: z.boolean(),
});
export type AssistantModelPoolResponse = z.infer<typeof AssistantModelPoolResponseSchema>;

export const AssistantModelPoolGetSchema = z.strictObject({ op: z.literal("models.pool.get") });
export const AssistantModelPoolSetSchema = z.strictObject({
  op: z.literal("models.pool.set"),
  expectedVersion: z.number().int().nonnegative(),
  rows: z.array(AssistantModelPoolRowSchema).max(ASSISTANT_MODEL_POOL_MAX_ROWS),
});
export const AssistantModelPoolOps = [
  AssistantModelPoolGetSchema,
  AssistantModelPoolSetSchema,
] as const;
