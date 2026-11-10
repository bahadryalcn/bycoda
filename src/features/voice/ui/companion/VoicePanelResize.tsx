import { useEffect, useRef, type RefObject } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { GripVertical } from "../../../../shared/ui/icons";
import { clampVoicePosition } from "../../model/voiceSession";
import styles from "./VoiceCompanionParts.module.css";

type Size = { width: number; height: number };
type Position = { x: number; y: number };

const STORAGE_KEY = "bycoda:voice-size";
const MIN = { width: 320, height: 260 };
const STEP = 24;

/** Keeps a chosen size inside the window; the panel never outgrows the viewport. */
export function clampVoicePanelSize(size: Size, viewportWidth: number, viewportHeight: number) {
  return {
    width: Math.round(Math.max(MIN.width, Math.min(size.width, viewportWidth - 16))),
    height: Math.round(Math.max(MIN.height, Math.min(size.height, viewportHeight - 16))),
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
 * Header grip that resizes the expanded companion. Dragging grows the panel up and away from the
 * nearer window edge, keeping the bottom and the opposite side in place. Arrow keys resize in steps; double-click returns to the automatic size.
 */
export function VoicePanelResize({
  panel,
  position,
  onPosition,
}: {
  panel: RefObject<HTMLElement | null>;
  position: Position | null;
  onPosition: (position: Position) => void;
}) {
  const grip = useRef<HTMLButtonElement>(null);
  // Which way the panel grows; read by handlers and mirrored on the grip for cursor and icon.
  const sideRef = useRef<"left" | "right">("right");
  const grab = useRef<{ pointerId: number; x: number; y: number; rect: DOMRect } | null>(null);
  // Passive effects: the parent's panel ref is attached only after this child's layout phase.
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const stored = storedSize();
    applySize(node, stored && clampVoicePanelSize(stored, window.innerWidth, window.innerHeight));
    return () => applySize(node, undefined);
  }, [panel]);
  useEffect(() => {
    // A gesture keeps the side it started on: the growing panel crosses the window midline,
    // and flipping then would invert the drag and make the width jump between sizes.
    if (grab.current) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    sideRef.current = rect.x + rect.width / 2 > window.innerWidth / 2 ? "left" : "right";
    grip.current?.setAttribute("data-side", sideRef.current);
  }, [panel, position]);

  const resize = (rect: DOMRect, width: number, height: number) => {
    const node = panel.current;
    const side = sideRef.current;
    if (!node) return;
    const size = clampVoicePanelSize({ width, height }, window.innerWidth, window.innerHeight);
    applySize(node, size);
    const next = clampVoicePosition(
      side === "right" ? rect.left : rect.right - size.width,
      rect.bottom - size.height,
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
    return { size, next };
  };
  const commit = (result: ReturnType<typeof resize>) => {
    if (!result) return;
    onPosition(result.next);
    save(STORAGE_KEY, result.size);
    save("bycoda:voice-position", result.next);
  };
  const label = t("Resize voice companion");
  return (
    <Button
      iconOnly
      variant="ghost"
      size="sm"
      label={label}
      tooltip={t("Drag to resize. Double-click for the automatic size.")}
      className={styles.resize}
      ref={grip}
      onPointerDown={(event) => {
        if (event.button !== 0 || !panel.current) return;
        grab.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          rect: panel.current.getBoundingClientRect(),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = grab.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const dx = event.clientX - start.x;
        resize(
          start.rect,
          start.rect.width + (sideRef.current === "right" ? dx : -dx),
          start.rect.height - (event.clientY - start.y),
        );
      }}
      onPointerUp={(event) => {
        const start = grab.current;
        if (!start || start.pointerId !== event.pointerId) return;
        grab.current = null;
        const rect = panel.current?.getBoundingClientRect();
        if (rect)
          commit({
            size: { width: rect.width, height: rect.height },
            next: { x: rect.x, y: rect.y },
          });
      }}
      onPointerCancel={() => {
        grab.current = null;
      }}
      onDoubleClick={() => {
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
      }}
      onKeyDown={(event) => {
        const out = sideRef.current === "right" ? STEP : -STEP;
        const steps: Record<string, [number, number]> = {
          ArrowLeft: [-out, 0],
          ArrowRight: [out, 0],
          ArrowUp: [0, STEP],
          ArrowDown: [0, -STEP],
        };
        const step = steps[event.key];
        const rect = panel.current?.getBoundingClientRect();
        if (!step || !rect) return;
        event.preventDefault();
        event.stopPropagation();
        commit(resize(rect, rect.width + step[0], rect.height + step[1]));
      }}
    >
      <GripVertical className={`icon-sm ${styles.resizeIcon}`} />
    </Button>
  );
}
