import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";

/** A quiet centred line above the first turn, not a card: it is a state of the page, not an event. */
const LINE = "justify-center [&>span:last-child]:flex-none";

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
      <InlineError
        className={LINE}
        inset="panel"
        retry={onRetryLoad ? { label: t("Retry"), onRetry: onRetryLoad } : undefined}
      >
        {initial
          ? t("This conversation could not be loaded.")
          : t("Earlier messages could not be loaded.")}
      </InlineError>
    );
  if (pageError)
    return (
      <InlineError
        className={LINE}
        inset="panel"
        retry={onRetryPage ? { label: t("Retry"), onRetry: onRetryPage } : undefined}
      >
        {pageError}
      </InlineError>
    );
  if (loading)
    return (
      <LoadingText className={LINE} inset="panel">
        {initial ? t("Loading conversation…") : t("Loading earlier messages…")}
      </LoadingText>
    );
  return null;
}
