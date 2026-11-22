import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { classifyRemoteError } from "./remoteFailure";

/** What a failed read of a remote queue was, in a form that stays the same across wordings. */
export type QueueReadFailure = {
  machineId: string;
  environmentId: string;
  sessionId: string;
  operation: "queue.read";
  /** Local time this failure was first seen (not when the card was exported). */
  at: number;
  /** `QUEUE_READ_<KIND>`, from the shared remote failure classes. */
  code: string;
  /** A busy or unreachable machine may answer on a later read; anything else needs the owner. */
  transient: boolean;
  /** The reason, as the host or transport gave it. */
  message: string;
};

export function classifyQueueReadFailure(
  error: string,
  context: Pick<QueueReadFailure, "machineId" | "environmentId" | "sessionId" | "at">,
): QueueReadFailure {
  const failure = classifyRemoteError(error);
  return {
    ...context,
    operation: "queue.read",
    code: `QUEUE_READ_${failure.kind.toUpperCase()}`,
    transient: failure.kind === "temporary" || failure.kind === "unreachable",
    message: failure.message,
  };
}

/** Technical lines for the card's Details and for the notification history. */
export function queueReadFailureDetail(failure: QueueReadFailure, machineName?: string): string {
  return [
    `machine: ${machineName ?? failure.machineId}`,
    `environment: ${failure.environmentId}`,
    `session: ${failure.sessionId}`,
    `operation: ${failure.operation}`,
    `time: ${isoTimestamp(failure.at) ?? ""}`,
    `code: ${failure.code}`,
    `reason: ${failure.message}`,
  ].join("\n");
}
