import { NativePopupHost } from "./NativePopupHost";
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
import { GlassBackdrop } from "../../app/shell/GlassBackdrop";
import { LAYER } from "../lib/layers";
import { cumulativeCssZoom } from "../lib/cssZoom";
import { OverlayMenuLayer, OverlayParent, overlayContainsTarget, useOverlay } from "./overlay";
import {
  placePopover,
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

type Props = Omit<ComponentPropsWithoutRef<"div">, "style"> & {
  anchor: PopoverAnchor;
  side?: PopoverSide;
  align?: PopoverAlign;
  gap?: number;
  padding?: number;
  width?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Defaults to true. Disable for intrinsic-height surfaces like context menus. */
  constrainHeight?: boolean;
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
  style?: CSSProperties;
  autoFocus?: boolean;
  /** Wiring this in hands Popover the outside-click and Escape handling. */
  onDismiss?: (reason: PopoverDismissReason) => void;
  dismissOnEscape?: boolean;
  /** A pointer landing inside anything matching this selector is not outside. */
  ignore?: string;
  ref?: Ref<HTMLDivElement>;
};

const FRAME =
  "isolate overflow-hidden rounded-(--ui-radius-popup) border border-stroke shadow-(--ui-elevation-floating)";

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
 * A menu, dropdown, or flyout that escapes its pane: portalled to the body so
 * no local stacking context can paint over it, placed against its anchor with
 * viewport flipping, and animated in from the anchored edge.
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
  ...props
}: Props & { host: HTMLElement }) {
  const surface = useRef<HTMLDivElement | null>(null);
  const overlayId = useOverlay(
    surface,
    false,
    onDismiss && dismissOnEscape ? () => onDismiss("escape") : undefined,
    true,
    undefined,
    restoreFocus,
    passive,
  );
  useEffect(() => {
    if (autoFocus) surface.current?.focus({ preventScroll: true });
  }, [autoFocus]);
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
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("pointerdown", outside);
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
    minHeight: _minHeight,
    constrainHeight: _constrainHeight,
    layer: _layer,
    bare: _bare,
    solid: _solid,
    motion: _motion,
    ...rest
  } = props;
  return createPortal(
    <div
      {...rest}
      ref={(el) => {
        surface.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      style={{ maxHeight: maxHeight ?? 400, ...style }}
      className={`relative w-full outline-none ${className ?? ""}`}
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
  minHeight,
  maxHeight,
  constrainHeight = true,
  layer = LAYER.popover,
  bare = false,
  solid = false,
  className,
  style,
  autoFocus = false,
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
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const key = anchorKey(anchor);

  const place = useCallback(() => {
    const el = frame.current;
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
    const next = placePopover(
      logicalAnchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth / zoom, height: window.innerHeight / zoom },
      { side, align, gap, padding, width, minHeight, maxHeight },
    );
    setPosition((prev) => (samePosition(prev, next) ? prev : next));
    // `key` stands in for the anchor, which is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, side, align, gap, padding, width, minHeight, maxHeight]);

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
    const trigger = anchorElement(anchorRef.current);
    if (trigger) observer.observe(trigger);
    // Moving a parent frame does not resize its menu row.
    const parentFrame = trigger?.closest("[data-popover-side]")?.parentElement;
    const parentObserver = new MutationObserver(updatePlacement);
    if (parentFrame)
      parentObserver.observe(parentFrame, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      observer.disconnect();
      parentObserver.disconnect();
      cancelAnimationFrame(placementFrame);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [place]);

  const positioned = position != null;
  useEffect(() => {
    // The measuring frame is hidden and cannot receive browser focus.
    if (autoFocus && positioned) surface.current?.focus({ preventScroll: true });
  }, [autoFocus, positioned]);

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
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
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
        ...(constrainHeight ? { maxHeight: maxHeight ?? "calc(100vh - 16px)" } : {}),
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
        : `calc(100vh - ${16 + frameInset}px)`
    : undefined;

  return createPortal(
    <div
      ref={frame}
      data-popover-side={position?.side ?? side}
      style={{ ...placed, zIndex: effectiveLayer }}
      className={bare ? undefined : FRAME}
    >
      {bare ? null : solid ? (
        <div
          aria-hidden="true"
          className="popover-solid pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
        />
      ) : (
        <GlassBackdrop />
      )}
      <div
        {...rest}
        ref={(el) => {
          surface.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        data-popover-side={position?.side ?? side}
        style={{
          ...(contentMaxHeight != null ? { maxHeight: contentMaxHeight } : {}),
          transformOrigin: origin(position?.side ?? side, align),
          ...style,
        }}
        className={`${position && motion !== "none" ? "popover-open " : ""}relative z-[1] outline-none ${className ?? ""}`}
      >
        <OverlayParent.Provider value={overlayId}>{children}</OverlayParent.Provider>
      </div>
    </div>,
    // Keep menus inside their native top-layer owner so they stay visible and interactive.
    anchorElement(anchor)?.closest("dialog[open], [popover]:popover-open") ?? document.body,
  );
}
