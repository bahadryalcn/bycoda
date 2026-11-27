import { Toast } from "../../../shared/ui/ToastRegion";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { t, useLocale } from "../../../shared/i18n/technical";

export function FileActionError({
  details,
  onDismiss,
}: {
  details: string;
  onDismiss: () => void;
}) {
  useLocale();
  // Shared notice: portalled to the body so a transformed or contained
  // ancestor cannot clip it. Routine file errors dismiss themselves.
  const title = t("Couldn’t open the file in its default app");
  return (
    <Toast
      tone="danger"
      message={title}
      extra={<ErrorDetails title={title} detail={details} />}
      onDismiss={onDismiss}
    />
  );
}
