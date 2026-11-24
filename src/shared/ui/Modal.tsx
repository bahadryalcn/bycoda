import { optionalTextAttributes, type TextRoles } from "./Text";
import { useLocale, useT, type LanguageDomain } from "../i18n";
import { useT as useGitT } from "../i18n/git";
import { useT as useTechnicalT } from "../i18n/technical";
import { floatingFrameClassName, NativePopupHost, PopupBackdrop } from "./NativePopupHost";
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
import { OverlayMenuLayer, OverlayParent, overlayContainsTarget, useOverlay } from "./overlay";
import { Button } from "./Button";
import { InlineMessage } from "./InlineError";
import { Maximize2, Minimize2 } from "./icons";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full" | "settings";

/** `auto` fits the content; `tall` is a fixed working height; `fill` takes the window minus the margins. */
export type ModalHeight = "auto" | "tall" | "fill";

const WIDTH: Record<ModalSize, string> = {
  sm: "w-[min(420px,calc(100vw-24px))]",
  md: "w-[min(560px,calc(100vw-24px))]",
  lg: "w-[min(880px,calc(100vw-24px))]",
  /** Wide workbench views (a full graph, a large table) that are not the whole window. */
  xl: "w-[min(1100px,calc(100vw-48px))]",
  full: "w-[calc(100vw-24px)]",
  settings: "w-[min(88rem,calc(100vw-24px))]",
};

const HEIGHT: Record<ModalHeight, string> = {
  auto: "",
  tall: "h-[min(760px,85dvh)]",
  fill: "h-[calc(100dvh-32px)]",
};

/** Settings keeps one geometry for every page; only `maximized` and the end-edge peek change it. */
const SETTINGS_HEIGHT = "h-[min(60rem,calc(100dvh-32px))]";
const SETTINGS_PEEK_WIDTH = "w-[min(380px,100vw)]";
/** The `minimalHeader` close button's inset from the corner, and the room content leaves for it. */
const MINIMAL_CLOSE_VARS = "[--modal-close-inset:0.75rem] [--modal-close-clearance:2.75rem]";

/** Dialog chrome is shared by centered, native-window and non-modal sheet surfaces. */
export const DIALOG_HEADER_CLASS_NAME = "px-4 pt-2 pb-1";
export const DIALOG_BODY_PADDING_CLASS_NAME = "px-4 pt-2 pb-4";
export const DIALOG_FOOTER_CLASS_NAME =
  "flex min-h-0 max-h-[min(12rem,45dvh)] shrink flex-wrap items-center gap-2 overflow-y-auto overscroll-contain border-t border-(--ui-pane-border) px-4 py-3";

const FOOTER_ALIGN = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
} as const;

const TOP: Record<ModalSize, string> = {
  sm: "[--modal-top:22dvh]",
  md: "[--modal-top:10dvh]",
  lg: "[--modal-top:8dvh]",
  xl: "[--modal-top:6dvh]",
  full: "[--modal-top:1rem]",
  settings: "[--modal-top:8dvh]",
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
  /** Holds Close, Escape and backdrop dismissal while a bounded operation owns the dialog. */
  closeDisabled?: boolean;
  /** Override Escape without changing the close button. */
  onEscape?: () => void;
  /** Keep the modal focus boundary while showing the workspace without a scrim. */
  backdrop?: boolean;
  title: string;
  description?: string;
  /** Optional line above the title naming what the dialog acts on (project, file, session). */
  context?: ReactNode;
  /**
   * Width. `settings` is the standard geometry of the settings windows (88rem x 60rem);
   * with `placement="end"` it is the narrow peek panel.
   */
  size?: ModalSize;
  /** `auto` (default) fits the content; `tall` a fixed working height; `fill` nearly the window height. */
  height?: ModalHeight;
  /** Fills the window (minus margins) without the Full screen button; the owner toggles it. */
  maximized?: boolean;
  /**
   * Keeps the accessible title while letting focused content own the visual hierarchy. The close
   * button floats at the inline-end corner; content that runs under it pads with
   * `pe-(--modal-close-clearance)` and aligns to `--modal-close-inset`.
   */
  minimalHeader?: boolean;
  /** Extra classes on the panel; size and height come from `size` and `height`. */
  className?: string;
  /** Workspace panels docked at the end use the workspace panel ground. */
  surface?: "floating" | "workspace-panel";
  /** Translucent shared glass for reading dialogs; popup grounds all use the floating surface, so this is kept for callers. */
  frosted?: boolean;
  /** Keep taller dialogs inside the viewport, scrolling their content. Off: a top-anchored palette capped at 80% of the window. */
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
  /** Body typography (size, tone, weight, leading); unset preserves the existing body. */
  bodyText?: TextRoles;
  children: ReactNode;
};

export type ModalProps = Props;

/**
 * The dialog surface inside the Modal layer: header, scrolling body, footer. Rendered directly
 * by Modal and by native popup hosts.
 * @group overlay
 * @status internal
 * @use Dialog body inside Modal or NativePopupHost.
 * @avoid A complete modal layer with focus and dismissal: Modal.
 */
export function ModalPanel({
  languageDomain,
  onClose,
  closeDisabled = false,
  onEscape,
  title,
  description,
  context,
  size: requestedSize = "md",
  height = "auto",
  maximized = false,
  minimalHeader = false,
  className,
  surface,
  frosted = false,
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
  bodyText,
  children,
}: Props) {
  // One bound translator per language domain; all three hooks run every render, the prop picks one.
  const appT = useT();
  const gitT = useGitT();
  const technicalT = useTechnicalT();
  const t = languageDomain === "git" ? gitT : languageDomain === "technical" ? technicalT : appT;
  const popupHost = useContext(NativePopupHost);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [expandedState, setExpanded] = useState(defaultExpanded);
  const expanded = expandable && expandedState;
  const overlayId = useOverlay(
    dialogRef,
    true,
    () => {
      if (!closeDisabled) (onEscape ?? onClose)();
    },
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
  // A divider under the shared header once content scrolls beneath it keeps clipped rows distinct.
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
  const docked = sheet && surface === "workspace-panel";
  const size = maximized ? "full" : requestedSize;
  const settings = requestedSize === "settings";
  const heightClass = maximized
    ? HEIGHT.fill
    : settings && height === "auto"
      ? SETTINGS_HEIGHT
      : HEIGHT[height];
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
                    ? `relative z-[1] ms-auto h-full ${settings ? SETTINGS_PEEK_WIDTH : "w-[min(880px,100vw)]"}`
                    : bottom
                      ? "relative z-[1] mx-auto w-full max-w-4xl"
                      : fitViewport
                        ? `relative z-[1] ${WIDTH[size]}`
                        : `absolute z-[1] left-1/2 inset-bs-(--modal-top) ${TOP[size]} ${WIDTH[size]} -translate-x-1/2`
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
              data-surface-variant={surface}
              data-surface-role={surface === "floating" ? surface : undefined}
              className={[
                "relative isolate flex min-h-0 flex-col overflow-hidden",
                popupHost
                  ? `max-h-[var(--native-popup-max-height,100dvh)] ${sheet || bottom ? "" : heightClass}`
                  : expanded
                    ? "h-full rounded-none"
                    : docked
                      ? "h-full border-s border-(--ui-pane-border) bg-(--ui-surface-panel)"
                      : sheet
                        ? `${floatingFrameClassName} h-full rounded-none border-s`
                        : bottom
                          ? `${floatingFrameClassName} max-h-[calc(100dvh-40px)] rounded-b-none border border-b-0`
                          : `${floatingFrameClassName} border ${heightClass} ${fitViewport ? "max-h-[calc(100dvh-32px)]" : "max-h-[min(80dvh,calc(100dvh-var(--modal-top)))]"}`,
                minimalHeader && MINIMAL_CLOSE_VARS,
                className,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {!popupHost && (!docked || expanded) ? <PopupBackdrop frosted={frosted} /> : null}
              <div className="modal-panel relative z-[1] flex min-h-0 flex-1 flex-col">
                <PanelHeader
                  className={
                    minimalHeader
                      ? "absolute top-(--modal-close-inset) inset-e-(--modal-close-inset) z-[2]"
                      : DIALOG_HEADER_CLASS_NAME
                  }
                  title={title}
                  titleId={titleId}
                  level="compact"
                  context={minimalHeader ? undefined : context}
                  description={description}
                  descriptionId={descriptionId}
                  textOnlyForAssistiveTech={minimalHeader}
                  closeRef={closeRef}
                  closeLabel={t("Close")}
                  onClose={onClose}
                  closeDisabled={closeDisabled}
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
                  {...optionalTextAttributes(
                    bodyText ?? {},
                    `min-h-0 flex-1 overscroll-none ${scroll === "none" ? "flex flex-col overflow-hidden" : "overflow-y-auto"} ${(padding ?? (scroll === "none" ? "none" : "md")) === "md" ? DIALOG_BODY_PADDING_CLASS_NAME : ""} ${minimalHeader ? "" : `border-t ${scrolled ? "border-(--ui-pane-border)" : "border-transparent"}`}`,
                  )}
                >
                  {children}
                </div>
                {footer || footerStart || footerClaims > 0 ? (
                  <footer
                    ref={setFooterSlot}
                    className={`${DIALOG_FOOTER_CLASS_NAME} ${FOOTER_ALIGN[footerStart ? "between" : footerAlign]}`}
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
 * Hand-written blocking dialog layers, headers and action footers; native popup hosts render the same ModalPanel.
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
        if (props.backdrop !== false && !props.closeDisabled) props.onClose();
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
 * @use The Cancel and primary actions of a Modal or Sheet footer. Give the adjacent error an ID and pass it to the blocked Button's `aria-describedby`. For a footer-owned reason, set `reasonId` to that ID. A blocked Button can stay keyboard-focusable with `aria-disabled`. Use `disabledReason` only for a non-obvious cause without an adjacent explanation.
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
  reason,
  reasonId,
  align = "end",
  inline = false,
  className,
  children,
}: {
  start?: ReactNode;
  /**
   * Visible blocker beside the actions. Omit it when a field or other adjacent content already
   * explains the cause. Omit it while the action is available.
   */
  reason?: string;
  /** ID for `reason`. Pass it to the blocked action's `aria-describedby`. */
  reasonId?: string;
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
      {start || reason ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {start}
          {reason ? (
            <InlineMessage id={reasonId} tone="neutral" live="off">
              {reason}
            </InlineMessage>
          ) : null}
        </div>
      ) : null}
      <div
        className={`flex min-w-0 flex-wrap items-center gap-2 ${start || reason || align === "end" ? "ms-auto justify-end" : "justify-start"}`}
      >
        {children}
      </div>
    </div>
  );
}
