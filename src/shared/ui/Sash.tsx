import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { blockTextSelection } from "../lib/drag";
import { beginResizeGesture } from "../lib/resizeGesture";
import styles from "./Sash.module.css";

export type SashEndInfo = {
  /** Escape, pointer cancel, lost capture or window blur ended the drag: restore the start size. */
  cancelled: boolean;
  /** The pointer never moved: a click, not a resize. */
  moved: boolean;
  /** The change came from an arrow key. */
  keyboard: boolean;
};

export type SashProps = Omit<
  ComponentPropsWithRef<"div">,
  "role" | "children" | "onResize" | "aria-label"
> & {
  /** `vertical`: a line between columns, dragged along x. `horizontal`: between rows, along y. */
  orientation: "vertical" | "horizontal";
  /** Accessible name, e.g. "Resize sidebar". */
  label: string;
  onResizeStart?: () => void;
  /** Signed physical pixels since the drag started (x for vertical, y for horizontal),
   *  at most once per animation frame. Callers apply `startSize ± delta` and clamp. */
  onResize?: (delta: number) => void;
  /** Final delta. On `cancelled`, restore the size held at `onResizeStart`. */
  onResizeEnd?: (delta: number, info: SashEndInfo) => void;
  /** Double-click and Enter: reset to the default/equal size. */
  onReset?: () => void;
  /** Arrow-key step in px (default 16); Shift uses `largeStep` (default 64). */
  step?: number;
  largeStep?: number;
  /** `aria-valuenow`/`min`/`max`/`valuetext`, when the size is meaningful (px or %). */
  value?: number;
  min?: number;
  max?: number;
  valueText?: string;
  /** Id of the pane this sash resizes (`aria-controls`). */
  controls?: string;
  /** `line` (default) draws the pane hairline at rest; `hidden` relies on an adjacent pane
   *  border and shows only the hover/drag/focus line. */
  appearance?: "line" | "hidden";
  disabled?: boolean;
};

type Drag = {
  pointerId: number;
  origin: number;
  delta: number;
  moved: boolean;
  frame: number | null;
  finish: (cancelled: boolean) => void;
};

/** Outside the component: React Compiler does not compile `try`/`finally`. A throwing caller
 *  callback must still end the gesture, or deferred work would wait forever. */
function reportThenEnd(report: () => void, end: () => void) {
  try {
    report();
  } finally {
    end();
  }
}

/**
 * Resize handle for every pane splitter: hairline at rest, 2px line on hover/drag/focus, 3px hit area.
 * Pointer drag (captured, rAF-throttled, Escape/blur cancel, text selection suppressed),
 * arrow keys (`step`/`largeStep`, reported as a start/resize/end sequence with
 * `keyboard: true`), double-click/Enter reset, and `role="separator"` semantics.
 * A caller `onKeyDown` that calls `preventDefault()` replaces the built-in keys
 * (e.g. ratio steps with Home/End). Callers keep stored sizes, clamping and persistence.
 * @group layout
 * @use Draggable, keyboard-resizable divider between two panes or a pane and the page.
 * @avoid Hand-rolled resize handles (pointer capture, cursor, keys). Fixed-size layouts need no handle. A static separator without resizing: Divider.
 *
 * @example
 * const start = useRef(width);
 * <Sash
 *   orientation="vertical"
 *   label={t("Resize sidebar")}
 *   value={width} min={180} max={480}
 *   onResizeStart={() => (start.current = width)}
 *   onResize={(delta) => setWidth(clamp(start.current + delta, 180, 480))}
 *   onResizeEnd={(delta, { cancelled }) => cancelled ? setWidth(start.current) : persist()}
 *   onReset={() => setWidth(244)}
 * />
 */
export function Sash({
  orientation,
  label,
  onResizeStart,
  onResize,
  onResizeEnd,
  onReset,
  step = 16,
  largeStep = 64,
  value,
  min,
  max,
  valueText,
  controls,
  appearance = "line",
  disabled = false,
  className,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  ...props
}: SashProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";
  useEffect(() => () => drag.current?.finish(true), []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || disabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current?.finish(true);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const restoreSelection = blockTextSelection();
    // Marks the live resize for size-driven work elsewhere and shows the drag cursor on
    // one shield element; neither restyles the document the way an <html> class would.
    const endGesture = beginResizeGesture(vertical ? "col-resize" : "row-resize");
    const keydown = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      state.finish(true);
    };
    const blur = () => state.finish(true);
    const state: Drag = {
      pointerId: event.pointerId,
      origin: vertical ? event.clientX : event.clientY,
      delta: 0,
      moved: false,
      frame: null,
      finish: (cancelled) => {
        if (drag.current !== state) return;
        drag.current = null;
        if (state.frame !== null) cancelAnimationFrame(state.frame);
        window.removeEventListener("keydown", keydown, true);
        window.removeEventListener("blur", blur);
        if (handle.hasPointerCapture(state.pointerId))
          handle.releasePointerCapture(state.pointerId);
        restoreSelection();
        setDragging(false);
        // The gesture ends after the final size is applied, so deferred work measures the
        // settled layout.
        reportThenEnd(() => {
          if (!cancelled && state.moved) onResize?.(state.delta);
          onResizeEnd?.(state.delta, { cancelled, moved: state.moved, keyboard: false });
        }, endGesture);
      },
    };
    drag.current = state;
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("blur", blur);
    setDragging(true);
    onResizeStart?.();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    props.onPointerMove?.(event);
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const delta = (vertical ? event.clientX : event.clientY) - state.origin;
    if (delta === state.delta) return;
    state.delta = delta;
    state.moved = true;
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      if (drag.current === state) onResize?.(state.delta);
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    props.onPointerUp?.(event);
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    state.finish(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key === "Enter" && onReset) {
      event.preventDefault();
      onReset();
      return;
    }
    const decrease = vertical ? "ArrowLeft" : "ArrowUp";
    const increase = vertical ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = (event.shiftKey ? largeStep : step) * (event.key === increase ? 1 : -1);
    onResizeStart?.();
    onResize?.(amount);
    onResizeEnd?.(amount, { cancelled: false, moved: true, keyboard: true });
  };

  return (
    <div
      tabIndex={disabled ? -1 : 0}
      {...props}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={value !== undefined ? min : undefined}
      aria-valuemax={value !== undefined ? max : undefined}
      aria-valuetext={valueText}
      aria-controls={controls}
      aria-disabled={disabled || undefined}
      data-orientation={orientation}
      data-appearance={appearance}
      data-dragging={dragging || undefined}
      className={[styles.sash, className].filter(Boolean).join(" ")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => {
        props.onPointerCancel?.(event);
        drag.current?.finish(true);
      }}
      onLostPointerCapture={(event) => {
        props.onLostPointerCapture?.(event);
        drag.current?.finish(true);
      }}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        if (event.defaultPrevented || disabled || !onReset) return;
        event.preventDefault();
        onReset();
      }}
    />
  );
}
