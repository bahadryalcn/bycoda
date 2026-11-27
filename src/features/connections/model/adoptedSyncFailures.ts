import { redactDiagnosticText } from "@bycoda/account-contracts";
import { errorText } from "../../../shared/lib/errors";
import { recordUiLog } from "../../diagnostics/public/uiLog";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import type { AdoptedEntry } from "./adoptedSessions";
import { remoteBackoffDelay } from "./remotePollingPolicy";

/** Failed passes in a row before a session is reported as unable to sync: one slow pass is
 * normal, a session that keeps failing is not. */
export const ADOPTED_SYNC_FAILURE_FLAG_AFTER = 3;

/** A session whose last fetch or merge failed, and when. `revision` is the host revision it
 * failed at: a moved revision is a new chance and is never held back by the backoff. */
type SyncFailure = { count: number; revision: number; at: number; delay: number; reason: string };
const syncFailures = new WeakMap<Map<string, number>, Map<string, SyncFailure>>();

function failuresOf(mirror: Map<string, number>): Map<string, SyncFailure> {
  let failures = syncFailures.get(mirror);
  if (!failures) syncFailures.set(mirror, (failures = new Map()));
  return failures;
}

/** Whether this session failed at this host revision and is still inside its backoff, so it
 * is not fetched again yet. Every other session is fetched on the pass as before. */
export function backingOff(mirror: Map<string, number>, entry: AdoptedEntry): boolean {
  const failure = syncFailures.get(mirror)?.get(entry.id);
  return (
    !!failure && failure.revision === entry.revision && elapsedSince(failure.at) < failure.delay
  );
}

/** Whether this session keeps failing at its current host revision. The Sync row names it and
 * the mirror stops polling faster for it, instead of re-fetching it on every short pass. */
export function adoptedSyncFailing(mirror: Map<string, number>, entry: AdoptedEntry): boolean {
  const failure = syncFailures.get(mirror)?.get(entry.id);
  return (
    !!failure &&
    failure.revision === entry.revision &&
    failure.count >= ADOPTED_SYNC_FAILURE_FLAG_AFTER
  );
}

export function adoptedSyncFailureReason(
  mirror: Map<string, number>,
  entry: AdoptedEntry,
): string | undefined {
  if (adoptedSyncFailing(mirror, entry)) return syncFailures.get(mirror)?.get(entry.id)?.reason;
  return undefined;
}

/** Records one failed pass of a session: backs off its next fetch, and logs once when it has
 * failed enough passes in a row. The text is redacted and bounded before it is logged. */
export function noteSyncFailure(
  mirror: Map<string, number>,
  entry: AdoptedEntry,
  error: unknown,
  scope: "open" | "closed",
): number {
  const failures = failuresOf(mirror);
  const count = (failures.get(entry.id)?.count ?? 0) + 1;
  const reason = truncateGraphemes(redactDiagnosticText(errorText(error)), 200);
  failures.set(entry.id, {
    count,
    revision: entry.revision,
    at: monotonicNow(),
    delay: remoteBackoffDelay(count),
    reason,
  });
  if (count === ADOPTED_SYNC_FAILURE_FLAG_AFTER) {
    recordUiLog("warn", "ui.adopted", "adopted session could not sync", {
      scope,
      failures: count,
      error: reason,
    });
  }
  return count;
}

/** A session that merged, or was judged, on this pass: its failure streak is over. */
export function clearSyncFailure(mirror: Map<string, number>, id: string): void {
  syncFailures.get(mirror)?.delete(id);
}

/** An explicit wake (focus, a recovered Host, a changed machine) is a new chance for every
 * failed session: its backoff ends now. The streak is kept, so a session that keeps failing
 * still reaches the Sync row and logs once instead of starting its count over. */
export function releaseSyncBackoff(mirror: Map<string, number>): void {
  for (const failure of syncFailures.get(mirror)?.values() ?? []) failure.delay = 0;
}

/** Forgets sessions the host no longer lists. */
export function pruneSyncFailures(mirror: Map<string, number>, liveIds: ReadonlySet<string>): void {
  const failures = failuresOf(mirror);
  for (const id of failures.keys()) if (!liveIds.has(id)) failures.delete(id);
}
