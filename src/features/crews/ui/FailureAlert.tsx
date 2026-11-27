import { Alert, type AlertTone } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";

/** A failed crew or orchestration action: a translated title, the raw Host text behind Details. */
export function FailureAlert({
  title,
  detail,
  tone = "danger",
  action,
  className,
}: {
  title: string;
  detail: string | undefined;
  tone?: AlertTone;
  /** One recovery link after the copy, such as Retry. */
  action?: { label: string; onClick: () => void; disabled?: boolean; pending?: boolean };
  className?: string;
}) {
  return (
    <Alert
      tone={tone}
      title={title}
      className={className}
      action={action}
      extra={
        detail && detail !== title ? <ErrorDetails title={title} detail={detail} /> : undefined
      }
    />
  );
}
