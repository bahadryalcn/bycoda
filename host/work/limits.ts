import type { WorkUsageMetric, WorkUsageReading } from "./usage";

/** Omitted or zero limits explicitly impose no admission constraint. */
export type WorkCalendarCaps = {
  daily?: { tokens?: number; costUsd?: number };
  monthly?: { tokens?: number; costUsd?: number };
};
export type WorkCapWait = {
  code: "workCapReached" | "workUsageUnknown";
  period: "daily" | "monthly";
  metric: WorkUsageMetric;
  provider?: string;
  accountId?: string;
  limit: number;
  used: number | null;
  reported: number;
  nextResetAt: number;
  reason: string;
};

/** Admission threshold only: never stops a currently accepted turn or promises no overshoot. */
export function evaluateWorkCaps(
  caps: WorkCalendarCaps,
  usage: WorkUsageReading,
): { allowed: boolean; waits: WorkCapWait[] } {
  const waits: WorkCapWait[] = [];
  for (const period of ["daily", "monthly"] as const) {
    for (const metric of ["tokens", "costUsd"] as const) {
      const limit = caps[period]?.[metric];
      if (limit === undefined || limit === 0) continue;
      if (
        !Number.isFinite(limit) ||
        limit < 0 ||
        (metric === "tokens" && !Number.isSafeInteger(limit))
      )
        throw new Error("Invalid Work calendar cap.");
      const reading = usage[period][metric];
      const reached = reading.reported >= limit;
      if (!reached && reading.complete && reading.used !== null) continue;
      waits.push({
        code: reached ? "workCapReached" : "workUsageUnknown",
        period,
        metric,
        provider: usage.provider,
        accountId: usage.accountId,
        limit,
        used: reading.used,
        reported: reading.reported,
        nextResetAt: usage[period].nextResetAt,
        reason: reached
          ? `${period} Work ${metric} cap reached; new turns wait until the calendar window resets.`
          : `${period} Work ${metric} usage is incomplete: ${reading.reasons.join(" ")}`,
      });
    }
  }
  return { allowed: waits.length === 0, waits };
}
