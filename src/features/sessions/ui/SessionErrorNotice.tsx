import { useT } from "../../../shared/i18n";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";
import { useFailedTurnRecovery } from "./RetryFailedTurn";

/**
 * The one transcript failure notice: the reason once, with Retry beside it when the turn can be
 * resent. Protocol diagnostics stay behind Technical details.
 */
export function SessionErrorNotice({ text, errorId }: { text: string; errorId?: string }) {
  const t = useT();
  const recovery = useFailedTurnRecovery(errorId);
  const message = sessionErrorPresentation(text);
  const detail = message.detail ?? (!fitsOneLine(text) ? text : undefined);
  const summary = errorHeadline(message.summary || t("The last turn failed"));
  const title = message.usageLimit ? t("Usage limit reached") : summary;
  const details = detail ? (
    <ErrorDetails title={title} label={t("Technical details")} detail={detail} />
  ) : undefined;
  if (message.usageLimit) {
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
