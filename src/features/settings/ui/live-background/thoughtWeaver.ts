import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const DESIGN_WIDTH = 176;
const DESIGN_HEIGHT = 204;
const WARP_COUNT = 11;
const WEFT_COUNT = 15;

/** The cloth keeps its silhouette through resize, pause and scene previews. */
function threadPoint(column: number, row: number): readonly [number, number] {
  const across = column / (WARP_COUNT - 1);
  const down = row / (WEFT_COUNT - 1);
  const spread = 92 - 12 * down;
  const fold = Math.sin(across * Math.PI) * Math.sin(down * Math.PI) * 5;
  return [88 + (across - 0.5) * spread + Math.sin(down * 3) * 3, 61 + down * 102 + fold];
}

/**
 * A pane-wide computational loom. Stable ASCII stitches form a hanging fabric;
 * a single shuttle travels through its unfinished edge while work is present.
 * The clock is integrated from presence, so pausing never moves the cloth or
 * makes the shuttle jump. Stream bursts do not alter geometry or brightness.
 */
export function createThoughtWeaverScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let phase = 0.6;

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
    },

    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;

      const presence = Math.max(0, Math.min(1, signal.presence));
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
      phase += dt * presence * 1.8;

      const across = (width / DESIGN_WIDTH) * 0.94;
      const down = (height / DESIGN_HEIGHT) * 0.94;
      const shuttleColumn = (0.5 + Math.sin(phase) * 0.44) * (WARP_COUNT - 1);
      const shuttle = threadPoint(shuttleColumn, 4);
      ctx.save();
      ctx.translate((width - DESIGN_WIDTH * across) / 2, (height - DESIGN_HEIGHT * down) / 2);
      ctx.scale(across, down);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = palette.content;
      ctx.fillStyle = palette.content;

      // Two open supports make a recognizable loom without a surrounding box.
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      ctx.moveTo(30, 176);
      ctx.bezierCurveTo(24, 130, 25, 70, 38, 38);
      ctx.bezierCurveTo(61, 30, 114, 30, 138, 38);
      ctx.bezierCurveTo(151, 70, 152, 130, 146, 176);
      ctx.stroke();

      ctx.globalAlpha = 0.52;
      ctx.beginPath();
      ctx.moveTo(35, 49);
      ctx.quadraticCurveTo(88, 42, 141, 49);
      ctx.moveTo(31, 174);
      ctx.quadraticCurveTo(88, 182, 145, 174);
      ctx.stroke();

      // Warp threads remain fixed; loose ends below the fabric are short.
      ctx.lineWidth = 0.65;
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      for (let column = 0; column < WARP_COUNT; column++) {
        const top = threadPoint(column, 0);
        ctx.moveTo(top[0], 48);
        for (let row = 0; row < WEFT_COUNT; row++) {
          const [x, y] = threadPoint(column, row);
          ctx.lineTo(x, y);
        }
        const bottom = threadPoint(column, WEFT_COUNT - 1);
        ctx.lineTo(bottom[0] + Math.sin(column * 1.7) * 2, bottom[1] + 8 + (column % 3) * 2);
      }
      ctx.stroke();

      // The lower fabric is woven, the upper warp is still open. Alternating
      // breaks at each crossing suggest over/under threads rather than a grid.
      ctx.lineWidth = 0.85;
      for (let row = 5; row < WEFT_COUNT; row++) {
        ctx.strokeStyle = row % 4 === 1 ? palette.accent : palette.content;
        ctx.globalAlpha = row % 4 === 1 ? 0.5 : 0.4;
        ctx.beginPath();
        for (let column = 0; column < WARP_COUNT - 1; column++) {
          const a = threadPoint(column, row);
          const b = threadPoint(column + 1, row);
          const inset = (column + row) % 2 === 0 ? 1.1 : 0.25;
          ctx.moveTo(a[0] + inset, a[1]);
          ctx.lineTo(b[0] - inset, b[1]);
        }
        ctx.stroke();
      }

      // A sparse fixed alphabet is woven into a diagonal seam. It is artwork,
      // not simulated source code or scrolling text behind the conversation.
      ctx.font = `7px ${palette.monoFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = palette.content;
      ctx.globalAlpha = 0.72;
      const stitches = [":", "+", ":", "=", ":", "+", ":"];
      for (let stitch = 0; stitch < stitches.length; stitch++) {
        const column = 2 + ((stitch * 2) % 7);
        const row = 6 + stitch;
        const [x, y] = threadPoint(column, row);
        ctx.fillText(stitches[stitch]!, x, y - 2.5);
      }

      // The shuttle completes a visible pass in a few seconds while working.
      ctx.strokeStyle = palette.accent;
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.52 + presence * 0.12;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      const start = threadPoint(0, 4);
      ctx.moveTo(start[0], start[1]);
      ctx.quadraticCurveTo((start[0] + shuttle[0]) / 2, start[1] + 2, shuttle[0], shuttle[1]);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(shuttle[0] - 7, shuttle[1]);
      ctx.lineTo(shuttle[0], shuttle[1] - 3.5);
      ctx.lineTo(shuttle[0] + 7, shuttle[1]);
      ctx.lineTo(shuttle[0], shuttle[1] + 3.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(shuttle[0], shuttle[1], 1.1, 0, Math.PI * 2);
      ctx.fill();

      // Light follows the woven rows behind the shuttle. Fixed row counts keep
      // the whole background responsive without allocating particles each frame.
      if (presence > 0) {
        ctx.lineWidth = 1.25;
        for (let row = 5; row < WEFT_COUNT; row++) {
          const wave = (Math.sin(phase * 2 - row * 0.55) + 1) / 2;
          ctx.globalAlpha = presence * wave ** 3 * 0.6;
          ctx.beginPath();
          for (let column = 0; column < WARP_COUNT; column++) {
            const [x, y] = threadPoint(column, row);
            if (column === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // The quiet source above the loom is an open knot, with three short
      // thought threads feeding the warp. Its outline never expands or pulses.
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(88, 12);
      ctx.lineTo(94, 19);
      ctx.lineTo(88, 26);
      ctx.lineTo(82, 19);
      ctx.closePath();
      ctx.moveTo(84, 27);
      ctx.quadraticCurveTo(77, 33, 69, 42);
      ctx.moveTo(88, 29);
      ctx.lineTo(88, 41);
      ctx.moveTo(92, 27);
      ctx.quadraticCurveTo(100, 33, 108, 42);
      ctx.stroke();
      ctx.restore();
    },
  };
}
