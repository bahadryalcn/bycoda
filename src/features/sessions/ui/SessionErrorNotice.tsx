import { useT } from "../../../shared/i18n";
import { ErrorDetails, errorHeadline, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Text } from "../../../shared/ui/Text";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";

/** Transcript failure copy; protocol diagnostics stay available without dominating the conversation. */
export function SessionErrorNotice({ text }: { text: string }) {
  const t = useT();
  const message = sessionErrorPresentation(text);
  const detail = message.detail ?? (!fitsOneLine(text) ? text : undefined);
  const summary = errorHeadline(message.summary || t("The last turn failed"));
  const title = message.usageLimit ? t("Usage limit reached") : summary;
  const details = detail ? (
    <ErrorDetails title={title} label={t("Technical details")} detail={detail} />
  ) : undefined;
  if (message.usageLimit) {
    return (
      <InlineMessage tone="warning" action={details}>
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
    <InlineError text={{ tone: "primary" }} action={details}>
      {summary}
    </InlineError>
  );
}
