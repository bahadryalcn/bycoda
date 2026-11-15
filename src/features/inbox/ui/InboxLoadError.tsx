import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails, fitsOneLine } from "../../../shared/ui/ErrorDetails";

export function InboxLoadError({
  error,
  retrying,
  disabled,
  onRetry,
}: {
  error: string;
  retrying: boolean;
  disabled: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const title = t("Could not load.");
  const short = fitsOneLine(error);
  return (
    <Alert
      tone="danger"
      title={title}
      action={{ label: t("Retry"), pending: retrying, disabled, onClick: onRetry }}
      extra={short ? undefined : <ErrorDetails title={title} detail={error} />}
    >
      {short ? <div className="wrap-anywhere">{error}</div> : null}
    </Alert>
  );
}
