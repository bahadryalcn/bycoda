/** Width of the question panel beside the voice companion, in CSS pixels. */
export const VOICE_SIDE_PANEL_WIDTH = 340;
/** Space between the companion and its question panel. */
export const VOICE_SIDE_PANEL_GAP = 8;
const EDGE = 8;
const MIN_HEIGHT = 220;

export type VoiceSidePlacement =
  | { side: "right" | "left"; x: number; bottom: number; width: number; maxHeight: number }
  | { side: "top"; x: number; bottom: number; width: number; maxHeight: number }
  | { side: "inline" };

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Where the question panel opens next to the companion: beside it on the side with room (right
 * first), above it when neither side fits, or inside the panel when the window is too small.
 * `bottom` is the distance from the viewport bottom, so the panel lines up with the companion's
 * bottom edge and grows upward.
 */
export function placeVoiceSidePanel(
  panel: Rect,
  viewport: { width: number; height: number },
  width = VOICE_SIDE_PANEL_WIDTH,
): VoiceSidePlacement {
  const gap = VOICE_SIDE_PANEL_GAP;
  const bottom = Math.max(EDGE, viewport.height - panel.bottom);
  const besideHeight = viewport.height - bottom - EDGE;
  if (besideHeight >= MIN_HEIGHT) {
    if (viewport.width - panel.right - EDGE >= width + gap)
      return { side: "right", x: panel.right + gap, bottom, width, maxHeight: besideHeight };
    if (panel.left - EDGE >= width + gap)
      return { side: "left", x: panel.left - gap - width, bottom, width, maxHeight: besideHeight };
  }
  const above = panel.top - gap - EDGE;
  if (above >= MIN_HEIGHT) {
    const topWidth = Math.max(panel.right - panel.left, Math.min(width, viewport.width - 2 * EDGE));
    const x = Math.max(EDGE, Math.min(panel.left, viewport.width - EDGE - topWidth));
    return {
      side: "top",
      x,
      bottom: viewport.height - panel.top + gap,
      width: topWidth,
      maxHeight: above,
    };
  }
  return { side: "inline" };
}

export type VoiceOverlaySide = "right" | "left" | "inline";

/**
 * The detached voice window grows toward the side of the screen with room for the question panel.
 * `room` is the free space to the left and right of the window on its monitor, in CSS pixels.
 */
export function voiceOverlaySide(
  room: { left: number; right: number },
  width = VOICE_SIDE_PANEL_WIDTH,
): VoiceOverlaySide {
  const needed = width + VOICE_SIDE_PANEL_GAP;
  if (room.right >= needed) return "right";
  if (room.left >= needed) return "left";
  return "inline";
}
