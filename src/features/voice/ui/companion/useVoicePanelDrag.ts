import { useRef, type KeyboardEvent, type RefObject } from "react";
import { pointerOutsideWindow } from "../../model/voiceOverlay";
import { clampVoicePosition } from "../../model/voiceSession";
import { pastDragThreshold, startsHeaderDrag, type HeaderDragEvent } from "./voicePanelDrag";

type Position = { x: number; y: number };
const POSITION_KEY = "bycoda:voice-position";
const KEY_STEP = 16;

function savePosition(position: Position) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    /* Position storage is optional. */
  }
}

/**
 * Moves the floating companion by dragging its header anywhere that is not a control, and with the
 * arrow keys on the move handle. A drag only moves the panel's position; it never touches its size.
 */
export function useVoicePanelDrag({
  panel,
  canDetach,
  onDetaching,
  onPosition,
  onPopOut,
}: {
  panel: RefObject<HTMLElement | null>;
  canDetach: boolean;
  onDetaching: (value: boolean) => void;
  onPosition: (position: Position) => void;
  onPopOut: (placement: { fromCursor: true; x: number; y: number }) => void;
}) {
  const grab = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moving: boolean;
    position?: Position;
  } | null>(null);
  const finish = (commit: boolean) => {
    const current = grab.current;
    grab.current = null;
    onDetaching(false);
    if (commit && current?.position) onPosition(current.position);
    return current;
  };
  const outside = (event: HeaderDragEvent) =>
    canDetach &&
    pointerOutsideWindow(event.clientX, event.clientY, window.innerWidth, window.innerHeight);

  return {
    header: {
      onPointerDown: (event: HeaderDragEvent) => {
        if (event.button !== 0 || !panel.current || !startsHeaderDrag(event.target)) return;
        const rect = panel.current.getBoundingClientRect();
        grab.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX - rect.x,
          y: event.clientY - rect.y,
          moving: false,
        };
      },
      onPointerMove: (event: HeaderDragEvent) => {
        const current = grab.current;
        if (!current || current.pointerId !== event.pointerId || !panel.current) return;
        if (!current.moving) {
          if (!pastDragThreshold(event.clientX - current.startX, event.clientY - current.startY))
            return;
          current.moving = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        onDetaching(outside(event));
        const rect = panel.current.getBoundingClientRect();
        const next = clampVoicePosition(
          event.clientX - current.x,
          event.clientY - current.y,
          rect.width,
          rect.height,
          window.innerWidth,
          window.innerHeight,
        );
        current.position = next;
        // Pointer movement owns presentation until release, so audio, transcript and tool
        // controls stay out of the per-event render path.
        Object.assign(panel.current.style, {
          left: `${next.x}px`,
          top: `${next.y}px`,
          right: "auto",
          bottom: "auto",
        });
      },
      onPointerUp: (event: HeaderDragEvent) => {
        if (grab.current?.pointerId !== event.pointerId) return;
        const current = finish(true);
        if (!current?.moving) return;
        // Released beyond the app: continue as a native floating window under the pointer.
        if (outside(event)) {
          onPopOut({ fromCursor: true, x: current.x, y: current.y });
          return;
        }
        if (current.position) savePosition(current.position);
      },
      onPointerCancel: (event: HeaderDragEvent) => {
        if (grab.current?.pointerId === event.pointerId) finish(true);
      },
    },
    onHandleKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-KEY_STEP, 0],
        ArrowRight: [KEY_STEP, 0],
        ArrowUp: [0, -KEY_STEP],
        ArrowDown: [0, KEY_STEP],
      };
      const move = moves[event.key];
      if (!move || !panel.current) return;
      event.preventDefault();
      const rect = panel.current.getBoundingClientRect();
      const next = clampVoicePosition(
        rect.x + move[0],
        rect.y + move[1],
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      );
      onPosition(next);
      savePosition(next);
    },
  };
}
