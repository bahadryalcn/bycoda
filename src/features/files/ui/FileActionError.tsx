import { Toast } from "../../../shared/ui/ToastRegion";
import { useLocale } from "../../../shared/i18n/technical";

export function FileActionError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useLocale();
  // Shared notice: portalled to the body so a transformed or contained
  // ancestor cannot clip it. Routine file errors dismiss themselves.
  return <Toast tone="danger" message={message} onDismiss={onDismiss} />;
}
