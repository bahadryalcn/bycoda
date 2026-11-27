import { formatDate, t } from "../../../shared/i18n/core";
import type { BoundFormat } from "../../../shared/i18n/boundFormat";
import { formatResetDuration } from "../../providers/model/rateLimits";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/public/providerAccounts";
import type { Session } from "./session";

type LimitTarget = Pick<Session, "harness" | "model" | "providerAccountId" | "providerSessionId">;

/** Keep the stopped turn recoverable only after the selected target really changes. */
export function usageLimitAfterTargetChange(
  previous: LimitTarget & Pick<Session, "usageLimit">,
  next: LimitTarget,
  accountId: (target: LimitTarget) => string | undefined = (target) => target.providerAccountId,
): Session["usageLimit"] {
  const limit = previous.usageLimit;
  if (!limit) return undefined;
  const origin = limit.recoveryFrom ?? {
    harness: previous.harness,
    model: previous.model,
    providerAccountId: accountId(previous) ?? DEFAULT_PROVIDER_ACCOUNT_ID,
  };
  if (
    origin.harness === next.harness &&
    origin.model === next.model &&
    origin.providerAccountId === (accountId(next) ?? DEFAULT_PROVIDER_ACCOUNT_ID)
  ) {
    if (!limit.recoveryFrom) return limit;
    const { recoveryFrom: _origin, ...rest } = limit;
    return rest;
  }
  return limit.recoveryFrom ? limit : { ...limit, recoveryFrom: origin };
}

/** Providers can still refuse right at the reset; give them a moment. */
export const USAGE_LIMIT_RESUME_GRACE_MS = 30_000;

/** setTimeout's ceiling; a reset further away than this is left to the minute clock. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Delay until the limit reset is due (0 once it has passed), or undefined when it
 * is beyond one timer. The reset flips the notice on its own deadline, not the minute tick.
 */
export function usageLimitResetDelay(resetsAt: number, now: number): number | undefined {
  const delay = Math.max(0, resetsAt - now);
  return delay <= MAX_TIMER_MS ? delay : undefined;
}

/** "3:16 AM · in 4h 42m" today, "Sep 26, 3:16 AM · in 1d 4h" later. */
export function formatUsageLimitReset(resetsAt: number, now: number): string {
  return formatUsageLimitResetWith(resetsAt, now, t, { formatDate, formatResetDuration });
}

export function formatUsageLimitResetWith(
  resetsAt: number,
  now: number,
  t: (message: string, values?: Record<string, unknown>) => string,
  { formatDate, formatResetDuration }: Pick<BoundFormat, "formatDate" | "formatResetDuration">,
): string {
  const reset = new Date(resetsAt);
  const sameDay = reset.toDateString() === new Date(now).toDateString();
  const when = formatDate(reset, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  return t("{p0} · in {p1}", { p0: when, p1: formatResetDuration(resetsAt - now) });
}

/** Idle, armed, and past its reset: time to send the continue turn. */
export function usageLimitResumeDue(session: Session, now: number): boolean {
  const limit = session.usageLimit;
  if (!limit?.resumeAtReset || limit.recoveryFrom || limit.resetsAt == null || session.busy) {
    return false;
  }
  return now >= limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS;
}
