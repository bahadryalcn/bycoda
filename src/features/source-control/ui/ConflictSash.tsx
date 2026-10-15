import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { suppressTextSelection } from "../../../shared/lib/drag";
import { t } from "../../../shared/i18n/git";

export type PaneSizes = { x: number; y: number; c1: number; c3: number };
export const DEFAULT_PANE_SIZES: PaneSizes = { x: 0.5, y: 0.5, c1: 1 / 3, c3: 1 / 3 };
const STORAGE_KEY = "bycoda.conflictPaneSizes";

export function loadPaneSizes(): PaneSizes {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<PaneSizes>;
    return clampSizes({ ...DEFAULT_PANE_SIZES, ...saved });
  } catch {
    return DEFAULT_PANE_SIZES;
  }
}

export function savePaneSizes(sizes: PaneSizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    /* In-memory sizes still work. */
  }
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** Every pane keeps a usable minimum; the result column keeps at least a fifth. */
export function clampSizes(sizes: PaneSizes): PaneSizes {
  const c1 = clamp(sizes.c1, 0.12, 0.68);
  return {
    x: clamp(sizes.x, 0.15, 0.85),
    y: clamp(sizes.y, 0.15, 0.85),
    c1,
    c3: clamp(sizes.c3, 0.12, 0.8 - c1),
  };
}

/** A native separator over the pane grid: drag, arrow keys, Home/End, and
 * double-click or Enter to restore the default split. */
export function ConflictSash({
  axis,
  value,
  reverse = false,
  label,
  style,
  container,
  onChange,
  onCommit,
  onReset,
}: {
  axis: "x" | "y";
  /** Fraction of the container measured from the start edge (or the end when reversed). */
  value: number;
  reverse?: boolean;
  label: string;
  style: CSSProperties;
  container: { current: HTMLElement | null };
  onChange: (value: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  const fromPointer = (event: { clientX: number; clientY: number }) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio =
      axis === "x"
        ? (event.clientX - rect.left) / Math.max(1, rect.width)
        : (event.clientY - rect.top) / Math.max(1, rect.height);
    return reverse ? 1 - ratio : ratio;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    document.documentElement.classList.add("is-resizing");
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId === pointerId) onChange(fromPointer(next));
    };
    const stop = (next?: globalThis.PointerEvent) => {
      if (next && next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      restoreSelection();
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      cancel.current = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      onCommit();
    };
    cancel.current = () => stop();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
  const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      title={t("Drag to resize. Double-click to reset.")}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((reverse ? 1 - value : value) * 100)}
      className="conflict-sash"
      data-axis={axis}
      data-dragging={dragging || undefined}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.preventDefault();
        onReset();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        const direction = reverse ? -1 : 1;
        let next: number;
        if (event.key === decrease) next = value - step * direction;
        else if (event.key === increase) next = value + step * direction;
        else if (event.key === "Home") next = reverse ? 1 : 0;
        else if (event.key === "End") next = reverse ? 0 : 1;
        else if (event.key === "Enter") {
          event.preventDefault();
          onReset();
          return;
        } else return;
        event.preventDefault();
        onChange(next);
        onCommit();
      }}
    />
  );
}
