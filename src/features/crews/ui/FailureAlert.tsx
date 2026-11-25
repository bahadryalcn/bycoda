import { Alert, type AlertTone } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";

/** A failed crew or orchestration action: a translated title, the raw Host text behind Details. */
export function FailureAlert({
  title,
  detail,
  tone = "danger",
}: {
  title: string;
  detail: string;
  tone?: AlertTone;
}) {
  return (
    <Alert
      tone={tone}
      title={title}
      extra={
        detail && detail !== title ? <ErrorDetails title={title} detail={detail} /> : undefined
      }
    />
  );
}
