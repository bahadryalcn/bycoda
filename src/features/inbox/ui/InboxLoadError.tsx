import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
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
      action={
        <>
          {short ? null : <ErrorDetails title={title} detail={error} />}
          <Button loading={retrying} disabled={disabled} onClick={onRetry}>
            {t("Retry")}
          </Button>
        </>
      }
    >
      {short ? <div className="wrap-anywhere">{error}</div> : null}
    </Alert>
  );
}
