import { t, useLocale } from "../i18n";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { X } from "./icons";

const VISIBLE_MS = 7000;

/** A short message in the corner with automatic expiry and a dismiss control. */
export function TransientNotice({
  message,
  onDismiss,
}: {
  message: string;
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
    <div
      role="status"
      style={{ zIndex: LAYER.toast }}
      className="fixed end-3 [inset-block-end:0.75rem] flex w-[min(340px,calc(100vw-24px))] items-start gap-2 rounded-xl border border-content/15 bg-background-base/95 px-3 py-2.5 text-start text-[12px] text-content shadow-xl backdrop-blur-xl"
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        aria-label={t("Dismiss notice")}
        title={t("Dismiss notice")}
        onClick={onDismiss}
        className="ui-icon-hit relative grid size-6 shrink-0 place-items-center rounded text-content/60 hover:bg-content/10 hover:text-content active:bg-content/15 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
