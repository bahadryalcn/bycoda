import { useT } from "../../../shared/i18n";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import type { Block } from "../model/session";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";
import { isSessionErrorBlock } from "../model/sessionIssue";
import { useFailedTurnRecovery } from "./RetryFailedTurn";
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
 * resent. Protocol diagnostics stay behind Technical details.
 */
export function SessionErrorNotice({ text, errorId }: { text: string; errorId?: string }) {
  const t = useT();
  const recovery = useFailedTurnRecovery(errorId);
  const usageLimitRecovery = useContext(UsageLimitRecoveryContext);
  const message = sessionErrorPresentation(text);
  const detail = message.detail ?? (!fitsOneLine(text) ? text : undefined);
  const summary = errorHeadline(message.summary || t("The last turn failed"));
  const title = message.usageLimit ? t("Usage limit reached") : summary;
  const details = detail ? (
    <ErrorDetails title={title} label={t("Technical details")} detail={detail} />
  ) : undefined;
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
      <InlineMessage tone="warning" extra={details}>
        <Text as="span" size="caption" tone="primary" weight="medium">
          {title}
        </Text>
        {message.summary ? (
          <Text as="span" size="caption" tone="secondary">
            {" "}
            {errorHeadline(message.summary)}
          </Text>
        ) : null}
      </InlineMessage>
    );
  }
  return (
    <InlineError
      text={{ tone: "primary" }}
      extra={details}
      retry={
        recovery
          ? { onRetry: recovery.retry, label: t("Retry"), pending: recovery.pending }
          : undefined
      }
      data-retry-failed-turn={recovery ? "" : undefined}
    >
      {summary}
    </InlineError>
  );
}
import { createContext, useContext, type ComponentProps } from "react";
