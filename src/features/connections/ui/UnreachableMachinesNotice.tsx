import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { RefreshCw } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";

/**
 * One-row warning for a view that merges data from several machines when some did not answer.
 * Same shape as the workspace connection notice: sentence, Retry and the raw reasons behind Details.
 */
export function UnreachableMachinesNotice({
  message,
  detail,
  onRetry,
  retrying = false,
  disabled = false,
  className,
}: {
  /** Plain sentence naming the machines and what is affected. */
  message: string;
  /** Raw per-machine failure text. */
  detail?: string;
  onRetry: () => void;
  retrying?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={className} data-unreachable-machines-notice>
      <Alert tone="warning" inline>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="min-w-0">{message}</strong>
          <Button
            type="button"
            variant="primary"
            startIcon={<RefreshCw className="icon-sm" aria-hidden />}
            loading={retrying}
            disabled={disabled}
            onClick={onRetry}
          >
            {t("Retry")}
          </Button>
          {detail ? <ErrorDetails title={message} detail={detail} /> : null}
        </div>
      </Alert>
    </div>
  );
}
