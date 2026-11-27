import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { lastUserTurnStartIndex, userBlockRecall } from "../model/editLastTurn";
import { executionUserIndex } from "../model/executionTurn";
import { lastHandoffBlock } from "../model/handoff";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";
import type { Attachment, ComposerTurnOptions, Session } from "../model/session";

type RetryBlock = "not-sent" | "unsupported" | "attachments-missing";

function evaluateFailedTurn(session: Session):
  | {
      retry: {
        text: string;
        attachments: Attachment[];
        errorId: string;
        intent?: ComposerTurnOptions["intent"];
      };
    }
  | { blocked: RetryBlock; errorId: string }
  | null {
  const handoff = lastHandoffBlock(session.blocks)?.handoff;
  const retryingSwitch = handoff?.status === "failed" || handoff?.status === "cancelled";
  if (
    session.busy ||
    session.usageLimit ||
    session.pendingQuestion ||
    (session.pendingSwitch && !retryingSwitch) ||
    session.historyLoading ||
    session.historyLoadError ||
    session.adoptedSyncConflict ||
    session.continuingElsewhere ||
    session.worktreeRemoved ||
    session.inboxAsk ||
    session.editingQueuedMessageId ||
    session.queuedMessages?.length ||
    session.blocks.some((block) => block.draft)
  )
    return null;
  const last = lastUserTurnStartIndex(session.blocks);
  if (last < 0) return null;
  // A steer continues its prompt's turn: retry the prompt with everything sent during it.
  const start = session.blocks[last].continuationOf
    ? executionUserIndex(session.blocks.slice(0, last + 1))
    : last;
  if (start < 0) return null;
  const user = session.blocks[start];
  const sent = session.blocks
    .slice(start, last + 1)
    .filter(
      (block) =>
        block.role === "user" && !block.draft && !block.internal && !block.questionAnswers?.length,
    );
  const output = session.blocks.slice(start + 1);
  const error = [...output].reverse().find(isSessionErrorBlock);
  if (!error) return null;
  // Admission failed before the new user block existed. Its input belongs to
  // the composer/queue; retrying the last transcript user would replay an older request.
  if (/^Message not sent:/i.test(error.text.trim()))
    return { blocked: "not-sent", errorId: error.id };
  if (
    sessionErrorPresentation(error.text).usageLimit ||
    output.some(
      (block) => block.streaming || block.internal || (block.approval && !block.approval.decided),
    )
  )
    return null;
  // A completed answer after an error means this turn already recovered.
  const errorIndex = output.indexOf(error);
  if (
    output.slice(errorIndex + 1).some((block) => block.role === "assistant" && block.text.trim())
  ) {
    return null;
  }
  if (
    sent[0] !== user ||
    sent.some(
      (block) => block.remoteContent || block.secondOpinion || block.noteCard || block.ciContext,
    )
  )
    return { blocked: "unsupported", errorId: error.id };
  const recalls = sent.flatMap((block) => userBlockRecall(block) ?? []);
  const attachments = recalls.flatMap((recall) => recall.attachments);
  if (!recalls.length) return { blocked: "unsupported", errorId: error.id };
  if (attachments.some((attachment) => attachment.missing)) {
    return { blocked: "attachments-missing", errorId: error.id };
  }
  return {
    retry: {
      text: recalls.map((recall) => recall.text).join("\n\n"),
      attachments,
      errorId: error.id,
      intent: user.intent,
    },
  };
}

/** Retry only the latest submitted user turn with a provider error. */
export function failedTurnRetry(session: Session) {
  const result = evaluateFailedTurn(session);
  return result && "retry" in result ? result.retry : null;
}

type RetrySubmit = (
  text: string,
  attachments: Attachment[],
  options?: ComposerTurnOptions,
) => boolean | void;

/** Sends the retry; a rejection or a throw releases the button before it propagates. */
function submitRetry(
  onSubmit: RetrySubmit,
  retry: { text: string; attachments: Attachment[]; intent?: ComposerTurnOptions["intent"] },
  release: () => boolean,
) {
  try {
    if (
      onSubmit(retry.text, retry.attachments, {
        ...(retry.intent ? { intent: retry.intent } : {}),
        onSendRejected: release,
      }) === false
    )
      release();
  } catch (error) {
    release();
    throw error;
  }
}

/** The Retry a failure notice shows beside its reason. Absent when the turn cannot be resent. */
export type FailedTurnRecovery = {
  errorId: string;
  pending: boolean;
  retry: () => void;
};

const recoveries = new Map<string, FailedTurnRecovery>();
const recoveryListeners = new Set<() => void>();

function publishRecovery(errorId: string, next: FailedTurnRecovery | null) {
  const current = recoveries.get(errorId);
  if (current && next && current.pending === next.pending && current.retry === next.retry) return;
  if (next) recoveries.set(errorId, next);
  else if (!recoveries.delete(errorId)) return;
  for (const listener of recoveryListeners) listener();
}

function subscribeRecovery(listener: () => void) {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
}

/** The recovery bound to one error block, so its notice can show Retry beside the reason. */
export function useFailedTurnRecovery(errorId: string | undefined): FailedTurnRecovery | undefined {
  return useSyncExternalStore(
    subscribeRecovery,
    () => (errorId ? recoveries.get(errorId) : undefined),
    () => undefined,
  );
}

/**
 * Owns the retry safeguards (latest turn, attachments, held queue, one send in flight) and hands
 * the result to that turn's failure notice. It renders nothing itself: the notice shows the reason
 * and Retry in one place.
 */
export function RetryFailedTurn({
  session,
  blocked,
  onSubmit,
}: {
  session: Session;
  blocked?: boolean;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
}) {
  const [submitted, setSubmitted] = useState<string | null>(null);
  const submitting = useRef<string | null>(null);
  const evaluated = evaluateFailedTurn(session);
  const result = blocked || !evaluated || !("retry" in evaluated) ? null : evaluated;
  const errorId = result?.retry.errorId;
  const key = errorId ? `${session.id}:${errorId}` : undefined;
  const pending = !!key && submitted === key;
  const retry = useStableCallback(() => {
    if (!result || !key) return;
    if (submitting.current === key) return;
    const release = () => {
      if (submitting.current === key) submitting.current = null;
      setSubmitted((current) => (current === key ? null : current));
      return false;
    };
    submitting.current = key;
    setSubmitted(key);
    submitRetry(onSubmit, result.retry, release);
  });
  // Publishes the recovery to the notice of the error it belongs to: the notice and this
  // owner sit in different parts of the transcript tree, so a keyed store links them.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the current retry action in the recovery store while mounted
  useEffect(() => {
    if (!errorId) return;
    publishRecovery(errorId, { errorId, pending, retry });
    return () => publishRecovery(errorId, null);
  }, [errorId, pending, retry]);
  return null;
}
