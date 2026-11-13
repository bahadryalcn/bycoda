import { useT } from "../../../shared/i18n";
import { ErrorDetails, errorHeadline } from "../../../shared/ui/ErrorDetails";
import { InlineError } from "../../../shared/ui/InlineError";
import { sessionErrorPresentation } from "../model/sessionErrorPresentation";

/** Transcript failure copy; protocol diagnostics stay available without dominating the conversation. */
export function SessionErrorNotice({ text }: { text: string }) {
  const t = useT();
  const message = sessionErrorPresentation(text);
  const summary = message.detail
    ? errorHeadline(message.summary ?? t("The last turn failed"))
    : message.summary;
  return (
    <InlineError
      action={
        message.detail ? (
          <ErrorDetails title={summary} label={t("Technical details")} detail={message.detail} />
        ) : undefined
      }
    >
      {summary}
    </InlineError>
  );
}
