import { t } from "../../../shared/i18n";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
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
    <DetailedInlineError
      className="min-w-0"
      summary={t("This did not work. Try again.")}
      error={errorDetail(error)}
      retry={onRetry ? { onRetry, label: t("Try again"), pending: retrying } : undefined}
    />
  );
}
