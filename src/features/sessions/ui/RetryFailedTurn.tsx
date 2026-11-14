import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { lastUserTurnStartIndex, userBlockRecall } from "../model/editLastTurn";
import { executionUserIndex } from "../model/executionTurn";
import { lastHandoffBlock } from "../model/handoff";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";
import type { Attachment, ComposerTurnOptions, Session } from "../model/session";

/** Retry only the latest submitted user turn with a provider error. */
export function failedTurnRetry(session: Session) {
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
  if (
    sent[0] !== user ||
    sent.some(
      (block) => block.remoteContent || block.secondOpinion || block.noteCard || block.ciContext,
    )
  )
    return null;
  const output = session.blocks.slice(start + 1);
  const error = [...output].reverse().find(isSessionErrorBlock);
  if (
    !error ||
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
  const recalls = sent.flatMap((block) => userBlockRecall(block) ?? []);
  const attachments = recalls.flatMap((recall) => recall.attachments);
  if (!recalls.length || attachments.some((attachment) => attachment.missing)) return null;
  return {
    text: recalls.map((recall) => recall.text).join("\n\n"),
    attachments,
    errorId: error.id,
    intent: user.intent,
  };
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
  const t = useT();
  const [submitted, setSubmitted] = useState<string | null>(null);
  const submitting = useRef<string | null>(null);
  const retry = failedTurnRetry(session);
  if (!retry || blocked) return null;
  const key = `${session.id}:${retry.errorId}`;
  const release = () => {
    if (submitting.current === key) submitting.current = null;
    setSubmitted((current) => (current === key ? null : current));
    return false;
  };
  return (
    <div className="px-4 py-1" data-retry-failed-turn>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        motion="none"
        loading={submitted === key}
        onClick={() => {
          if (submitting.current === key) return;
          submitting.current = key;
          setSubmitted(key);
          submitRetry(onSubmit, retry, release);
        }}
      >
        {t("Retry")}
      </Button>
    </div>
  );
}
