import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails, fitsOneLine } from "../../../shared/ui/ErrorDetails";
import type { NoticeAction } from "../../../shared/ui/Notice";
import type { RemoteErrorView } from "../model/remoteFailure";

/**
 * Boxed failure of an action the user started (a dialog's save, a launch, a folder listing), as
 * `describeRemoteError` presents it: the localized sentence is visible and the raw Host or transport
 * text sits behind Details, only when it adds something. The caller keeps drafts and Retry.
 * Pass `title` (what could not be done) so a raw native message never becomes the headline: the
 * sentence is then the reason, and a long raw message waits behind Details alone (a one-line one is shown as the reason).
 * `action` is the one recovery step (Try again).
 * A failed read in a row or field uses InlineError with `details` instead.
 */
export function RemoteActionError({
  error,
  title,
  action,
  className,
}: {
  error: RemoteErrorView;
  title?: string;
  action?: NoticeAction;
  className?: string;
}) {
  // RemoteErrorView.message is already the localized sentence from describeRemoteError.
  const { message: sentence, details } = error;
  const raw = details && details !== sentence;
  const rawOnly = Boolean(title && details && details === sentence && !fitsOneLine(details));
  return (
    <Alert
      tone="danger"
      title={title}
      className={className}
      action={action}
      extra={
        raw || rawOnly ? (
          <ErrorDetails title={title ?? sentence} detail={details ?? sentence} />
        ) : undefined
      }
    >
      {rawOnly ? null : sentence}
    </Alert>
  );
}
