import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { createPortal } from "react-dom";
import { t, useLocale } from "../../../shared/i18n/technical";
import { LAYER } from "../../../shared/lib/layers";

export function FileActionError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useLocale();
  // A transformed or contained ancestor would clip a fixed toast, so a failed
  // open would look like nothing happened. The body keeps it visible.
  return createPortal(
    <Alert
      tone="danger"
      role="alert"
      className="fixed bottom-4 right-4 max-w-sm"
      style={{ zIndex: LAYER.toast }}
    >
      <span className="min-w-0 break-words">{message}</span>
      <Button
        variant="ghost"
        motion="none"
        type="button"
        aria-label={t("Dismiss file action error")}
        className="shrink-0"
        onClick={onDismiss}
      >
        {t("Dismiss")}
      </Button>
    </Alert>,
    document.body,
  );
}
