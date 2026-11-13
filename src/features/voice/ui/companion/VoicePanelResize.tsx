import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Portal } from "../../../../shared/ui/Portal";
import { clampVoicePosition } from "../../model/voiceSession";
import styles from "./VoiceCompanionParts.module.css";

type Size = { width: number; height: number };
type Position = { x: number; y: number };
const DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type Direction = (typeof DIRECTIONS)[number];

const STORAGE_KEY = "bycoda:voice-size";
const MIN = { width: 320, height: 260 };

/** Keeps a chosen size inside the window; the panel never outgrows the viewport. */
export function clampVoicePanelSize(size: Size, viewportWidth: number, viewportHeight: number) {
  return {
    width: Math.round(Math.min(Math.max(MIN.width, size.width), Math.max(0, viewportWidth - 16))),
    height: Math.round(
      Math.min(Math.max(MIN.height, size.height), Math.max(0, viewportHeight - 16)),
    ),
  };
}

function storedSize(): Size | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Size> | null;
    return Number.isFinite(value?.width) && Number.isFinite(value?.height)
      ? { width: value!.width!, height: value!.height! }
      : undefined;
  } catch {
    return undefined;
  }
}

function applySize(panel: HTMLElement, size: Size | undefined) {
  if (!size) {
    panel.style.removeProperty("--voice-panel-width");
    panel.style.removeProperty("--voice-panel-height");
    delete panel.dataset.sized;
    return;
  }
  panel.style.setProperty("--voice-panel-width", `${size.width}px`);
  panel.style.setProperty("--voice-panel-height", `${size.height}px`);
  panel.dataset.sized = "";
}

function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Size and position storage are optional. */
  }
}

/**
 * Edge and corner targets resize the expanded companion with the opposite edge anchored.
 * Double-clicking any of them restores automatic sizing.
 */
export function VoicePanelResize({
  panel,
  onPosition,
}: {
  panel: RefObject<HTMLElement | null>;
  onPosition: (position: Position) => void;
}) {
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const grab = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rect: DOMRect;
    direction: Direction;
  } | null>(null);
  // Passive effects: the parent's panel ref is attached only after this child's layout phase.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Restore the panel DOM size and attach edge portals after the parent ref is available.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    setSurface(node);
    const stored = storedSize();
    applySize(node, stored && clampVoicePanelSize(stored, window.innerWidth, window.innerHeight));
    return () => applySize(node, undefined);
  }, [panel]);

  const resize = (rect: DOMRect, width: number, height: number, direction: Direction) => {
    const node = panel.current;
    if (!node) return;
    const size = clampVoicePanelSize({ width, height }, window.innerWidth, window.innerHeight);
    // Automatic height can be below the drag minimum; horizontal resizing preserves it.
    if (!direction.includes("e") && !direction.includes("w")) size.width = rect.width;
    if (!direction.includes("n") && !direction.includes("s")) size.height = rect.height;
    // An edge stops at the viewport without moving its opposite anchor.
    size.width = Math.min(
      size.width,
      direction.includes("w") ? rect.right - 8 : window.innerWidth - rect.left - 8,
    );
    size.height = Math.min(
      size.height,
      direction.includes("n") ? rect.bottom - 8 : window.innerHeight - rect.top - 8,
    );
    applySize(node, size);
    const next = clampVoicePosition(
      direction.includes("w") ? rect.right - size.width : rect.left,
      direction.includes("n") ? rect.bottom - size.height : rect.top,
      size.width,
      size.height,
      window.innerWidth,
      window.innerHeight,
    );
    Object.assign(node.style, {
      left: `${next.x}px`,
      top: `${next.y}px`,
      right: "auto",
      bottom: "auto",
    });
  };
  const commit = (size: Size, next: Position) => {
    onPosition(next);
    save(STORAGE_KEY, size);
    save("bycoda:voice-position", next);
  };
  const start = (event: PointerEvent<HTMLElement>, direction: Direction) => {
    if (event.button !== 0 || grab.current || !panel.current) return;
    event.preventDefault();
    event.stopPropagation();
    grab.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: panel.current.getBoundingClientRect(),
      direction,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = grab.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { rect, direction } = current;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    resize(
      rect,
      rect.width + (direction.includes("w") ? -dx : direction.includes("e") ? dx : 0),
      rect.height + (direction.includes("n") ? -dy : direction.includes("s") ? dy : 0),
      direction,
    );
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    if (grab.current?.pointerId !== event.pointerId) return;
    grab.current = null;
    const rect = panel.current?.getBoundingClientRect();
    if (rect) commit({ width: rect.width, height: rect.height }, { x: rect.x, y: rect.y });
  };
  const reset = () => {
    const node = panel.current;
    if (!node) return;
    const bottom = node.getBoundingClientRect().bottom;
    applySize(node, undefined);
    save(STORAGE_KEY, undefined);
    const rect = node.getBoundingClientRect();
    onPosition(
      clampVoicePosition(
        rect.x,
        bottom - rect.height,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  };
  if (!surface) return null;
  return (
    <Portal target={surface}>
      {DIRECTIONS.map((direction) => (
        <div
          key={direction}
          aria-hidden="true"
          data-resize-direction={direction}
          className={styles.resizeEdge}
          onPointerDown={(event) => start(event, direction)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onDoubleClick={reset}
        />
      ))}
    </Portal>
  );
}
