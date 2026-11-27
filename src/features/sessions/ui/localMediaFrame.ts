import type { CSSProperties } from "react";

/** Widest a transcript media frame grows, so wide diagrams use wide panes without filling them. */
const MAX_FRAME_WIDTH = "40rem";
/** Tallest a transcript media frame grows; tall captures scale down to this height. */
const MAX_FRAME_HEIGHT = "32rem";

/**
 * Frame sizing from the media's intrinsic dimensions. Returns undefined while the
 * dimensions are unknown so the caller keeps the stable 16:9 placeholder.
 */
export function localMediaFrameStyle(
  size: { width: number; height: number } | undefined,
): CSSProperties | undefined {
  if (!size) return undefined;
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  const ratio = width / height;
  return {
    aspectRatio: `${width} / ${height}`,
    // Never upscale past the intrinsic width, never exceed the frame bounds, and
    // let the height cap translate into a width cap for tall media.
    width: `min(100%, ${width}px, ${MAX_FRAME_WIDTH}, calc(${MAX_FRAME_HEIGHT} * ${ratio}))`,
  };
}
