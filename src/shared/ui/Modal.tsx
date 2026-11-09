import { translateAt, useLocale, type LanguageDomain } from "../i18n";
import { NativePopupHost } from "./NativePopupHost";
import { PanelHeader } from "./PanelHeader";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { GlassBackdrop } from "../../app/shell/GlassBackdrop";
import { OverlayMenuLayer, OverlayParent, overlayContainsTarget, useOverlay } from "./overlay";
import { Button } from "./Button";
import { Maximize2, Minimize2 } from "./icons";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(880px,calc(100vw-24px))]",
  /** Wide workbench views (a full graph, a large table) that are not the whole window. */
  xl: "w-[min(1100px,calc(100vw-48px))]",
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
  xl: "top-[6%]",
  full: "inset-bs-4",
};

/**
 * The footer of the enclosing Modal. `slot` is the footer element once it is mounted; `claim`
 * asks the Modal to render it and returns the release. Used by `ModalFooter`.
 */
const ModalFooterContext = createContext<{
  slot: HTMLElement | null;
  claim: () => () => void;
} | null>(null);

const PRIMARY_ACTION =
  '[data-button-hierarchy="primary"]:not([aria-disabled="true"]):not([aria-busy="true"])';

/** Escape inside a text field belongs to the field (a search clears itself) with `fieldEscape="field"`. */
function inTextField(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement &&
        !/^(button|checkbox|radio|submit|reset|range|color|file|image)$/.test(target.type)))
  );
}

type Props = {
  languageDomain?: LanguageDomain;
  onClose: () => void;
  /** Override Escape without changing the close button. */
  onEscape?: () => void;
  /** Keep the modal focus boundary while showing the workspace without a scrim. */
  backdrop?: boolean;
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
  /**
   * Side detail surface with the same overlay, focus and native popup owner. `bottom` is a
   * bottom sheet. Prefer `Sheet`, which wraps both sheet placements.
   */
  placement?: "center" | "end" | "bottom";
  /** Inline size overrides on the panel box (a sheet width, a fixed dialog height). */
  panelStyle?: CSSProperties;
  /**
   * Selector for the control that receives focus on open. Defaults to the enabled primary
   * action, else the first focusable control. A destructive confirmation points at Cancel.
   */
  initialFocus?: string;
  /** Controls beside the title (view buttons, a search field), placed before expand and close. */
  toolbar?: ReactNode;
  /** Adds a Full screen / Restore toggle to the header; expanded, the dialog fills the window. */
  expandable?: boolean;
  /** Starts expanded (with `expandable`). */
  defaultExpanded?: boolean;
  /**
   * `close` (default): Escape closes from anywhere inside. `field`: Escape inside a text field
   * is left to the field (a search clears itself) and does not close the dialog.
   */
  fieldEscape?: "close" | "field";
  /** Frequent keyboard surfaces open immediately without frame/backdrop motion. */
  motion?: "auto" | "none";
  /**
   * Actions kept visible below the scrolling content. Prefer `<ModalActions>`: Cancel (ghost)
   * before the primary. A submit button outside the form body uses `form={formId}`.
   */
  footer?: ReactNode;
  /** Leading footer actions (a secondary destructive "Delete", a "Reset"), held at the start edge. */
  footerStart?: ReactNode;
  /** Horizontal alignment of footer actions. Defaults to `end`; use `between` for a leading secondary action. */
  footerAlign?: "start" | "end" | "between";
  /** `auto` (default): the modal owns the one vertical scroll region. `none`: the content owns its own
   *  scrolling (lists, editors) and the modal only bounds it, so there is never a second scrollbar. */
  scroll?: "auto" | "none";
  /**
   * `md` (default): the body owns its padding (`px-4 pt-2 pb-4`), so content needs none.
   * `none`: full-bleed content that pads itself (lists, editors, previews). With `scroll="none"`
   * the default is `none` unless `padding="md"` is passed.
   */
  padding?: "md" | "none";
  children: ReactNode;
};

export type ModalProps = Props;

/**
 * The dialog surface inside the Modal layer: header, scrolling body, footer. Rendered directly
 * by Modal and by native popup hosts.
 * @group overlay
 * @status internal
 */
export function ModalPanel({
  languageDomain,
  onClose,
  onEscape,
  title,
  description,
  context,
  size = "md",
  minimalHeader = false,
  className,
  fitViewport = true,
  placement = "center",
  panelStyle,
  initialFocus,
  toolbar,
  expandable = false,
  defaultExpanded = false,
  fieldEscape = "close",
  motion = "auto",
  footer,
  footerStart,
  footerAlign = "end",
  scroll = "auto",
  padding,
  children,
}: Props) {
  const locale = useLocale(languageDomain);
  const t = (message: string) => translateAt(locale, message);
  const popupHost = useContext(NativePopupHost);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [expandedState, setExpanded] = useState(defaultExpanded);
  const expanded = expandable && expandedState;
  const overlayId = useOverlay(
    dialogRef,
    true,
    onEscape ?? onClose,
    true,
    initialFocus ?? PRIMARY_ACTION,
    true,
    false,
    fieldEscape === "field" ? inTextField : undefined,
  );
  // React appends portals bottom-up when a dialog and its nested dialog mount in one commit, which
  // leaves the nested dialog's layer below its parent. Parent layout effects run after the
  // overlay stack registered both entries, so the parent moves itself back under its descendants.
  useLayoutEffect(() => {
    const layer = dialogRef.current?.closest<HTMLElement>("[data-modal-layer]");
    if (!layer || layer.parentElement !== document.body) return;
    for (const other of document.body.querySelectorAll<HTMLElement>(
      ":scope > [data-modal-layer]",
    )) {
      if (other === layer) break;
      const dialog = other.querySelector("[role='dialog']");
      if (!dialog || !overlayContainsTarget(overlayId, dialog)) continue;
      other.before(layer);
      break;
    }
  }, [overlayId]);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  // A divider under an unframed header once content scrolls beneath it, so the title never
  // reads as overlapping clipped rows. Framed (sheet/bottom) headers already have one.
  const [scrolled, setScrolled] = useState(false);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const [footerClaims, setFooterClaims] = useState(0);
  const [claimFooter] = useState(() => () => {
    setFooterClaims((count) => count + 1);
    return () => setFooterClaims((count) => count - 1);
  });
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-desc` : undefined;
  const sheet = placement === "end";
  const bottom = placement === "bottom";
  const level = sheet || bottom || size === "sm" ? "compact" : "task";
  const expandLabel = t(expanded ? "Restore window" : "Full screen");
  const headerActions =
    toolbar || expandable ? (
      <>
        {toolbar}
        {expandable ? (
          <Button
            type="button"
            iconOnly
            size="sm"
            variant="ghost"
            label={expandLabel}
            tooltip={expandLabel}
            aria-pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <Minimize2 className="icon-sm" aria-hidden />
            ) : (
              <Maximize2 className="icon-sm" aria-hidden />
            )}
          </Button>
        ) : null}
      </>
    ) : undefined;

  return (
    <OverlayMenuLayer.Provider value={LAYER.dialogPopover}>
      <OverlayParent.Provider value={overlayId}>
        <ModalFooterContext.Provider value={{ slot: footerSlot, claim: claimFooter }}>
          <div
            className={
              popupHost
                ? "relative z-[1] w-full"
                : expanded
                  ? "relative z-[1] h-full w-full"
                  : sheet
                    ? "relative z-[1] ms-auto h-full w-[min(880px,100vw)]"
                    : bottom
                      ? "relative z-[1] mx-auto w-full max-w-4xl"
                      : fitViewport
                        ? `relative z-[1] ${WIDTH[size]}`
                        : `absolute z-[1] left-1/2 ${TOP[size]} ${WIDTH[size]} -translate-x-1/2`
            }
            style={expanded || popupHost ? undefined : panelStyle}
          >
            <div
              ref={dialogRef}
              tabIndex={-1}
              role="dialog"
              data-modal-placement={placement}
              data-modal-expanded={expanded || undefined}
              style={{
                ...(motion === "none" ? { animation: "none" } : null),
                // Expanded wins over a caller's fixed height class.
                ...(expanded ? { blockSize: "100%", maxBlockSize: "none" } : null),
              }}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              onMouseDown={(event) => event.stopPropagation()}
              className={`relative isolate flex flex-col overflow-hidden border-(color:--ui-pane-border) shadow-(--ui-elevation-floating) ${expanded ? "h-full rounded-none border-0" : sheet ? "h-full rounded-none border-s" : bottom ? "max-h-[calc(100dvh-40px)] rounded-t-(--ui-radius-popup) border border-b-0" : `border rounded-(--ui-radius-popup) ${fitViewport ? "max-h-[calc(100dvh-32px)]" : ""}`} ${className ?? ""}`}
            >
              {/* The shared raised popup surface, so the dialog reads apart from the work beneath. */}
              <GlassBackdrop />
              <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
                <PanelHeader
                  className={
                    minimalHeader
                      ? "absolute top-3 right-3 z-[2]"
                      : sheet || bottom
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
                  actions={minimalHeader ? undefined : headerActions}
                />
                <div
                  ref={lockOverscroll}
                  data-modal-scroll={scroll}
                  onScroll={(event) => {
                    if (event.target !== event.currentTarget) return;
                    const next = event.currentTarget.scrollTop > 0;
                    if (next !== scrolled) setScrolled(next);
                  }}
                  className={`min-h-0 flex-1 overscroll-none ${scroll === "none" ? "flex flex-col overflow-hidden" : "overflow-y-auto"} ${(padding ?? (scroll === "none" ? "none" : "md")) === "md" ? "px-4 pt-2 pb-4" : ""} ${minimalHeader || sheet || bottom ? "" : `border-t ${scrolled ? "border-(--ui-tone-neutral-border)" : "border-transparent"}`}`}
                >
                  {children}
                </div>
                {footer || footerStart || footerClaims > 0 ? (
                  <footer
                    ref={setFooterSlot}
                    className={`flex shrink-0 flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) px-4 py-3 ${FOOTER_ALIGN[footerStart ? "between" : footerAlign]}`}
                  >
                    {footerStart ? (
                      <>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          {footerStart}
                        </div>
                        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                          {footer}
                        </div>
                      </>
                    ) : (
                      footer
                    )}
                  </footer>
                ) : null}
              </div>
            </div>
          </div>
        </ModalFooterContext.Provider>
      </OverlayParent.Provider>
    </OverlayMenuLayer.Provider>
  );
}

/**
 * A centered dialog on the shared overlay owner (layer, focus trap, Escape, backdrop, native popup
 * routing) with the standard header, one scrolling body and a pinned footer. The body owns its
 * padding, so children carry none; `padding="none"` is only for full-bleed content that pads
 * itself (lists, editors, previews).
 * @group overlay
 * @use A bounded task or form that needs the user's focus (create, edit, review).
 * @avoid Side panels: Sheet. Small anchored UI: Popover. Yes/no confirmations: ConfirmDialog.
 */
export function Modal(props: Props) {
  useLocale();
  const host = useContext(NativePopupHost);
  if (host) return createPortal(<ModalPanel {...props} />, host);
  const layout =
    props.placement === "end"
      ? "flex justify-end"
      : props.placement === "bottom"
        ? "flex items-end justify-center"
        : props.fitViewport !== false || props.expandable
          ? "grid place-items-center"
          : "";
  return createPortal(
    <div
      data-modal-layer=""
      className={`fixed inset-0 ${layout}`}
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Do not let the browser's default mouse focus overwrite the trigger
        // focus restored when the dialog unmounts.
        event.preventDefault();
        if (props.backdrop !== false) props.onClose();
      }}
    >
      {props.backdrop !== false ? (
        <div
          className="modal-backdrop pointer-events-none absolute inset-0"
          style={props.motion === "none" ? { animation: "none" } : undefined}
        />
      ) : null}
      <ModalPanel {...props} />
    </div>,
    document.body,
  );
}

/**
 * Puts its children in the enclosing Modal's footer from a descendant that owns the state the
 * actions need (a form component inside the dialog). Outside a Modal it renders in place.
 * @group overlay
 * @use Footer actions when only a nested form component can see the state they need.
 * @avoid When the Modal's own component has the state: pass `footer` with ModalActions. Never put closing actions at the end of the body.
 */
export function ModalFooter({ children }: { children: ReactNode }) {
  const context = useContext(ModalFooterContext);
  const claim = context?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  // Outside a Modal (the same form on a settings page), the actions stay in place.
  if (!context) return <>{children}</>;
  return context.slot ? createPortal(children, context.slot) : null;
}

/**
 * The standard dialog action row, for `footer`: the body scrolls, the footer stays. `start` holds
 * a leading secondary or destructive action ("Delete", "Reset") at the start edge; children are
 * the closing actions at the end edge, Cancel (ghost) before the primary. The final irreversible
 * confirm is filled danger: `variant="primary" tone="danger"`. `inline` is only for a form on a
 * page that is not a dialog.
 * @group overlay
 * @use The Cancel and primary actions of a Modal or Sheet footer.
 * @avoid Actions at the end of the scrolling body, or a hand-built footer row.
 *
 * ```tsx
 * <Modal title={t("Edit crew")} onClose={close} footer={
 *   <ModalActions start={<Button variant="ghost" tone="danger" onClick={remove}>{t("Delete")}</Button>}>
 *     <Button variant="ghost" onClick={close}>{t("Cancel")}</Button>
 *     <Button variant="primary" type="submit" form={formId}>{t("Save")}</Button>
 *   </ModalActions>
 * }>…</Modal>
 * ```
 */
export function ModalActions({
  start,
  align = "end",
  inline = false,
  className,
  children,
}: {
  start?: ReactNode;
  /** Alignment of the closing actions when there is no `start` group. */
  align?: "start" | "end";
  /** For a form on a page that is not in a Modal: adds the spacing above the row. In a Modal use `footer`. */
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-modal-actions=""
      className={[
        "flex min-w-0 flex-1 flex-wrap items-center gap-2",
        inline ? "pt-1" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {start ? <div className="flex min-w-0 flex-wrap items-center gap-2">{start}</div> : null}
      <div
        className={`flex min-w-0 flex-wrap items-center gap-2 ${start || align === "end" ? "ms-auto justify-end" : "justify-start"}`}
      >
        {children}
      </div>
    </div>
  );
}
