import { z } from "zod";

/**
 * Estimated share of a subscription plan window that individual jobs consumed.
 *
 * Providers report only an account-level percentage per window. The Host splits each observed
 * increase across the local turns of that interval by API-equivalent cost, so every value here is
 * an estimate and `null` means unknown, never zero. Accounts are never pooled.
 */
export const HOST_USAGE_PLAN_SHARE_METHOD = "usage.planShare.read";
export const HOST_USAGE_PLAN_SHARE = "usage.planShare.v1";

export const PlanShareWindowSchema = z.enum(["fiveHour", "weekly"]);
export type PlanShareWindow = z.infer<typeof PlanShareWindowSchema>;

/** One account quota reading: the renderer's quota history for the requested window. */
export const PlanShareObservationSchema = z.strictObject({
  /** `provider:accountId`, the key the quota history already uses. */
  account: z.string().min(1).max(256),
  at: z.number().int().nonnegative(),
  usedPercent: z.number().min(0).max(100),
  windowMinutes: z.number().positive().max(60 * 24 * 31),
  resetsAt: z.number().int().nonnegative().nullable(),
});
export type PlanShareObservation = z.infer<typeof PlanShareObservationSchema>;

export const PlanShareParamsSchema = z.strictObject({
  window: PlanShareWindowSchema,
  observations: z.array(PlanShareObservationSchema).max(16_000),
  accounts: z.array(z.string().min(1).max(256)).max(64).optional(),
  sessionIds: z.array(z.string().min(1).max(256)).max(500).optional(),
  taskIds: z.array(z.string().min(1).max(256)).max(500).optional(),
  /** Jobs listed per account, largest first. */
  limit: z.number().int().min(1).max(100).default(10),
});
export type PlanShareParams = z.infer<typeof PlanShareParamsSchema>;

const percent = z.number().nonnegative().nullable();

export const PlanShareJobSchema = z.strictObject({
  sessionId: z.string(),
  taskId: z.string().optional(),
  label: z.string().optional(),
  /** Estimated percent of the account window; `null` when no estimate is possible. */
  estimatedPercent: percent,
  /** True when some of the job's turns could not be estimated, so the value is a lower bound. */
  partial: z.boolean(),
  tokens: z.number().nonnegative(),
  /** API-equivalent cost; `null` when any turn has no price. Not subscription billing. */
  costUsd: z.number().nonnegative().nullable(),
});
export type PlanShareJob = z.infer<typeof PlanShareJobSchema>;

export const PlanShareAccountSchema = z.strictObject({
  account: z.string(),
  status: z.enum(["ok", "noObservations", "stale"]),
  window: z.strictObject({ startMs: z.number(), resetsAt: z.number().nullable() }).nullable(),
  /** The latest provider-reported percent used. */
  observedPercent: percent,
  /** Part of the observed percent that local turns explain. */
  explainedPercent: percent,
  /** Observed increase local turns do not explain (web, phone, other machines); never negative. */
  untrackedPercent: percent,
  /** Local usage since the last observation, estimated with the calibration. */
  unobservedTailPercent: percent,
  calibration: z.strictObject({
    basis: z.enum(["costUsd", "tokens"]),
    /** Percent of the window per unit of the basis; `null` until enough local usage was observed. */
    percentPerUnit: z.number().nonnegative().nullable(),
    intervals: z.number().int().nonnegative(),
  }),
  jobs: z.array(PlanShareJobSchema),
  jobsOmitted: z.number().int().nonnegative(),
});
export type PlanShareAccount = z.infer<typeof PlanShareAccountSchema>;

export const PlanShareResultSchema = z.strictObject({
  environmentId: z.string(),
  sampledAt: z.number(),
  window: PlanShareWindowSchema,
  estimate: z.literal(true),
  coverage: z.strictObject({
    pricing: z.enum(["list-prices", "built-in"]),
    filesScanned: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  accounts: z.array(PlanShareAccountSchema),
});
export type PlanShareResult = z.infer<typeof PlanShareResultSchema>;
