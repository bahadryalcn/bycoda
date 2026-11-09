import type { ApprovalDecision } from "../core/types";
import { createApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";

export type PendingApprovalOutcome = ApprovalDecision | "cancelled";
export type ApprovalActualWriteObserver = (actual: Promise<void>) => void;

/** The original source request remains owned until all of its actual writes drain. */
export type PendingApproval = ((decision: PendingApprovalOutcome) => void) & {
  occurrenceId: string;
  invalidated: boolean;
  owners: number;
  decision: Promise<PendingApprovalOutcome>;
  report: (decision: PendingApprovalOutcome) => void;
};

export function createPendingApproval(
  emitResolution: (occurrenceId: string, decision: PendingApprovalOutcome) => void,
): PendingApproval {
  const occurrenceId = createApprovalOccurrenceId();
  let resolve!: (decision: PendingApprovalOutcome) => void;
  let reported: PendingApprovalOutcome | undefined;
  const decision = new Promise<PendingApprovalOutcome>((done) => {
    resolve = done;
  });
  const pending: PendingApproval = Object.assign(
    (value: PendingApprovalOutcome) => resolve(pending.invalidated ? "cancelled" : value),
    {
      occurrenceId,
      invalidated: false,
      owners: 1,
      decision,
      report: (value: PendingApprovalOutcome) => {
        const actual = pending.invalidated ? "cancelled" : value;
        if (reported === actual) return;
        reported = actual;
        emitResolution(occurrenceId, actual);
      },
    },
  );
  return pending;
}

export function releasePendingApproval(
  approvals: Map<number, PendingApproval>,
  requestId: number,
  pending: PendingApproval,
): void {
  pending.owners -= 1;
  if (pending.owners === 0 && approvals.get(requestId) === pending) approvals.delete(requestId);
}

export function observePendingApprovalWrite(
  approvals: Map<number, PendingApproval>,
  requestId: number,
  pending: PendingApproval,
): ApprovalActualWriteObserver {
  return (actual) => {
    pending.owners += 1;
    // Observe both settlements without creating an unhandled rejected continuation.
    void actual.then(
      () => releasePendingApproval(approvals, requestId, pending),
      () => releasePendingApproval(approvals, requestId, pending),
    );
  };
}

export function cancelPendingApprovals(approvals: Map<number, PendingApproval>): void {
  for (const pending of approvals.values()) {
    pending.invalidated = true;
    pending("cancelled");
    pending.report("cancelled");
  }
}

/** Synchronous admission: callers must not await a no-conflict result before installing a row. */
export function rejectOverlappingApproval(
  approvals: Map<number, PendingApproval>,
  requestId: number,
  writeCancellation: (onActualWrite: ApprovalActualWriteObserver) => Promise<void>,
): Promise<void> | undefined {
  const pending = approvals.get(requestId);
  if (!pending) return;
  pending.owners += 1;
  try {
    pending.invalidated = true;
    pending("cancelled");
    pending.report("cancelled");
    return writeCancellation(observePendingApprovalWrite(approvals, requestId, pending)).finally(
      () => releasePendingApproval(approvals, requestId, pending),
    );
  } catch (error) {
    releasePendingApproval(approvals, requestId, pending);
    throw error;
  }
}

export function ownsPendingApproval(
  approvals: Map<number, PendingApproval>,
  requestId: number,
  pending: PendingApproval,
): boolean {
  return approvals.get(requestId) === pending && !pending.invalidated;
}
