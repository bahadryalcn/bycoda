import { NativePopupHost, PopupBackdrop } from "./NativePopupHost";
/**
 * Shared frame and host context for content inside an existing OS popup window.
 * @group overlay
 * @use Native popup roots whose caller owns window creation, fitting and dismissal.
 * @avoid Anchored content in the current window: Popover.
 */
export { NativePopover } from "./NativePopupHost";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { lockOverscroll } from "../hooks/useLockOverscroll";
import { LAYER } from "../lib/layers";
import { cumulativeCssZoom } from "../lib/cssZoom";
import { OverlayMenuLayer, OverlayParent, overlayContainsTarget, useOverlay } from "./overlay";
import styles from "./Popover.module.css";
import {
  placePopover,
  POPUP_MAX_WIDTH,
  POPUP_VIEWPORT_PADDING,
  popupListWidth,
  type AnchorRect,
  type PopoverAlign,
  type PopoverPosition,
  type PopoverSide,
} from "../lib/popover";

/**
 * A trigger element, a live ref to one, a rect already in viewport
 * coordinates, or a bare point for context menus.
 */
export type PopoverAnchor =
  | HTMLElement
  | { current: HTMLElement | null }
  | DOMRect
  | { x: number; y: number }
  | null;

export type PopoverDismissReason = "outside" | "escape";

/** True inside an OS popup, where the window itself replaces the in-app trigger. */
export function useNativePopoverHost(): boolean {
  return useContext(NativePopupHost) !== null;
}

/**
 * How a popover's content meets its height bound.
 *
 * - `"auto"` (default): the content keeps its natural height and, only when the
 *   bound (`maxHeight`, or the room left in the viewport) is smaller, the content
 *   element scrolls instead of the frame clipping it, so a short window never hides
 *   the last row. Low priority (components layer): a consumer's own inner rail or
 *   `overflow-*` utility wins, so menus and lists that own a rail are unchanged.
 * - `"intrinsic"`: the content keeps its natural height and the frame clips it.
 *   Only for content that must never scroll (tooltips, previews sized by the bound).
 * - `"scroll"`: the popover owns one vertical scroll region. The content region
 *   is capped at the bound, scrolls on wheel, touch and keyboard, contains
 *   overscroll (no page scroll chaining or rubber-band) and never reads as an
 *   outside dismissal. Do not add a second `overflow-y-auto` rail inside it.
 *   Needs `constrainHeight` (the default); content with nothing focusable inside
 *   should pass `tabIndex={0}` so keyboard users can scroll it.
 *
 * Forms, filter panels and help text vary in height with locale, zoom and viewport, so they use
 * `"scroll"` (InfoPopover and DateTimeRangePicker do) when they want the strict single region.
 * Menus and lists that already own a scroll rail (DropdownMenu, SearchableSelect, Select) keep the
 * default; never nest a second rail in a `"scroll"` flow.
 *
 * `data-popover-flow` on the content element reflects the active mode.
 */
export type PopoverFlow = "auto" | "intrinsic" | "scroll";

/**
 * What the popover is, for assistive tech.
 *
 * - `"dialog"`: a non-modal dialog (a filter panel, a form, a details card). Sets
 *   `role="dialog"`, moves focus to its first control on open (or the surface when there is
 *   none) and returns focus to the trigger on close. Name it with `aria-labelledby` (a visible
 *   title) or `aria-label`. Replaces a hand-set `role="dialog"`.
 * - Omitted: no role; the content supplies its own (a listbox, a tooltip, a preview).
 */
export type PopoverKind = "dialog";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';

/** Dialog popovers take focus on open, unless a descendant already autofocused itself. */
function focusDialog(surface: HTMLElement | null) {
  if (!surface || surface.contains(document.activeElement)) return;
  const first = [...surface.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (el) => el.getAttribute("aria-disabled") !== "true" && !el.closest("[inert]"),
  );
  (first ?? surface).focus({ preventScroll: true });
}

type Props = Omit<ComponentPropsWithoutRef<"div">, "style"> & {
  anchor: PopoverAnchor;
  side?: PopoverSide;
  align?: PopoverAlign;
  gap?: number;
  padding?: number;
  width?: number;
  /**
   * Marks a list popup (select, menu, picker): the width is the floor and the surface grows with its
   * longest row up to `POPUP_MAX_WIDTH` (800px), always clamped to the viewport. Unlike `width`, content
   * can grow wider than the trigger or the dialog it opened from. Rows stay one line until the cap.
   */
  minWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Defaults to true. Disable for intrinsic-height surfaces like context menus. */
  constrainHeight?: boolean;
  /** Content flow inside the height bound. Defaults to `"auto"`; see {@link PopoverFlow}. */
  flow?: PopoverFlow;
  /** Defaults to `LAYER.popover`; a flyout off an open popover wants higher. */
  layer?: number;
  /** Drops the glass frame and keeps only placement and the content animation. */
  bare?: boolean;
  /** Non-interactive hints must not return focus when their trigger blurs. */
  restoreFocus?: boolean;
  /** A non-interactive hint participates in modal containment without owning Escape. */
  passive?: boolean;
  /** Keyboard hints and other frequent surfaces can skip their entrance motion. */
  motion?: "auto" | "none";
  /**
   * Keeps the frame but paints an opaque surface instead of backdrop glass.
   * For popovers over live canvases (terminal WebGL): a backdrop-filter that
   * samples a moving canvas makes Chromium recomposite, and flash, the canvas.
   */
  solid?: boolean;
  /**
   * Frosted glass: a thin tint over a strong blur, for non-interactive hover cards that should
   * let the pane beneath show through. Falls back to the opaque surface without blur support.
   */
  frosted?: boolean;
  style?: CSSProperties;
  autoFocus?: boolean;
  /** See {@link PopoverKind}. `"dialog"` sets the role and the focus contract. */
  kind?: PopoverKind;
  /** Wiring this in hands Popover the outside-click and Escape handling. */
  onDismiss?: (reason: PopoverDismissReason) => void;
  dismissOnEscape?: boolean;
  /** A pointer landing inside anything matching this selector is not outside. */
  ignore?: string;
  ref?: Ref<HTMLDivElement>;
};

/** Shared content inset for popup lists, including lists in native popup windows. */
export const popupListClassName = styles.listContent;

const FRAME = styles.frame;

/** Inline so an opt-in scroll region wins over utility classes a consumer put on the content. */
const SCROLL_STYLE: CSSProperties = { overflowY: "auto", overscrollBehavior: "contain" };

/** Stops macOS rubber-band at the scroll edges of an opted-in scroll region. */
function useScrollFlow(surface: { current: HTMLElement | null }, flow: PopoverFlow) {
  useEffect(() => {
    if (flow !== "scroll" || !surface.current) return;
    return lockOverscroll(surface.current);
  }, [flow, surface]);
}

/** Which corner the open animation grows from, so it reads as anchored. */
function origin(side: PopoverSide, align: PopoverAlign): string {
  const near = align === "start" ? "0%" : align === "end" ? "100%" : "50%";
  if (side === "bottom") return `${near} 0%`;
  if (side === "top") return `${near} 100%`;
  return side === "right" ? `0% ${near}` : `100% ${near}`;
}

function anchorElement(anchor: PopoverAnchor): HTMLElement | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) return anchor;
  return "current" in anchor ? anchor.current : null;
}

function toRect(rect: DOMRect | AnchorRect): AnchorRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function anchorRect(anchor: PopoverAnchor): AnchorRect | null {
  if (!anchor) return null;
  if (anchor instanceof HTMLElement) {
    return toRect(anchor.getBoundingClientRect());
  }
  if ("current" in anchor) {
    const el = anchor.current;
    return el ? toRect(el.getBoundingClientRect()) : null;
  }
  if ("width" in anchor) return toRect(anchor);
  const { x, y } = anchor;
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

/** Points and rects are fresh objects every render; elements keep identity. */
function anchorKey(anchor: PopoverAnchor): unknown {
  if (!anchor || anchor instanceof HTMLElement || "current" in anchor) {
    return anchor;
  }
  if ("width" in anchor) {
    return `${anchor.left}:${anchor.top}:${anchor.width}:${anchor.height}`;
  }
  return `${anchor.x}:${anchor.y}`;
}

function samePosition(a: PopoverPosition | null, b: PopoverPosition): boolean {
  return (
    a != null &&
    a.side === b.side &&
    a.left === b.left &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

/**
 * Anchored secondary surface portalled to the body: placed against a trigger, rect or point with viewport flipping,
 * animated from the anchored edge, with outside-press and Escape dismissal via `onDismiss`.
 * `kind="dialog"` makes it a small non-modal form or details panel (role, focus in, focus return); `flow="scroll"` owns one scroll region.
 * @group overlay
 * @use Anchored custom content: filter panel, small form, details card, picker or list body.
 * @avoid Command menus and searchable or nested pickers of commands: DropdownMenu or ContextMenu. Hover hints: Tooltip. Blocking tasks: Modal. Side panels: Sheet. Never a hand-set role="menu"/"listbox" or role="dialog": use DropdownMenu or kind="dialog".
 */
export function Popover(props: Props) {
  const host = useContext(NativePopupHost);
  return host ? <NativePopover {...props} host={host} /> : <WebPopover {...props} />;
}

function NativePopover({
  host,
  children,
  className,
  maxHeight,
  onDismiss,
  ignore,
  ref,
  style,
  autoFocus,
  dismissOnEscape = true,
  restoreFocus = true,
  passive = false,
  flow = "auto",
  kind,
  ...props
}: Props & { host: HTMLElement }) {
  const surface = useRef<HTMLDivElement | null>(null);
  useScrollFlow(surface, flow);
  const overlayId = useOverlay(
    surface,
    false,
    onDismiss && dismissOnEscape ? () => onDismiss("escape") : undefined,
    true,
    undefined,
    restoreFocus,
    passive,
  );
  const dialog = kind === "dialog";
  useEffect(() => {
    if (dialog && autoFocus !== false) focusDialog(surface.current);
    else if (autoFocus) surface.current?.focus({ preventScroll: true });
  }, [autoFocus, dialog]);
  useEffect(() => {
    if (!onDismiss) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        overlayContainsTarget(overlayId, target) ||
        (ignore && target.closest(ignore))
      )
        return;
      onDismiss("outside");
    };
    window.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
    };
  }, [onDismiss, dismissOnEscape, ignore, overlayId]);
  // These position the ordinary web popover; the OS positions this surface.
  const {
    anchor: _anchor,
    side: _side,
    align: _align,
    gap: _gap,
    padding: _padding,
    width: _width,
    minWidth,
    minHeight: _minHeight,
    constrainHeight: _constrainHeight,
    layer: _layer,
    bare: _bare,
    solid: _solid,
    frosted: _frosted,
    motion: _motion,
    ...rest
  } = props;
  return createPortal(
    <div
      {...(dialog ? { role: "dialog", tabIndex: -1 } : null)}
      {...rest}
      ref={(el) => {
        surface.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      data-popover-flow={flow}
      style={{
        maxHeight: maxHeight ?? 400,
        ...(minWidth != null ? { "--popup-max-width": `${POPUP_MAX_WIDTH}px` } : null),
        ...(flow === "scroll" ? SCROLL_STYLE : null),
        ...style,
      }}
      className={`${minWidth != null ? `${styles.list} ` : ""}${flow === "auto" ? `${styles.bounded} ` : ""}relative w-full outline-none ${className ?? ""}`}
    >
      <OverlayParent.Provider value={overlayId}>{children}</OverlayParent.Provider>
    </div>,
    host,
  );
}

function WebPopover({
  anchor,
  side = "bottom",
  align = "start",
  gap,
  padding,
  width,
  minWidth,
  minHeight,
  maxHeight,
  constrainHeight = true,
  flow = "auto",
  layer = LAYER.popover,
  bare = false,
  solid = false,
  frosted = false,
  className,
  style,
  autoFocus,
  kind,
  onDismiss,
  dismissOnEscape = true,
  restoreFocus = true,
  passive = false,
  motion = "auto",
  ignore,
  ref,
  children,
  ...rest
}: Props) {
  const dialog = kind === "dialog";
  const menuLayer = useContext(OverlayMenuLayer);
  // Preserve the submenu offset while lifting menus above their owning dialog.
  const effectiveLayer = Math.max(layer, menuLayer + (layer === LAYER.submenu ? 1 : 0));
  const frame = useRef<HTMLDivElement | null>(null);
  const overlayId = useOverlay(
    frame,
    false,
    onDismiss && dismissOnEscape ? () => onDismiss("escape") : undefined,
    true,
    undefined,
    restoreFocus,
    passive,
  );
  const surface = useRef<HTMLDivElement | null>(null);
  const scrolls = constrainHeight && flow === "scroll";
  const bounded = constrainHeight && flow === "auto";
  useScrollFlow(surface, scrolls ? "scroll" : "intrinsic");
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const key = anchorKey(anchor);

  const place = useCallback(() => {
    const el = frame.current;
    // A trigger inside a display:none subtree (a background session tab) has a
    // 0,0 rect; hide until it renders again, and its ResizeObserver re-places us.
    const trigger = anchorElement(anchorRef.current);
    if (trigger?.checkVisibility?.() === false) {
      setPosition(null);
      return;
    }
    const rect = anchorRect(anchorRef.current);
    if (!el || !rect) return;
    // DOM rects are physical viewport pixels; CSS placement and offset sizes
    // belong to the portal frame's cumulative zoom, not the trigger's zoom.
    const zoom = cumulativeCssZoom(el);
    const logicalAnchor = {
      left: rect.left / zoom,
      top: rect.top / zoom,
      right: rect.right / zoom,
      bottom: rect.bottom / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
    // offsetWidth rounds a fractional width down; pinning that width wraps the
    // last word of shrink-to-fit content (tooltips), so round the box up.
    const pinnedWidth = el.style.width;
    let naturalWidth: number;
    try {
      // A positioned picker has a pinned width. Measure its new content before
      // reusing that width, including same-height lists loaded after opening.
      if (width == null && minWidth != null) el.style.width = "max-content";
      naturalWidth = Math.max(
        el.offsetWidth,
        Math.ceil(el.getBoundingClientRect().width / zoom - 0.05),
      );
    } finally {
      el.style.width = pinnedWidth;
    }
    const next = placePopover(
      logicalAnchor,
      { width: naturalWidth, height: el.offsetHeight },
      { width: window.innerWidth / zoom, height: window.innerHeight / zoom },
      {
        side,
        align,
        gap,
        padding,
        width: width ?? (minWidth == null ? naturalWidth : popupListWidth(naturalWidth, minWidth)),
        minHeight,
        maxHeight,
      },
    );
    setPosition((prev) => (samePosition(prev, next) ? prev : next));
    // `key` stands in for the anchor, which is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, side, align, gap, padding, width, minWidth, minHeight, maxHeight]);

  useLayoutEffect(() => {
    place();
    // A parent popover may move in the same resize/layout pass. Re-read the
    // anchor after React has committed that placement as well.
    let placementFrame = 0;
    const updatePlacement = () => {
      if (placementFrame) return;
      placementFrame = requestAnimationFrame(() => {
        placementFrame = 0;
        place();
      });
    };
    updatePlacement();
    // Content that lands after open — a branch list, a filtered menu — resizes
    // the surface, and a top-anchored menu has to be measured again to sit
    // above its trigger rather than drift over it.
    const observer = new ResizeObserver(updatePlacement);
    if (frame.current) observer.observe(frame.current);
    const contentObserver = new MutationObserver(updatePlacement);
    if (minWidth != null && surface.current)
      contentObserver.observe(surface.current, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    const trigger = anchorElement(anchorRef.current);
    if (trigger) observer.observe(trigger);
    // Moving a parent frame does not resize its menu row.
    const parentFrame = trigger?.closest("[data-popover-side]")?.parentElement;
    const parentObserver = new MutationObserver(updatePlacement);
    if (parentFrame)
      parentObserver.observe(parentFrame, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", updatePlacement);
    // Scrolling the popover's own content never moves its anchor.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && frame.current?.contains(event.target)) return;
      updatePlacement();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      contentObserver.disconnect();
      parentObserver.disconnect();
      cancelAnimationFrame(placementFrame);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [place, minWidth]);

  const positioned = position != null;
  useEffect(() => {
    // The measuring frame is hidden and cannot receive browser focus.
    if (!positioned) return;
    if (dialog && autoFocus !== false) focusDialog(surface.current);
    // Content that already took focus (a menu row) keeps it.
    else if (autoFocus && !surface.current?.contains(document.activeElement))
      surface.current?.focus({ preventScroll: true });
  }, [autoFocus, positioned, dialog]);

  useEffect(() => {
    if (!onDismiss) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (overlayContainsTarget(overlayId, target)) return;
      if (anchorElement(anchorRef.current)?.contains(target)) return;
      const el = target instanceof Element ? target : (target.parentElement ?? null);
      if (ignore && el?.closest(ignore)) return;
      dismissRef.current?.("outside");
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onDismiss, dismissOnEscape, ignore, overlayId]);

  // The first pass measures the surface off to the side; the layout effect
  // lands it before the browser paints.
  const placed: CSSProperties = position
    ? {
        position: "fixed",
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        ...(constrainHeight ? { maxHeight: position.maxHeight } : {}),
      }
    : {
        position: "fixed",
        left: 0,
        top: 0,
        width: width ?? "max-content",
        ...(constrainHeight
          ? { maxHeight: maxHeight ?? `calc(100vh - ${POPUP_VIEWPORT_PADDING * 2}px)` }
          : {}),
        visibility: "hidden",
      };

  // Keep the backdrop-filter on a stable frame. WebKit can briefly paint a
  // stale backdrop when the same composited element is transformed and then
  // invalidated by a child hover. Only this unblurred content layer moves.
  const frameInset = bare ? 0 : 2;
  const contentMaxHeight = constrainHeight
    ? position
      ? Math.max(0, position.maxHeight - frameInset)
      : maxHeight != null
        ? Math.max(0, maxHeight - frameInset)
        : `calc(100vh - ${POPUP_VIEWPORT_PADDING * 2 + frameInset}px)`
    : undefined;

  return createPortal(
    <div
      ref={frame}
      data-popover-side={position?.side ?? side}
      style={
        {
          ...placed,
          ...(minWidth != null ? { "--popup-max-width": `${POPUP_MAX_WIDTH}px` } : null),
          ...(rest.role === "tooltip" ? { pointerEvents: "none" } : null),
          zIndex: effectiveLayer,
        } as CSSProperties
      }
      className={[!bare && FRAME, minWidth != null && styles.list].filter(Boolean).join(" ")}
    >
      {bare ? null : <PopupBackdrop solid={solid} frosted={frosted} />}
      <div
        {...(dialog ? { role: "dialog", tabIndex: -1 } : null)}
        {...rest}
        ref={(el) => {
          surface.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        data-popover-side={position?.side ?? side}
        data-popover-flow={scrolls ? "scroll" : bounded ? "auto" : "intrinsic"}
        style={{
          ...(contentMaxHeight != null ? { maxHeight: contentMaxHeight } : {}),
          ...(scrolls ? SCROLL_STYLE : null),
          transformOrigin: origin(position?.side ?? side, align),
          ...style,
        }}
        className={`${position && motion !== "none" ? "popover-open " : ""}${bounded ? `${styles.bounded} ` : ""}relative z-[1] outline-none ${className ?? ""}`}
      >
        <OverlayParent.Provider value={overlayId}>{children}</OverlayParent.Provider>
      </div>
    </div>,
    // Keep menus inside their native top-layer owner so they stay visible and interactive.
    anchorElement(anchor)?.closest("dialog[open], [popover]:popover-open") ?? document.body,
  );
}
