import { themePalette } from "../../../shared/theme/palette";

type Rgba = readonly [number, number, number, number];

/** CSS is resolved to sRGB by the caller, before xterm parses it. */
function channels(color: string): Rgba | undefined {
  const hex = color.match(/^#([\da-f]{6})([\da-f]{2})?$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) return undefined;
  const values = rgb[1].split(/[\s,/]+/).filter(Boolean);
  if (values.length < 3 || values.some((value) => value.includes("%"))) return undefined;
  const result: Rgba = [Number(values[0]), Number(values[1]), Number(values[2]), values[3] === undefined ? 1 : Number(values[3])];
  return result.every(Number.isFinite) ? result : undefined;
}

function rgb(color: Rgba, alpha = color[3]): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

export type TerminalCanvas = { color: string; resolved: true } | { resolved: false };

/** Resolve painted CSS colors, not a theme token that may describe another pane.
 * Images, opacity groups and filters require pixel/backdrop knowledge we do not
 * have. Keep their glass visible and explicitly decline contrast correction.
 */
export function resolveTerminalCanvas(scope: HTMLElement, resolveColor: (value: string) => string): TerminalCanvas {
  const layers: Rgba[] = [];
  let opaque = false;
  for (let node: HTMLElement | null = scope; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.opacity && Number(style.opacity) < 1) ||
        (style.filter && style.filter !== "none") ||
        (style.backdropFilter && style.backdropFilter !== "none") ||
        (style.mixBlendMode && style.mixBlendMode !== "normal")) return { resolved: false };
    if (opaque) continue;
    if (style.backgroundImage && style.backgroundImage !== "none") return { resolved: false };
    if (!style.backgroundColor || style.backgroundColor === "transparent") continue;
    const color = channels(resolveColor(style.backgroundColor));
    if (!color) return { resolved: false };
    layers.push(color);
    opaque = color[3] === 1;
  }
  if (!opaque) return { resolved: false };
  let result = layers.pop()!;
  while (layers.length) {
    const top = layers.pop()!;
    const alpha = top[3];
    result = [top[0] * alpha + result[0] * (1 - alpha), top[1] * alpha + result[1] * (1 - alpha), top[2] * alpha + result[2] * (1 - alpha), 1];
  }
  return { color: rgb(result), resolved: true };
}

export function terminalRenderingPolicy({ canvas, fallbackCanvas, foreground, cursor, selectionBackground, selectionForeground }: {
  canvas: TerminalCanvas;
  fallbackCanvas: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
}) {
  const effectiveCanvas = canvas.resolved ? canvas.color : fallbackCanvas;
  const reference = channels(effectiveCanvas);
  return {
    // xterm's contrast calculation ignores alpha. Retain the real reference RGB
    // while leaving the canvas transparent: the owning pane paints it once.
    background: reference ? rgb(reference, 0) : themePalette.hex00000000,
    foreground,
    cursor,
    cursorAccent: effectiveCanvas,
    selectionBackground,
    // xterm has one foreground for both selection states; retain the theme's
    // opaque contrast pair when focus leaves the terminal, too.
    selectionInactiveBackground: selectionBackground,
    selectionForeground,
    minimumContrastRatio: canvas.resolved ? 4.5 : 1,
    canvasResolved: canvas.resolved,
  };
}
