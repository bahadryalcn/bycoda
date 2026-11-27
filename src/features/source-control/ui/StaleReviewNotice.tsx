import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n/git";

/**
 * A background refresh of a changes review failed while an earlier result is still on screen.
 * The review stays readable; the notice names the failure and retries the refresh in place, so
 * scroll position, expanded files and focus survive. A machine connection failure renders nothing
 * while the central connection notice explains it.
 */
export function StaleReviewNotice({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT();
  return (
    <InlineError
      inset="row"
      className="shrink-0"
      details={error}
      retry={{ onRetry, label: t("Retry refresh") }}
    >
      {t("Couldn’t refresh. Showing the last available snapshot.")}
    </InlineError>
  );
}
