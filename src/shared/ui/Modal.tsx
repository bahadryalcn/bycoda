import { translateAt, useLocale, type LanguageDomain } from "../i18n";
import { NativePopupHost } from "./NativePopupHost";
import { X } from "./icons";
import { Button } from "./Button";
import { useContext, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "../../app/shell/GlassBackdrop";
import { OverlayMenuLayer, OverlayParent, useOverlay } from "./overlay";

export type ModalSize = "sm" | "md" | "lg";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(880px,calc(100vw-24px))]",
};

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
  lg: "top-[8%]",
};

type Props = {
  languageDomain?: LanguageDomain;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  /** Keeps the accessible title while letting focused content own the visual hierarchy. */
  minimalHeader?: boolean;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  /** Keep taller dialogs inside the viewport, scrolling their content. */
  fitViewport?: boolean;
  /** Side detail surface with the same overlay, focus and native popup owner. */
  placement?: "center" | "end";
  /** Actions kept visible below the scrolling content. */
  footer?: ReactNode;
  children: ReactNode;
};

export function ModalPanel({
  languageDomain,
  onClose,
  title,
  description,
  size = "md",
  minimalHeader = false,
  className,
  fitViewport = true,
  placement = "center",
  footer,
  children,
}: Props) {
  const locale = useLocale(languageDomain);
  const t = (message: string) => translateAt(locale, message);
  const popupHost = useContext(NativePopupHost);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayId = useOverlay(
    dialogRef,
    true,
    onClose,
    true,
    '[data-button-hierarchy="primary"]:not([aria-disabled="true"]):not([aria-busy="true"])',
  );
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;

  return (
    <OverlayMenuLayer.Provider value={LAYER.dialogPopover}>
      <OverlayParent.Provider value={overlayId}>
        <div
          className={
            popupHost
              ? "relative z-[1] w-full"
              : placement === "end"
                ? "relative z-[1] ms-auto h-full w-[min(880px,100vw)]"
                : fitViewport
                  ? `relative z-[1] ${WIDTH[size]}`
                  : `absolute z-[1] left-1/2 ${TOP[size]} ${WIDTH[size]} -translate-x-1/2`
          }
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            data-modal-placement={placement}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onMouseDown={(event) => event.stopPropagation()}
            className={`relative isolate flex flex-col overflow-hidden border border-content/7 shadow-2xl ${placement === "end" ? "h-full rounded-none" : `rounded-2xl ${fitViewport ? "max-h-[calc(100dvh-32px)]" : ""}`} ${className ?? ""}`}
          >
            <GlassBackdrop className="bg-background-base dark:bg-background-base/85" />
            <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
              <header
                className={
                  minimalHeader
                    ? "absolute top-3 right-3 z-[2]"
                    : "flex shrink-0 items-start gap-2 px-4 pt-3"
                }
              >
                <div className={minimalHeader ? "sr-only" : "min-w-0 flex-1 pt-0.5"}>
                  <h2 id={titleId} className="text-xl font-medium leading-tight text-content">
                    {title}
                  </h2>
                  {description ? (
                    <p
                      id={descriptionId}
                      className="ui-secondary-text mt-0.5 break-words leading-snug"
                    >
                      {description}
                    </p>
                  ) : null}
                </div>
                <Button
                  ref={closeRef}
                  type="button"
                  iconOnly
                  label={t("Close")}
                  tooltip={t("Close")}
                  variant="ghost"
                  onClick={onClose}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </Button>
              </header>
              <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none">
                {children}
              </div>
              {footer ? (
                <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) px-4 py-3">
                  {footer}
                </footer>
              ) : null}
            </div>
          </div>
        </div>
      </OverlayParent.Provider>
    </OverlayMenuLayer.Provider>
  );
}

export function Modal(props: Props) {
  useLocale();
  const host = useContext(NativePopupHost);
  if (host) return createPortal(<ModalPanel {...props} />, host);
  return createPortal(
    <div
      className={`fixed inset-0 ${props.placement === "end" ? "flex justify-end" : props.fitViewport !== false ? "grid place-items-center" : ""}`}
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Do not let the browser's default mouse focus overwrite the trigger
        // focus restored when the dialog unmounts.
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className="modal-backdrop pointer-events-none absolute inset-0 bg-scrim/40" />
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}
