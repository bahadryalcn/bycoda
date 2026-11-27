import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";

export function QuestionAttachmentError({
  message,
  blocked,
  retry,
}: {
  message: string | null;
  blocked: boolean;
  retry: () => void;
}) {
  const t = useT();
  if (!message) return null;
  return (
    <InlineError retry={blocked ? { onRetry: retry, label: t("Retry") } : undefined}>
      {message}
    </InlineError>
  );
}
