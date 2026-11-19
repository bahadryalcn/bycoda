import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import type { RemoteErrorView } from "../model/remoteFailure";

/**
 * Boxed failure of an action the user started (a dialog's save, a launch, a folder listing), as
 * `describeRemoteError` presents it: the localized sentence is visible and the raw Host or transport
 * text sits behind Details, only when it adds something. The caller keeps drafts and Retry.
 * A failed read in a row or field uses InlineError with `details` instead.
 */
export function RemoteActionError({
  error,
  className,
}: {
  error: RemoteErrorView;
  className?: string;
}) {
  return (
    <Alert
      tone="danger"
      className={className}
      extra={
        error.details && error.details !== error.message ? (
          <ErrorDetails title={error.message} detail={error.details} />
        ) : undefined
      }
    >
      {error.message}
    </Alert>
  );
}
