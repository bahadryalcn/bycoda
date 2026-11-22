import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";

/** Plain title and one Try again; the raw error text only ever sits behind Details. */
export function InboxLoadError({
  error,
  title,
  retrying = false,
  disabled = false,
  onRetry,
}: {
  error: string;
  /** What happened, translated. Defaults to "Could not load." */
  title?: string;
  retrying?: boolean;
  disabled?: boolean;
  /** Omit when the read cannot be retried from here. */
  onRetry?: () => void;
}) {
  const t = useT();
  const heading = title ?? t("Could not load.");
  return (
    <Alert
      tone="danger"
      title={heading}
      action={
        onRetry ? { label: t("Try again"), pending: retrying, disabled, onClick: onRetry } : undefined
      }
      extra={<ErrorDetails title={heading} detail={error} />}
    />
  );
}
