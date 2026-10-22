import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=<>/\\|{}[]";
const FONT_SIZE = 14;
const CELL_W = 10;
const CELL_H = 18;
/** Glyphs are pre-rendered at this scale so HiDPI panes stay crisp. */
const ATLAS_SCALE = 2;
/** Alpha steps per glyph in the atlas; a cell draws the step nearest its brightness. */
const LEVELS = 8;
const ATLAS_COLUMNS = 48;
const MAX_STEP = 0.05;
/** Glitches per cell per second at rest and at full speech energy. */
const GLITCH_REST = 0.2;
const GLITCH_SPEECH = 0.8;
const HOLD_MIN = 0.25;
const HOLD_MAX = 1.1;
/** Accent highlight strength, and how many rows a speech burst scrambles. */
const BURST_BAND = 3;
const BURST_RISE = 0.05;

/**
 * Pre-renders every glyph at every alpha step in both tones (content and accent)
 * into one canvas, so a frame is just one drawImage per visible cell.
 */
function buildAtlas(palette: LiveBackgroundPalette): HTMLCanvasElement | null {
  const slotW = CELL_W * ATLAS_SCALE;
  const slotH = CELL_H * ATLAS_SCALE;
  const slots = GLYPHS.length * 2 * LEVELS;
  const atlas = document.createElement("canvas");
  atlas.width = ATLAS_COLUMNS * slotW;
  atlas.height = Math.ceil(slots / ATLAS_COLUMNS) * slotH;
  const ctx = atlas.getContext("2d");
  if (!ctx) return null;
  ctx.font = `${FONT_SIZE * ATLAS_SCALE}px ${palette.monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let glyph = 0; glyph < GLYPHS.length; glyph++) {
    for (let tone = 0; tone < 2; tone++) {
      ctx.fillStyle = tone === 1 ? (palette.signal ?? palette.accent) : palette.content;
      for (let level = 1; level <= LEVELS; level++) {
        const slot = (glyph * 2 + tone) * LEVELS + level - 1;
        const x = (slot % ATLAS_COLUMNS) * slotW;
        const y = Math.floor(slot / ATLAS_COLUMNS) * slotH;
        ctx.globalAlpha = level / LEVELS;
        ctx.fillText(GLYPHS[glyph], x + slotW / 2, y + slotH / 2);
      }
    }
  }
  return atlas;
}

/**
 * A character grid that glitches. Idle, a few cells per second swap glyphs and
 * the field breathes in brightness. Speech raises the glitch rate, scrambles a
 * band of rows on each burst, and lights the swapped cells in the accent color.
 */
export function createLetterGlitchScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const atlas = buildAtlas(palette);
  const slotW = CELL_W * ATLAS_SCALE;
  const slotH = CELL_H * ATLAS_SCALE;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let chars = new Uint8Array(0);
  /** Seconds each cell stays in the accent tone after a glitch. */
  let hold = new Float32Array(0);
  let glow = new Float32Array(0);
  let field = new Float32Array(0);
  let debt = 0;
  let energy = 0;

  const randomGlyph = () => Math.floor(Math.random() * GLYPHS.length);

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      cols = Math.ceil(width / CELL_W);
      rows = Math.ceil(height / CELL_H);
      chars = new Uint8Array(cols * rows);
      for (let i = 0; i < chars.length; i++) chars[i] = randomGlyph();
      hold = new Float32Array(cols * rows);
      glow = new Float32Array(cols * rows);
      field = new Float32Array(cols * rows);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          // Broad color islands echo React Bits' flowing character field.
          const value =
            Math.sin(col * 0.12 + Math.sin(row * 0.09) * 2) * Math.cos(row * 0.15 - col * 0.045);
          field[row * cols + col] = value * 0.5 + 0.5;
          glow[row * cols + col] = field[row * cols + col] > 0.6 ? 0.65 : 0;
        }
      }
      debt = 0;
      energy = 0;
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (!atlas || chars.length === 0) return;
      const dt = Math.min(Math.max(delta, 0), MAX_STEP);
      const { presence } = signal;
      const rise = signal.energy - energy;
      energy = signal.energy;

      // A new burst of speech scrambles a short band of rows at once.
      if (presence > 0.2 && rise > BURST_RISE) {
        const top = Math.floor(Math.random() * rows);
        for (let row = top; row < Math.min(rows, top + BURST_BAND); row++) {
          for (let col = 0; col < cols; col++) {
            const i = row * cols + col;
            chars[i] = randomGlyph();
            hold[i] = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
          }
        }
      }

      const rate = GLITCH_REST + GLITCH_SPEECH * signal.energy * presence;
      debt += chars.length * rate * dt;
      while (debt >= 1) {
        debt -= 1;
        const i = Math.floor(Math.random() * chars.length);
        chars[i] = randomGlyph();
        hold[i] = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
      }

      const brightness = 0.85 + 0.45 * presence;
      for (let row = 0; row < rows; row++) {
        const rowWave = 0.5 + 0.5 * Math.sin(row * 0.31 - time * 0.45);
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (hold[i] > 0) hold[i] = Math.max(0, hold[i] - dt);
          // Smoothly transition between neutral and accent glyphs without erasing the field.
          const target = hold[i] > 0 ? 1 : field[i] > 0.6 ? 0.55 : 0;
          glow[i] += (target - glow[i]) * (1 - Math.exp(-dt * 6));
          const accent = glow[i] > 0.35;
          const colWave = 0.5 + 0.5 * Math.sin(col * 0.13 + time * 0.6 + row * 0.05);
          const edgeX = Math.min(col + 1, cols - col) / Math.max(1, cols * 0.12);
          const edgeY = Math.min(row + 1, rows - row) / Math.max(1, rows * 0.12);
          const edge = Math.min(1, edgeX, edgeY);
          const alpha =
            (accent ? 0.3 + glow[i] * 0.55 : 0.12 + 0.25 * rowWave * colWave) * brightness * edge;
          const step = Math.min(LEVELS, Math.round(Math.min(1, alpha) * LEVELS));
          if (step < 1) continue;
          const slot = (chars[i] * 2 + (accent ? 1 : 0)) * LEVELS + step - 1;
          ctx.drawImage(
            atlas,
            (slot % ATLAS_COLUMNS) * slotW,
            Math.floor(slot / ATLAS_COLUMNS) * slotH,
            slotW,
            slotH,
            col * CELL_W,
            row * CELL_H,
            CELL_W,
            CELL_H,
          );
        }
      }
    },
  };
}
