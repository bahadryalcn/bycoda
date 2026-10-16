import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { lastTurnRecall, lastUserTurnStartIndex } from "../model/editLastTurn";
import { isSessionErrorBlock } from "../model/sessionIssue";
import type { Attachment, ComposerTurnOptions, Session } from "../model/session";

/** Retry only the latest submitted user turn with a provider error. */
export function failedTurnRetry(session: Session) {
  if (
    session.busy ||
    session.pendingQuestion ||
    session.pendingSwitch ||
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
  const start = lastUserTurnStartIndex(session.blocks);
  if (start < 0) return null;
  const user = session.blocks[start];
  if (user.remoteContent || user.secondOpinion || user.noteCard || user.ciContext) return null;
  const output = session.blocks.slice(start + 1);
  const error = [...output].reverse().find(isSessionErrorBlock);
  if (
    !error ||
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
  const recall = lastTurnRecall(session);
  return recall && !recall.attachments.some((attachment) => attachment.missing)
    ? { ...recall, errorId: error.id, intent: user.intent }
    : null;
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
  useLocale();
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
    <div className="[padding-inline:1rem] [padding-block:0.5rem]" data-retry-failed-turn>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        motion="none"
        disabled={submitted === key}
        onClick={() => {
          if (submitting.current === key) return;
          submitting.current = key;
          setSubmitted(key);
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
        }}
      >
        {t("Retry")}
      </Button>
    </div>
  );
}
