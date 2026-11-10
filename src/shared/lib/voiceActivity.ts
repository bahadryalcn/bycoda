import { elapsedSince, monotonicNow } from "./time/timestamps";

/** Hosts ignore voice activity older than this, so older speech is never reported. */
export const VOICE_ACTIVITY_REPORT_WINDOW_MS = 2 * 60_000;
/** The Host is told about continuing speech at most this often. */
export const VOICE_ACTIVITY_REPORT_INTERVAL_MS = 30_000;

let acceptedAt: number | undefined;
let reportedAt: number | undefined;

/** Records accepted owner speech (never rejected candidates or raw audio level). */
export function noteVoiceActivity(now = monotonicNow()): void {
  acceptedAt = now;
}

/** Age of the last accepted speech to report to the Host, or undefined when stale or just reported. */
export function takeVoiceActivityReport(now = monotonicNow()): number | undefined {
  if (acceptedAt === undefined) return undefined;
  const age = elapsedSince(acceptedAt, now);
  if (age >= VOICE_ACTIVITY_REPORT_WINDOW_MS) return undefined;
  if (reportedAt !== undefined && reportedAt >= acceptedAt) return undefined;
  if (reportedAt !== undefined && elapsedSince(reportedAt, now) < VOICE_ACTIVITY_REPORT_INTERVAL_MS)
    return undefined;
  reportedAt = now;
  return age;
}

export function resetVoiceActivityForTest(): void {
  acceptedAt = undefined;
  reportedAt = undefined;
}
