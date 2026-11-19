/**
 * Review status failures and the bounded wait for a recording checkpoint.
 *
 * The Host and the native store append a typed marker to these two errors.
 * Their legacy English text stays recognized so an older Host (or a newer
 * client talking to one) keeps working.
 */
export const CHECKPOINT_RECORDING_CODE = "CHECKPOINT_RECORDING";
export const CHECKPOINT_FAILED_CODE = "CHECKPOINT_FAILED";

const LEGACY_RECORDING = "Workspace checkpoint is still recording this turn";
const LEGACY_FAILED = "Workspace checkpoint failed:";

/** "recording": the turn is still being captured; "failed": its saved checkpoint is unusable. */
export type CheckpointFailureKind = "recording" | "failed" | "other";

/** idle: not waiting; waiting: polling with backoff; stalled: attempts spent, needs an explicit refresh. */
export type RecordingPhase = "idle" | "waiting" | "stalled";

/** First poll after 1 s, doubling to 8 s, at most 8 polls (about 47 s of visible time). */
export const RECORDING_POLL = { baseMs: 1000, maxMs: 8000, maxAttempts: 8 } as const;

/** Delay before poll number `attempt` (0-based). */
export function recordingPollDelay(attempt: number): number {
  return Math.min(RECORDING_POLL.baseMs * 2 ** Math.max(0, attempt), RECORDING_POLL.maxMs);
}

function failureText(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string")
    return cause.message;
  return String(cause);
}

/** Sorts a rejected `sessionCheckpointStatus` call by its typed code, falling back to legacy text. */
export function classifyCheckpointFailure(cause: unknown): CheckpointFailureKind {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  const text = failureText(cause);
  if (
    code === CHECKPOINT_RECORDING_CODE ||
    text.includes(`[${CHECKPOINT_RECORDING_CODE}]`) ||
    text.includes(LEGACY_RECORDING)
  )
    return "recording";
  if (
    code === CHECKPOINT_FAILED_CODE ||
    text.includes(`[${CHECKPOINT_FAILED_CODE}]`) ||
    text.replace(/^(?:Error: )?(?:Host rejected request:\s*)?/i, "").startsWith(LEGACY_FAILED)
  )
    return "failed";
  return "other";
}
