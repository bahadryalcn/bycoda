import { createContext, useContext, type ComponentProps } from "react";
import { useT } from "../../../shared/i18n";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import type { Block } from "../model/session";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";
import {
  isMissingPathError,
  isSessionErrorBlock,
  REMOVED_WORKTREE_ERROR,
} from "../model/sessionIssue";
import { useFailedTurnRecovery } from "./RetryFailedTurn";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";
import { UsageLimitNotice } from "./UsageLimitNotice";

export type UsageLimitRecovery = {
  errorId: string;
  notice: ComponentProps<typeof UsageLimitNotice>;
};
export const UsageLimitRecoveryContext = createContext<UsageLimitRecovery | undefined>(undefined);

/** An active limit belongs to the last failed turn, never an older quota error. */
export function usageLimitFailureId(blocks: readonly Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.role === "user" && !block.draft && !block.internal) return undefined;
    if (isSessionErrorBlock(block)) {
      return sessionErrorPresentation(block.text).usageLimit ? block.id : undefined;
    }
  }
  return undefined;
}

/**
 * The one transcript failure notice: the reason once, with Retry beside it when the turn can be
 * resent. Protocol diagnostics stay behind Details.
 */
export function SessionErrorNotice({ text, errorId }: { text: string; errorId?: string }) {
  const t = useT();
  const recovery = useFailedTurnRecovery(errorId);
  const usageLimitRecovery = useContext(UsageLimitRecoveryContext);
  if (text === REMOVED_WORKTREE_ERROR) text = t("Worktree unavailable");
  const message = sessionErrorPresentation(text);
  const missingPath = isMissingPathError(text);
  const detail = message.detail ?? (missingPath || !fitsOneLine(text) ? text : undefined);
  const summary = errorHeadline(
    !missingPath && message.summary ? message.summary : t("The last turn failed"),
  );
  const title = message.usageLimit ? t("Usage limit reached") : summary;
  const details = detail ? <ErrorDetails title={title} detail={detail} /> : undefined;
  if (message.usageLimit) {
    if (usageLimitRecovery && usageLimitRecovery.errorId === errorId) {
      return (
        <UsageLimitNotice
          {...usageLimitRecovery.notice}
          details={details}
          providerSummary={message.summary ? errorHeadline(message.summary) : undefined}
        />
      );
    }
    return (
      <TranscriptNotice
        kind="warning"
        title={title}
        detail={message.summary ? errorHeadline(message.summary) : undefined}
        extra={details}
      />
    );
  }
  return (
    <TranscriptNotice
      kind="error"
      title={summary}
      extra={details}
      actions={
        recovery ? (
          <NoticeActionButton
            action={{ label: t("Retry"), onClick: recovery.retry, pending: recovery.pending }}
          />
        ) : undefined
      }
      data-retry-failed-turn={recovery ? "" : undefined}
    />
  );
}
