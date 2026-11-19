import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { LoadingText } from "../../../shared/ui/LoadingText";

type TranscriptHistoryNoticeProps = {
  /** Nothing is on screen yet, so the first read is the one loading or failing, not an older page. */
  initial: boolean;
  loading: boolean;
  /** The stored conversation could not be read in full. */
  loadFailed: boolean;
  /** A later page request failed; the message already says why. */
  pageError?: string;
  onRetryLoad?: () => void;
  onRetryPage?: () => void;
};

/**
 * The one history message at the top of a transcript: a failure with its Retry, or the wait. A failed
 * read wins over a failed page, and neither shows beside a spinner, so a single state is on screen.
 * Retrying clears the failure on its own; loaded turns, the cursor and the scroll stay where they are.
 */
export function TranscriptHistoryNotice({
  initial,
  loading,
  loadFailed,
  pageError,
  onRetryLoad,
  onRetryPage,
}: TranscriptHistoryNoticeProps) {
  const t = useT();
  if (loadFailed)
    return (
      <Alert
        tone="danger"
        action={onRetryLoad ? { label: t("Retry"), onClick: onRetryLoad } : undefined}
      >
        {initial
          ? t("This conversation could not be loaded.")
          : t("Earlier messages could not be loaded.")}
      </Alert>
    );
  if (pageError)
    return (
      <Alert
        tone="danger"
        action={onRetryPage ? { label: t("Retry"), onClick: onRetryPage } : undefined}
      >
        {pageError}
      </Alert>
    );
  if (loading)
    return (
      <LoadingText className="px-4 py-3">
        {initial ? t("Loading conversation…") : t("Loading earlier messages…")}
      </LoadingText>
    );
  return null;
}
