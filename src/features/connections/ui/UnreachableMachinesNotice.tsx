import { InlineMessage } from "../../../shared/ui/InlineError";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
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
      <InlineMessage
        tone="warning"
        retry={{ onRetry, label: t("Retry"), pending: retrying, disabled }}
        extra={detail ? <ErrorDetails title={message} detail={detail} /> : undefined}
      >
        <strong>{message}</strong>
      </InlineMessage>
    </div>
  );
}
