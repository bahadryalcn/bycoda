import { monotonicNow } from "./timestamps";

/**
 * Local monotonic deadline for a lifetime the Host reported (a control lease or a review
 * plan). The Host sends how long the lease or plan lasts from its own reading, never its
 * wall-clock end time, because this client's clock may disagree with the Host's.
 *
 * `sentAt` must be taken before the request leaves. The Host measures its lifetime after it
 * receives the request, so the deadline here is never later than the Host's own end: a
 * client can give up early, never keep authority the Host has already ended.
 */
export function hostLifetimeDeadline(lifetimeMs: number, sentAt: number = monotonicNow()): number {
  return sentAt + Math.max(0, lifetimeMs);
}

/** Milliseconds left until a `hostLifetimeDeadline` value; never negative. */
export const remainingUntil = (deadline: number, now: number = monotonicNow()): number =>
  Math.max(0, deadline - now);
