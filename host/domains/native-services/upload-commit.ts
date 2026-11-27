import { TimeoutError, withTimeout } from "../../../src/shared/lib/withTimeout";

/** Bounds for a native upload commit. After `deadlineMs` the receipt becomes a final
 * "unknown" outcome while the staging bytes and quota stay charged for `holdMs`, because
 * the operation promise may still be running; a late settlement releases them early. */
export const NATIVE_UPLOAD_COMMIT_LIMITS = Object.freeze({
  deadlineMs: 60_000,
  holdMs: 600_000,
});

/** Resolves true when the deadline passed before the operation settled, false when it
 * settled first. Never rejects: `operation` must already handle its own failures, and
 * it keeps running after a deadline (a bounded wait never cancels or replays it). */
export async function commitDeadlineElapsed(
  operation: Promise<void>,
  deadlineMs: number,
): Promise<boolean> {
  try {
    await withTimeout(operation, deadlineMs, "Native upload commit");
    return false;
  } catch (error) {
    return error instanceof TimeoutError;
  }
}
