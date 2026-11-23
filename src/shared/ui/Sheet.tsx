import { optionalTextAttributes, type TextRoles } from "./Text";
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useT, type LanguageDomain } from "../i18n";
import { useT as useGitT } from "../i18n/git";
import { useT as useTechnicalT } from "../i18n/technical";
import { useStableCallback } from "../hooks/useStableCallback";
import { isImeComposition } from "../lib/keyboard";
import { LAYER } from "../lib/layers";
import {
  Modal,
  DIALOG_HEADER_CLASS_NAME,
  DIALOG_BODY_PADDING_CLASS_NAME,
  DIALOG_FOOTER_CLASS_NAME,
} from "./Modal";
import { floatingFrameClassName, PopupBackdrop } from "./NativePopupHost";
import {
  OverlayMenuLayer,
  OverlayParent,
  hasActiveOverlay,
  overlayContainsTarget,
  useOverlay,
} from "./overlay";
import { Button } from "./Button";
import { X } from "./icons";
import { PaneHeader } from "./PaneHeader";
import { PanelHeader } from "./PanelHeader";
import { Sash } from "./Sash";
import styles from "./Sheet.module.css";

export type SheetSide = "end" | "bottom";

/** Named widths of an end sheet: a narrow detail, a form, a wide form, a workbench list. */
export type SheetSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<SheetSize, string> = { sm: "380px", md: "40rem", lg: "48rem", xl: "56rem" };

export type SheetResize = {
  /** Smallest and largest width in px. */
  min: number;
  max: number;
  /** Width in px before the owner drags. */
  defaultSize: number;
  /** Called with the final width after a drag or arrow key, for the owner to persist. */
  onResizeEnd?: (size: number) => void;
};

export type SheetProps = {
  /** `end`: a side panel on the inline-end edge. `bottom`: a sheet rising from the bottom edge. */
  side?: SheetSide;
  /**
   * `true` (default): a modal sheet on the shared Modal owner (layer, `aria-modal`, focus trap,
   * Escape, backdrop, native popup routing). `false`: a side panel that keeps the page usable,
   * `role="dialog"` without a trap.
   */
  modal?: boolean;
  /** Non-modal only: a persistent complementary workspace may be a named region. */
  role?: "dialog" | "region";
  /**
   * Non-modal only. `viewport` (default): fixed to the window edge, on the overlay stack
   * (Escape closes the topmost surface; menus inside are its children). `container`: fills the
   * nearest positioned ancestor (a pane); Escape closes it only when focus is in that pane.
   */
  anchor?: "viewport" | "container";
  /** Non-modal container sheets can inherit the workspace or chat pane ground. */
  surface?: "floating" | "canvas" | "chat";
  /** Non-modal only: `false` keeps the sheet mounted but inert and hidden from Escape. */
  open?: boolean;
  onClose: () => void;
  /** Accessible name and the PanelHeader title. */
  title: string;
  description?: string;
  context?: ReactNode;
  /** Header actions before the close button (28px ghost icon Buttons). */
  headerActions?: ReactNode;
  /**
   * Non-modal only: replaces the default header (a pane's own PaneHeader with identity and
   * actions). `false` shows no header. `title` still names the sheet. A tab strip is `tabs`.
   */
  header?: ReactNode;
  /**
   * Non-modal only: a tab strip (`Tabs` with a `TabList`) in the one header row, before
   * `headerActions` and the close action. Replaces the title, which stays the accessible name.
   */
  tabs?: ReactNode;
  /** Content under the header that does not scroll (a state line, filters). */
  headerBelow?: ReactNode;
  closeLabel?: string;
  /** Actions kept visible below the content. */
  footer?: ReactNode;
  children: ReactNode;
  /**
   * Width of an end sheet: `sm` (380px), `md` (40rem), `lg` (48rem), `xl` (56rem). A bottom sheet
   * takes its height as px or a CSS length. A `resizable` sheet starts at its `defaultSize`.
   */
  size?: SheetSize | number | string;
  /** Non-modal end sheets: a drag/arrow-key resize edge (shared Sash) on the inner border. */
  resizable?: SheetResize;
  /** A non-modal container end sheet can fill its pane and restore its previous width. */
  expanded?: boolean;
  /** Non-modal: a pointer press outside closes the sheet. Default true. */
  dismissOnOutside?: boolean;
  /** Non-modal viewport: presses inside this element or selector are not outside (the trigger). */
  ignore?: string | { current: Element | null };
  /** Container anchor: the ancestor that scopes Escape. Defaults to the overlay's parent. */
  escapeScope?: string;
  /**
   * Selector for the control focused on open. Modal: defaults to the primary action.
   * Non-modal: defaults to the sheet itself. `false` (non-modal) leaves focus where it is.
   */
  initialFocus?: string | false;
  /** Non-modal viewport layer. Defaults to `LAYER.dialog`; menus and tooltips inside stack just above it. */
  layer?: number;
  /** Non-modal viewport: distance from the top and bottom window edges (title and status bars). */
  inset?: { top?: number | string; bottom?: number | string };
  /** `auto` (default): the body scrolls. `none`: the content owns its scrolling. */
  scroll?: "auto" | "none";
  /** `md` (default) the body owns its padding (`px-4 pt-2 pb-4`); `none` for full-bleed content. `scroll="none"` implies `none`. */
  padding?: "md" | "none";
  /** Body typography (size, tone, weight, leading); unset preserves the existing body. */
  bodyText?: TextRoles;
  /** Frequent surfaces open without the entrance slide. */
  motion?: "auto" | "none";
  languageDomain?: LanguageDomain;
  /** Classes on the sheet surface (`section`). */
  className?: string;
  /** Extra classes on the floating backdrop. The shared ground stays opaque. */
  glassClassName?: string;
  /** Classes on the content column inside the glass. */
  bodyClassName?: string;
  /** Extra attributes for the in-pane overlay root (non-modal container), e.g. `data-*` hooks. */
  overlayClassName?: string;
  ref?: Ref<HTMLElement>;
  overlayRef?: Ref<HTMLDivElement>;
  glassRef?: Ref<HTMLDivElement>;
  bodyRef?: Ref<HTMLDivElement>;
};

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

const cssSize = (value: number | string) =>
  typeof value === "number" ? `${value}px` : value in SIZE ? SIZE[value as SheetSize] : value;

/**
 * Container sheets stay off the overlay stack, so they return focus themselves: the control that
 * had focus when the sheet opened gets it back once the sheet closes or unmounts. Focus that is
 * lost (body) or still inside the closed sheet is restored; focus the user or another overlay
 * already moved elsewhere is left alone.
 */
function useContainerFocusReturn(sheet: RefObject<HTMLElement | null>, active: boolean) {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Capture the DOM focus owner before paint and restore it when the sheet closes.
  useLayoutEffect(() => {
    const node = sheet.current;
    if (!active || !node) return;
    const opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !node.contains(document.activeElement)
        ? document.activeElement
        : null;
    if (!opener) return;
    return () => {
      // After the commit, so the sheet cannot reclaim focus first and a stacked overlay opened by
      // the same interaction has already taken it.
      queueMicrotask(() => {
        const current = document.activeElement;
        const lost = !current || current === document.body || current === document.documentElement;
        if (!lost && !node.contains(current)) return;
        if (hasActiveOverlay() || !opener.isConnected || opener.closest("[inert], [hidden]"))
          return;
        opener.focus({ preventScroll: true });
      });
    };
  }, [sheet, active]);
}

/**
 * A side or bottom sheet. Modal sheets reuse Modal; both share the body `padding` rule. Non-modal sheets are
 * side panels that keep the page usable (session sub-panels, the notification list). Header is the
 * shared PanelHeader. Detached sheets use the floating frame. Docked sheets use the host canvas.
 * Hand-written side and bottom overlay panels; header, close, padding and footer reuse Modal chrome.
 * @group overlay
 * @use A detail or secondary panel beside or below the work (task detail, notifications).
 * @avoid Centered tasks and forms: Modal. Small anchored UI: Popover.
 *
 * ```tsx
 * <Sheet side="end" title={t("Task")} onClose={close}>…</Sheet>
 * <Sheet modal={false} anchor="container" side="end" title={name} onClose={close}
 *   headerActions={<CopyButton />} resizable={{ min: 320, max: 900, defaultSize: 544 }}>…</Sheet>
 * ```
 */
export function Sheet(props: SheetProps) {
  if (props.modal === false) return <NonModalSheet {...props} />;
  const {
    side = "end",
    onClose,
    title,
    description,
    context,
    headerActions,
    headerBelow,
    footer,
    children,
    size,
    initialFocus,
    scroll,
    padding,
    bodyText,
    motion,
    languageDomain,
    className,
  } = props;
  return (
    <Modal
      placement={side}
      title={title}
      description={description}
      context={context}
      toolbar={headerActions}
      footer={footer}
      onClose={onClose}
      initialFocus={initialFocus || undefined}
      scroll={scroll}
      padding={padding}
      bodyText={bodyText}
      motion={motion}
      languageDomain={languageDomain}
      panelStyle={
        size === undefined
          ? undefined
          : side === "end"
            ? { inlineSize: `min(${cssSize(size)}, 100vw)` }
            : { blockSize: `min(${cssSize(size)}, calc(100dvh - 40px))` }
      }
      className={[side === "bottom" && size !== undefined ? "h-full" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {headerBelow}
      {children}
    </Modal>
  );
}

function NonModalSheet({
  role = "dialog",
  side = "end",
  anchor = "viewport",
  surface: fill = "floating",
  open = true,
  onClose,
  title,
  description,
  context,
  headerActions,
  header,
  tabs,
  headerBelow,
  closeLabel,
  footer,
  children,
  size,
  resizable,
  expanded,
  dismissOnOutside = true,
  ignore,
  escapeScope,
  initialFocus,
  layer = LAYER.dialog,
  inset,
  scroll = "auto",
  padding,
  motion = "auto",
  languageDomain,
  className,
  glassClassName,
  bodyClassName,
  bodyText,
  overlayClassName,
  ref,
  overlayRef,
  glassRef,
  bodyRef,
}: SheetProps) {
  // One bound translator per language domain; all three hooks run every render, the prop picks one.
  const appT = useT();
  const gitT = useGitT();
  const technicalT = useTechnicalT();
  const t = languageDomain === "git" ? gitT : languageDomain === "technical" ? technicalT : appT;
  const sheet = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  const viewport = anchor === "viewport";
  const uid = useId();
  const titleId = `${uid}-title`;
  const close = useStableCallback(onClose);
  const [width, setWidth] = useState(resizable?.defaultSize);
  const [scrolled, setScrolled] = useState(false);
  const resizeStart = useRef(width ?? 0);
  const resizeSign = useRef(1);

  // Viewport panels join the overlay stack: Escape closes the topmost surface, menus opened
  // inside are its children and focus returns to the opener. Container panels stay out of it,
  // so a sheet in one pane never takes Escape from another.
  const overlayId = useOverlay(sheet, false, onClose, viewport && open);
  const inheritedMenuLayer = useContext(OverlayMenuLayer);
  useContainerFocusReturn(sheet, !viewport && open);

  // Container: Escape from anywhere in this pane (or the body) closes the sheet.
  useEffect(() => {
    if (viewport || !open) return;
    const node = sheet.current;
    if (!node) return;
    const scope =
      (escapeScope ? node.closest(escapeScope) : null) ?? overlay.current?.parentElement ?? null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isImeComposition(event)) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target !== document.body && !(target && scope?.contains(target))) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewport, open, escapeScope, close]);

  // Viewport: a press outside the sheet (and its child menus) closes it.
  useEffect(() => {
    if (!viewport || !open || !dismissOnOutside) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || overlayContainsTarget(overlayId, target)) return;
      const element = target instanceof Element ? target : target.parentElement;
      if (typeof ignore === "string" ? element?.closest(ignore) : ignore?.current?.contains(target))
        return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [viewport, open, dismissOnOutside, ignore, overlayId, close]);

  // Focus moves into the sheet when it opens unless something inside already took it.
  useEffect(() => {
    const node = sheet.current;
    if (!open || initialFocus === false || !node || node.contains(document.activeElement)) return;
    const target = initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? node).focus({ preventScroll: true });
  }, [open, initialFocus]);

  const end = side === "end";
  // Without a tab strip or a caller header, the title row names the sheet.
  const titled = header === undefined && tabs == null;
  const closeText = closeLabel ?? t("Close");
  const closeAction = (
    <Button
      type="button"
      iconOnly
      size="sm"
      label={closeText}
      shortcut="Esc"
      variant="ghost"
      onClick={onClose}
    >
      <X className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
  const fillsPane = end && !viewport && expanded;
  const docked = !viewport && fill !== "floating";
  const sized = width !== undefined ? width : size;
  const endCap = "min(100%, max(20rem, 94%))";
  const sizeStyle: CSSProperties = fillsPane
    ? { inlineSize: "100%" }
    : sized === undefined
      ? end
        ? { inlineSize: `min(34rem, ${endCap})` }
        : {}
      : end
        ? { inlineSize: `min(${cssSize(sized)}, ${endCap})` }
        : { blockSize: cssSize(sized) };
  const blockInset = (value: number | string | undefined) =>
    typeof value === "string" ? value : `${value ?? 0}px`;
  const position: CSSProperties = viewport
    ? end
      ? {
          position: "fixed",
          insetBlockStart: inset?.top ?? 0,
          insetBlockEnd: inset?.bottom ?? 0,
          insetInlineEnd: 0,
          zIndex: layer,
        }
      : {
          position: "fixed",
          insetInline: 0,
          insetBlockEnd: inset?.bottom ?? 0,
          maxBlockSize: `max(0px, calc(100dvh - ${blockInset(inset?.top)} - ${blockInset(inset?.bottom)}))`,
          marginInline: "auto",
          zIndex: layer,
        }
    : end
      ? { position: "absolute", insetBlock: 0, insetInlineEnd: 0 }
      : {
          position: "absolute",
          insetInline: 0,
          insetBlockEnd: 0,
          maxBlockSize: "100%",
          marginInline: "auto",
        };
  const frame =
    docked
      ? end
        ? "border-s border-(--ui-pane-border)"
        : "border-t border-(--ui-pane-border)"
      : end
        ? viewport
          ? "rounded-none border-s"
          : "rounded-e-none border-s"
        : "w-full max-w-4xl rounded-b-none border border-b-0";

  const surface = (
    <section
      ref={(node) => {
        sheet.current = node;
        assign(ref, node);
      }}
      role={role}
      aria-labelledby={titled ? titleId : undefined}
      aria-label={titled ? undefined : title}
      tabIndex={-1}
      data-sheet-side={side}
      data-sheet-motion={motion}
      data-sheet-surface={fill}
      data-sheet-docked={docked || undefined}
      data-state={open ? "open" : "closed"}
      // A closed sheet a caller keeps mounted (to keep its content) must not stay painted.
      hidden={!open}
      style={{ ...position, ...sizeStyle }}
      className={[
        styles.sheet,
        "isolate flex min-h-0 flex-col outline-none",
        !docked && floatingFrameClassName,
        frame,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!docked ? (
        <PopupBackdrop
          ref={fill === "floating" ? glassRef : undefined}
          className={fill === "floating" ? glassClassName : undefined}
        />
      ) : null}
      {resizable && end && !fillsPane ? (
        <Sash
          orientation="vertical"
          appearance="hidden"
          className={styles.resize}
          label={t("Resize panel")}
          value={width}
          min={resizable.min}
          max={resizable.max}
          onResizeStart={() => {
            resizeStart.current = width ?? resizable.defaultSize;
            // Physical x: the end edge is on the right in LTR (drag left widens), left in RTL.
            resizeSign.current =
              sheet.current && getComputedStyle(sheet.current).direction === "rtl" ? 1 : -1;
          }}
          onResize={(delta) =>
            setWidth(
              Math.min(
                resizable.max,
                Math.max(resizable.min, resizeStart.current + resizeSign.current * delta),
              ),
            )
          }
          onResizeEnd={(delta, info) => {
            if (info.cancelled) {
              setWidth(resizeStart.current);
              return;
            }
            const next = Math.min(
              resizable.max,
              Math.max(resizable.min, resizeStart.current + resizeSign.current * delta),
            );
            setWidth(next);
            resizable.onResizeEnd?.(next);
          }}
          onReset={() => {
            setWidth(resizable.defaultSize);
            resizable.onResizeEnd?.(resizable.defaultSize);
          }}
        />
      ) : null}
      <div
        ref={bodyRef}
        {...optionalTextAttributes(bodyText ?? {})}
        className={[
          "relative z-[1] flex min-h-0 flex-1 flex-col text-(--ui-tone-neutral-fg)",
          optionalTextAttributes(bodyText ?? {}, bodyClassName).className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {header !== undefined ? (
          header
        ) : tabs != null ? (
          <PaneHeader
            actions={
              <>
                {headerActions}
                {closeAction}
              </>
            }
          >
            {tabs}
          </PaneHeader>
        ) : fill === "canvas" ? (
          <PaneHeader
            title={title}
            titleId={titleId}
            actions={
              <>
                {headerActions}
                {closeAction}
              </>
            }
          />
        ) : (
          <PanelHeader
            className={DIALOG_HEADER_CLASS_NAME}
            title={title}
            titleId={titleId}
            context={context}
            description={description}
            actions={
              <>
                {headerActions}
                {closeAction}
              </>
            }
          />
        )}
        {headerBelow ? <div className="shrink-0 px-4 pb-2">{headerBelow}</div> : null}
        <div
          onScroll={(event) => {
            if (event.target === event.currentTarget)
              setScrolled(event.currentTarget.scrollTop > 0);
          }}
          className={[
            "min-h-0 flex-1",
            scroll === "none"
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto overscroll-contain",
            (padding ?? (scroll === "none" ? "none" : "md")) === "md"
              ? DIALOG_BODY_PADDING_CLASS_NAME
              : "",
            `border-t ${scrolled ? "border-(--ui-pane-border)" : "border-transparent"}`,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
        {footer ? (
          <footer className={`${DIALOG_FOOTER_CLASS_NAME} justify-end`}>{footer}</footer>
        ) : null}
      </div>
    </section>
  );

  // A sheet above the popover layer lifts its own menus and tooltips just above it; one at or
  // below keeps the inherited floor.
  const menuLayer =
    layer > LAYER.popover ? Math.max(inheritedMenuLayer, layer + 1) : inheritedMenuLayer;
  if (viewport)
    return createPortal(
      <OverlayMenuLayer.Provider value={menuLayer}>
        <OverlayParent.Provider value={overlayId}>
          <div inert={!open} data-state={open ? "open" : "closed"} className="contents">
            {surface}
          </div>
        </OverlayParent.Provider>
      </OverlayMenuLayer.Provider>,
      document.body,
    );
  return (
    <div
      ref={(node) => {
        overlay.current = node;
        assign(overlayRef, node);
      }}
      data-sheet-overlay=""
      data-state={open ? "open" : "closed"}
      inert={!open}
      style={{ zIndex: LAYER.paneSheet }}
      className={["absolute inset-0", open ? "" : "pointer-events-none", overlayClassName]
        .filter(Boolean)
        .join(" ")}
    >
      {dismissOnOutside ? (
        <div aria-hidden className="absolute inset-0" onMouseDown={() => close()} />
      ) : null}
      {surface}
    </div>
  );
}
