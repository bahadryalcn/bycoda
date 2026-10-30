import { translateAt, useLocale, type LanguageDomain } from "../i18n";
import { NativePopupHost } from "./NativePopupHost";
import { PanelHeader } from "./PanelHeader";
import { useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "../../app/shell/GlassBackdrop";
import { OverlayMenuLayer, OverlayParent, overlayContainsTarget, useOverlay } from "./overlay";

export type ModalSize = "sm" | "md" | "lg" | "full";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(880px,calc(100vw-24px))]",
  full: "w-[calc(100vw-24px)]",
};

/**
 * Header hierarchy follows task context with the existing props. Compact
 * workbench dialogs (`sm`) and end sheets read as panes and use the title role;
 * bounded-task dialogs (`md`, `lg`) use the heading role. The header itself is the
 * shared `PanelHeader` (context, title, description, 28px ghost close).
 */
const FOOTER_ALIGN = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
} as const;

const TOP: Record<ModalSize, string> = {
  sm: "top-[22%]",
  md: "top-[10%]",
  lg: "top-[8%]",
  full: "inset-bs-4",
};

type Props = {
  languageDomain?: LanguageDomain;
  onClose: () => void;
  title: string;
  description?: string;
  /** Optional line above the title naming what the dialog acts on (project, file, session). */
  context?: ReactNode;
  size?: ModalSize;
  /** Keeps the accessible title while letting focused content own the visual hierarchy. */
  minimalHeader?: boolean;
  /** Extra classes on the panel (fixed height, etc). */
  className?: string;
  /** Keep taller dialogs inside the viewport, scrolling their content. */
  fitViewport?: boolean;
  /** Side detail surface with the same overlay, focus and native popup owner. */
  placement?: "center" | "end";
  /** Frequent keyboard surfaces open immediately without frame/backdrop motion. */
  motion?: "auto" | "none";
  /** Actions kept visible below the scrolling content. */
  footer?: ReactNode;
  /** Horizontal alignment of footer actions. Defaults to `end`; use `between` for a leading secondary action. */
  footerAlign?: "start" | "end" | "between";
  /** `auto` (default): the modal owns the one vertical scroll region. `none`: the content owns its own
   *  scrolling (lists, editors) and the modal only bounds it, so there is never a second scrollbar. */
  scroll?: "auto" | "none";
  children: ReactNode;
};

export function ModalPanel({
  languageDomain,
  onClose,
  title,
  description,
  context,
  size = "md",
  minimalHeader = false,
  className,
  fitViewport = true,
  placement = "center",
  motion = "auto",
  footer,
  footerAlign = "end",
  scroll = "auto",
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
  // React appends portals bottom-up when a dialog and its nested dialog mount in one commit, which
  // leaves the nested dialog's layer below its parent. Parent layout effects run after the
  // overlay stack registered both entries, so the parent moves itself back under its descendants.
  useLayoutEffect(() => {
    const layer = dialogRef.current?.closest<HTMLElement>("[data-modal-layer]");
    if (!layer || layer.parentElement !== document.body) return;
    for (const other of document.body.querySelectorAll<HTMLElement>(":scope > [data-modal-layer]")) {
      if (other === layer) break;
      const dialog = other.querySelector("[role='dialog']");
      if (!dialog || !overlayContainsTarget(overlayId, dialog)) continue;
      other.before(layer);
      break;
    }
  }, [overlayId]);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;
  const sheet = placement === "end";
  const level = sheet || size === "sm" ? "compact" : "task";

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
            style={motion === "none" ? { animation: "none" } : undefined}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onMouseDown={(event) => event.stopPropagation()}
            className={`relative isolate flex flex-col overflow-hidden border-(color:--ui-pane-border) shadow-(--ui-elevation-floating) ${sheet ? "h-full rounded-none border-s" : `border rounded-(--ui-radius-popup) ${fitViewport ? "max-h-[calc(100dvh-32px)]" : ""}`} ${className ?? ""}`}
          >
            {/* The shared raised popup surface, so the dialog reads apart from the work beneath. */}
            <GlassBackdrop />
            <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
              <PanelHeader
                className={
                  minimalHeader
                    ? "absolute top-3 right-3 z-[2]"
                    : sheet
                      ? "border-b border-(--ui-tone-neutral-border) px-4 py-2.5"
                      : "px-4 pt-3"
                }
                title={title}
                titleId={titleId}
                level={level}
                context={minimalHeader ? undefined : context}
                description={description}
                descriptionId={descriptionId}
                textOnlyForAssistiveTech={minimalHeader}
                closeRef={closeRef}
                closeLabel={t("Close")}
                onClose={onClose}
              />
              <div
                ref={lockOverscroll}
                data-modal-scroll={scroll}
                className={`min-h-0 flex-1 overscroll-none ${scroll === "none" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}
              >
                {children}
              </div>
              {footer ? (
                <footer
                  className={`flex shrink-0 flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) px-4 py-3 ${FOOTER_ALIGN[footerAlign]}`}
                >
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
      data-modal-layer=""
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
      <div
        className="modal-backdrop pointer-events-none absolute inset-0"
        style={props.motion === "none" ? { animation: "none" } : undefined}
      />
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}
