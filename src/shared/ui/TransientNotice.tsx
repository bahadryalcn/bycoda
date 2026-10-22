import { t, useLocale } from "../i18n";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { Button } from "./Button";
import { X } from "./icons";
import { Alert } from "./Alert";

const VISIBLE_MS = 7000;

/**
 * A short message in the corner with automatic expiry and a dismiss control,
 * plus an optional action such as Undo.
 */
export function TransientNotice({
  message,
  action,
  onDismiss,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}) {
  useLocale();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const id = window.setTimeout(() => dismiss.current(), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [message]);

  return createPortal(
    <Alert
      tone="info"
      role="status"
      style={{ zIndex: LAYER.toast }}
      className="fixed end-3 [inset-block-end:0.75rem] w-[min(340px,calc(100vw-24px))]"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 self-center break-words">{message}</span>
        {action ? (
          <Button variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          iconOnly
          label={t("Dismiss notice")}
          tooltip={t("Dismiss notice")}
          onClick={onDismiss}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
    </Alert>,
    document.body,
  );
}
