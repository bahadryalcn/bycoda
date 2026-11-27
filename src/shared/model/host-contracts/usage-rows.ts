import { z } from "zod";

/**
 * Token rows from the provider logs of one Host, per provider account, in the same 15-minute
 * slots as the desktop's native `provider_usage_report`, so the Usage dashboard can show another
 * machine's usage next to this one. Read-only; no provider session is started.
 */
export const HOST_USAGE_ROWS_METHOD = "usage.rows.read";
export const HOST_USAGE_ROWS = "usage.rows.v1";

/** Rows older than this are not read: a longer scan outlasts the request deadline. */
export const USAGE_ROWS_MAX_DAYS = 90;
export const USAGE_ROWS_SLOT_SECONDS = 15 * 60;

export const UsageRowsParamsSchema = z.strictObject({
  /** Unix milliseconds; the Host clamps it to the last `USAGE_ROWS_MAX_DAYS` days. */
  sinceMs: z.number().int().nonnegative(),
});
export type UsageRowsParams = z.infer<typeof UsageRowsParamsSchema>;

/** One slot of one model in one folder; structurally the desktop's `UsageRow`. */
export type UsageRowsRow = {
  /** Slot start, Unix seconds. */
  slot: number;
  model: string;
  /** Working directory on the Host; empty when unknown. */
  project: string;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
};

export type UsageRowsAccount = {
  provider: "claude" | "codex";
  accountId: string;
  label: string;
  rows: UsageRowsRow[];
};

export type UsageRowsResult = {
  environmentId: string;
  sampledAt: number;
  /** The start actually read, after clamping. Later than the requested `sinceMs` when clamped. */
  sinceMs: number;
  accounts: UsageRowsAccount[];
  coverage: { filesScanned: number; truncated: boolean };
};
