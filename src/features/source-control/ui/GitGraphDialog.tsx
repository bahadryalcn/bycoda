import { t, useLocale } from "../../../shared/i18n/git";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import { LAYER } from "../../../shared/lib/layers";
import { Maximize2, X } from "../../../shared/ui/icons";
import { useState } from "react";

type Props = {
  title: string;
  /** Buttons and the search field, shown next to the title. */
  toolbar: ReactNode;
  onClose: () => void;
  children: ReactNode;
  expandable?: boolean;
};

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A wide dialog for the full graph. `Modal` is capped at 560px, so this keeps
 * its look (glass panel, backdrop, Escape, focus return) at graph width.
 *
 * It sits just under the popover layer: the commit context menu and the hover
 * card are popovers and have to open above it, while the name dialogs
 * (`LAYER.dialog`) still open above both.
 */
export function GitGraphDialog({ title, toolbar, onClose, children, expandable = false }: Props) {
  useLocale();
  const [maximized, setMaximized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Focus inside a menu or another dialog opened from here: that one closes, not this.
      const target = event.target;
      // The search field uses Escape to close itself first.
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (
        target instanceof Element &&
        target !== document.body &&
        target !== document.documentElement &&
        !panelRef.current?.contains(target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.popover - 1 }}>
      <div className="modal-backdrop absolute inset-0 bg-scrim/40" onMouseDown={onClose} />
      <div
        className={
          maximized
            ? "absolute inset-0"
            : `absolute top-1/2 left-1/2 ${expandable ? "h-[calc(100dvh-48px)] w-[calc(100vw-48px)]" : "h-[min(760px,calc(100dvh-48px))] w-[min(1100px,calc(100vw-48px))]"} -translate-x-1/2 -translate-y-1/2`
        }
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={trapTab}
          className={`relative isolate flex h-full flex-col overflow-hidden border border-content/7 shadow-2xl ${maximized ? "" : "rounded-2xl"}`}
        >
          <GlassBackdrop className="bg-background-base/55" />
          <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-4 py-2.5">
              <h2 id={titleId} className="text-[15px] leading-tight font-medium text-content">
                {title}
              </h2>
              <div className="ml-2 flex min-w-0 flex-1 items-center gap-1">{toolbar}</div>
              {expandable ? (
                <button
                  type="button"
                  aria-label={t(maximized ? "Restore window" : "Full screen")}
                  title={t(maximized ? "Restore window" : "Full screen")}
                  aria-pressed={maximized}
                  onClick={() => setMaximized(!maximized)}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-content/70 hover:bg-content/8"
                >
                  <Maximize2 className="size-3.5" />
                </button>
              ) : null}
              <button
                ref={closeRef}
                type="button"
                aria-label={t("Close")}
                title={t("Close")}
                onClick={onClose}
                className="grid size-7 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/8 hover:text-content focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col border-t border-stroke">{children}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
