import { createDedupedWarn } from "../diagnostics/log-dedupe";

/** A session write whose revision does not extend the persisted-or-pending head by exactly
 * one. Raised before anything is buffered or inserted, so a refused write leaves no trace. */
export class SessionRevisionConflictError extends Error {
  readonly code = "SESSION_REVISION_CONFLICT";
  constructor(
    readonly sessionId: string,
    readonly headRevision: number,
    readonly attemptedRevision: number,
  ) {
    super(
      `Session ${sessionId} write refused: revision ${attemptedRevision} does not follow head revision ${headRevision}.`,
    );
    this.name = "SessionRevisionConflictError";
  }
}

/** The single revision rule for session writes; `head` is undefined for a first write. */
export function assertNextRevision(
  sessionId: string,
  head: number | undefined,
  attempted: number,
): void {
  if (head !== undefined && attempted !== head + 1)
    throw new SessionRevisionConflictError(sessionId, head, attempted);
}

/** SQLite rejected a row for a constraint: repeating the identical write cannot succeed. */
export function isStorageConstraintFailure(error: unknown): boolean {
  return /constraint failed/i.test(String((error as { message?: unknown } | null)?.message ?? ""));
}

const RETRY_CAP_MS = 60_000;

/** Delay before retry number `failures` (zero-based) of a failed session write. */
export function persistenceRetryDelay(failures: number, base = 1_000): number {
  return Math.min(RETRY_CAP_MS, base * 2 ** Math.min(Math.max(failures, 0), 16));
}

/** Error-level sink for persistence failures that repeat: one line per message and window. */
export const reportPersistenceFailure = createDedupedWarn({
  write: (line) => console.error(line),
});
