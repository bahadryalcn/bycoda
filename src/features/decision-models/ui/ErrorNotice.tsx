import { t } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { errorDetail } from "../model/decisionView";

/**
 * Plain message first; the raw error text stays behind the "Details" popover. `title` says what
 * failed ("Could not load the routing."); without it the generic sentence is shown.
 */
export function ErrorNotice({
  error,
  onRetry,
  retrying = false,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return (
    <InlineError
      className="min-w-0"
      details={errorDetail(error)}
      retry={onRetry ? { onRetry, label: t("Try again"), pending: retrying } : undefined}
    >
      {title ?? t("This did not work. Try again.")}
    </InlineError>
  );
}
