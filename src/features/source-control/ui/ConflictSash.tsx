import { useRef, type CSSProperties } from "react";
import { Sash } from "../../../shared/ui/Sash";

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

/** The shared pane `Sash` over the pane grid, working in container fractions: drag, arrow
 * keys (2% steps, 10% with Shift), Home/End, and double-click or Enter to restore the
 * default split. The grid gap already draws the hairline, so the sash only adds the
 * hover, drag and focus line. */
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
  const start = useRef({ value, size: 1 });
  const sign = reverse ? -1 : 1;
  const measure = () => {
    const rect = container.current?.getBoundingClientRect();
    return Math.max(1, (axis === "x" ? rect?.width : rect?.height) ?? 1);
  };
  const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
  const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
  return (
    <Sash
      orientation={axis === "x" ? "vertical" : "horizontal"}
      label={label}
      appearance="hidden"
      className="conflict-sash"
      style={style}
      value={Math.round((reverse ? 1 - value : value) * 100)}
      min={0}
      max={100}
      onResizeStart={() => {
        start.current = { value, size: measure() };
      }}
      onResize={(delta) => onChange(start.current.value + (sign * delta) / start.current.size)}
      onResizeEnd={(_, { cancelled }) => {
        if (cancelled) onChange(start.current.value);
        else onCommit();
      }}
      onReset={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        let next: number;
        if (event.key === decrease) next = value - step * sign;
        else if (event.key === increase) next = value + step * sign;
        else if (event.key === "Home") next = reverse ? 1 : 0;
        else if (event.key === "End") next = reverse ? 0 : 1;
        else return;
        event.preventDefault();
        onChange(next);
        onCommit();
      }}
    />
  );
}
