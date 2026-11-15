import { t } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { errorDetail } from "../model/decisionView";

/** Plain message first; the raw error text stays behind the "Details" popover. */
export function ErrorNotice({
  error,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <InlineError
      className="min-w-0"
      details={errorDetail(error)}
      retry={onRetry ? { onRetry, label: t("Try again"), pending: retrying } : undefined}
    >
      {t("This did not work. Try again.")}
    </InlineError>
  );
}
