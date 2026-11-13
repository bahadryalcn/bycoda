import { z } from "zod";
import { ModelSettingsSchema, SessionProviderSchema } from "./session-commands";

/**
 * Model routing: one Host-wide answer to "which model runs this work".
 *
 * The owner keeps a single ordered list of models (`entries`; order is priority) with the
 * automation limit of each one. Pools are ordered subsets of that list and hold references,
 * never copies. Every use (`role`) follows the main order unless the owner binds it to a pool
 * or a fixed model, and one item (a task, an automation, a crew member) may override its role.
 * The Host resolves a choice when a run starts and freezes the result on that run.
 */
export const HOST_MODEL_ROUTING = "models.routing.v1";

const id = z.string().min(1).max(200);

export const MODEL_ROUTING_ROLES = [
  "task.worker",
  "task.reviewer",
  "goal.planner",
  "goal.finalReview",
  "steward",
  "automation",
  "crew.member",
  "assistant.worker",
  "assistant.planning",
  "assistant.chief",
  "assistant.reply",
  "voice.reply",
  "text.translation",
  "text.reprompt",
  "text.title",
  "text.git",
  "text.skillGrouping",
  "text.themeGenerator",
] as const;
export const ModelRoutingRoleSchema = z.enum(MODEL_ROUTING_ROLES);
export type ModelRoutingRole = z.infer<typeof ModelRoutingRoleSchema>;

/** `modelSettings` keys that configure delegation. They live in `delegation`, never in an entry. */
export const MODEL_ROUTING_DELEGATION_KEYS = [
  "crossSubagents",
  "crossAdvisor",
  "crossSubagentMaxEffort",
  "imageModels",
] as const;

/** One concrete model: what a session is started with. */
export const ModelRoutingTargetSchema = z.strictObject({
  harness: SessionProviderSchema,
  providerAccountId: id.optional(),
  model: z.string().min(1).max(200),
  /** Effort and other model options. Delegation keys are rejected here. */
  modelSettings: ModelSettingsSchema,
});
export type ModelRoutingTarget = z.infer<typeof ModelRoutingTargetSchema>;

export const MODEL_ROUTING_MAX_ENTRIES = 40;
/** A row of the main order. The limit is defined here once and applies in every pool. */
export const ModelRoutingEntrySchema = ModelRoutingTargetSchema.extend({
  id,
  /** Unattended work skips this entry when less than this share of its quota is left. Omitted means 0. */
  minRemainingPercent: z.number().int().min(0).max(100).optional(),
  /** What to do when the remaining quota cannot be read. */
  unknownLimit: z.enum(["use", "skip"]),
});
export type ModelRoutingEntry = z.infer<typeof ModelRoutingEntrySchema>;

export const MODEL_ROUTING_MAX_POOLS = 50;
/** A named, ordered subset of the main order. `entryIds` order is the pool's own priority. */
export const ModelRoutingPoolSchema = z.strictObject({
  id,
  name: z.string().min(1).max(80),
  entryIds: z.array(id).min(1).max(MODEL_ROUTING_MAX_ENTRIES),
});
export type ModelRoutingPool = z.infer<typeof ModelRoutingPoolSchema>;

/**
 * What a role is bound to. An unbound role uses `{ kind: "order" }`, except the `text.*`
 * helper roles: unbound, they keep their feature's own automatic (cheap model) choice, and
 * they follow the main order only when bound to it explicitly.
 */
export const ModelRoutingChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("order") }),
  z.strictObject({ kind: z.literal("pool"), poolId: id }),
  z.strictObject({ kind: z.literal("fixed"), target: ModelRoutingTargetSchema }),
]);
export type ModelRoutingChoice = z.infer<typeof ModelRoutingChoiceSchema>;

/**
 * What one item stores as `modelChoice`. `default` follows the item's role; `fixed` means the
 * item's own harness, account, model and model settings fields. An item without `modelChoice`
 * predates routing and is treated as `fixed`.
 */
export const ModelRoutingItemChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("default") }),
  z.strictObject({ kind: z.literal("order") }),
  z.strictObject({ kind: z.literal("pool"), poolId: id }),
  z.strictObject({ kind: z.literal("fixed") }),
]);
export type ModelRoutingItemChoice = z.infer<typeof ModelRoutingItemChoiceSchema>;

/**
 * Delegation settings (subagents, advisor, subagent effort ceiling, image models) applied to
 * every run after its model is chosen. Later layers win: `global`, then `providers[harness]`,
 * then `accounts["<harness>\n<accountId>"]`, then keys the item itself sets.
 */
export const ModelRoutingDelegationSchema = z.strictObject({
  global: ModelSettingsSchema,
  providers: z.partialRecord(SessionProviderSchema, ModelSettingsSchema),
  accounts: z.record(z.string().min(3).max(401), ModelSettingsSchema),
});
export type ModelRoutingDelegation = z.infer<typeof ModelRoutingDelegationSchema>;

/** Calendar thresholds for unattended Work; omitted or zero means unlimited. */
export const WorkCalendarCapsSchema = z.strictObject({
  daily: z
    .strictObject({
      tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      costUsd: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  monthly: z
    .strictObject({
      tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      costUsd: z.number().finite().nonnegative().optional(),
    })
    .optional(),
});
export type WorkCalendarCaps = z.infer<typeof WorkCalendarCapsSchema>;
export const WorkCapsSchema = z.strictObject({
  total: WorkCalendarCapsSchema.optional(),
  providers: z.partialRecord(SessionProviderSchema, WorkCalendarCapsSchema).optional(),
});

const routingFields = {
  workCaps: WorkCapsSchema.optional(),
  entries: z.array(ModelRoutingEntrySchema).max(MODEL_ROUTING_MAX_ENTRIES),
  pools: z.array(ModelRoutingPoolSchema).max(MODEL_ROUTING_MAX_POOLS),
  roles: z.partialRecord(ModelRoutingRoleSchema, ModelRoutingChoiceSchema),
  delegation: ModelRoutingDelegationSchema,
  /** Longest single unattended run in minutes when the item sets none. Omitted means no default. */
  defaultMaxRunMinutes: z.number().int().min(1).max(10080).optional(),
};
export const ModelRoutingDraftSchema = z.strictObject(routingFields);
export type ModelRoutingDraft = z.infer<typeof ModelRoutingDraftSchema>;

export const ModelRoutingStateSchema = z.strictObject({
  ...routingFields,
  version: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ModelRoutingState = z.infer<typeof ModelRoutingStateSchema>;

export const EMPTY_MODEL_ROUTING: ModelRoutingDraft = {
  entries: [],
  pools: [],
  roles: {},
  delegation: { global: {}, providers: {}, accounts: {} },
};

export const MODEL_ROUTING_SKIP_REASONS = [
  /** The model is disabled or not in the Host catalog. */
  "unavailable",
  "signedOut",
  "belowLimit",
  "unknownLimit",
  "missingCapability",
] as const;
export const ModelRoutingSkipSchema = z.strictObject({
  entryId: id,
  reason: z.enum(MODEL_ROUTING_SKIP_REASONS),
});
export type ModelRoutingSkip = z.infer<typeof ModelRoutingSkipSchema>;

/**
 * The outcome of resolving a choice. `notConfigured` means the main order (or the pool) is
 * empty: the caller keeps the item's own stored model, so an unconfigured Host behaves as
 * before. `noEligibleEntry` means every entry was skipped: the run waits until `nextResetAt`.
 */
export const ModelRoutingResolutionSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    /** `modelSettings` already includes the delegation settings for the chosen provider and account. */
    target: ModelRoutingTargetSchema,
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("fixed") }),
      z.strictObject({ kind: z.literal("order"), entryId: id }),
      z.strictObject({ kind: z.literal("pool"), poolId: id, entryId: id }),
    ]),
    skipped: z.array(ModelRoutingSkipSchema),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["notConfigured", "noEligibleEntry"]),
    skipped: z.array(ModelRoutingSkipSchema),
    nextResetAt: z.number().int().nonnegative().optional(),
  }),
]);
export type ModelRoutingResolution = z.infer<typeof ModelRoutingResolutionSchema>;

/** Live state of one entry for the settings screen. */
export const ModelRoutingEntryStatusSchema = z.strictObject({
  entryId: id,
  /** The reason unattended work would skip this entry right now, if any. */
  skip: z.enum(MODEL_ROUTING_SKIP_REASONS).optional(),
  leftPercent: z.number().min(0).max(100).optional(),
  resetsAt: z.number().int().nonnegative().optional(),
});
export type ModelRoutingEntryStatus = z.infer<typeof ModelRoutingEntryStatusSchema>;

export const ModelRoutingGetParamsSchema = z.strictObject({});
export const ModelRoutingGetResultSchema = z.strictObject({ state: ModelRoutingStateSchema });
export const ModelRoutingSaveParamsSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  draft: ModelRoutingDraftSchema,
});
export const ModelRoutingSaveResultSchema = ModelRoutingGetResultSchema;
export const ModelRoutingStatusParamsSchema = z.strictObject({});
export const ModelRoutingStatusResultSchema = z.strictObject({
  entries: z.array(ModelRoutingEntryStatusSchema),
});
export const ModelRoutingResolveParamsSchema = z.strictObject({
  role: ModelRoutingRoleSchema,
  /** The item's choice; omitted means `default`. */
  choice: ModelRoutingItemChoiceSchema.optional(),
  /** The item's own model, required when the effective choice is `fixed`. */
  fixed: ModelRoutingTargetSchema.optional(),
});
export const ModelRoutingResolveResultSchema = z.strictObject({
  resolution: ModelRoutingResolutionSchema,
});
