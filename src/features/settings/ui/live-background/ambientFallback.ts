import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Static, inexpensive contours when the native GPU surface is unavailable. */
export function createAmbientFallbackScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = palette.content;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.18;
      for (let line = 0; line < 16; line++) {
        const offset = line / 16;
        ctx.beginPath();
        ctx.moveTo(-width * 0.1, height * (0.2 + offset * 0.6));
        ctx.bezierCurveTo(
          width * 0.3,
          height * (offset - 0.2),
          width * 0.65,
          height * (1.2 - offset),
          width * 1.1,
          height * (0.25 + offset * 0.5),
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
