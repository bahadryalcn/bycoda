import { describe, expect, it, vi } from "vitest";
import { asciiMouthAt, createAsciiMaskScene } from "./asciiMask";
import { ASCII_MASK_ART } from "./asciiMaskArt";
import type { LiveBackgroundPalette } from "./types";

const palette: LiveBackgroundPalette = {
  content: "rgb(200, 200, 200)",
  accent: "rgb(220, 160, 90)",
  monoFont: "monospace",
};

type Layer = {
  width: number;
  height: number;
  glyphs: number;
  getContext(): unknown;
};

/** Layer surfaces count glyph work, so tests can tell one-time rendering from per-frame work. */
function setup() {
  const layers: Layer[] = [];
  const createLayer = (width: number, height: number) => {
    const layer: Layer = {
      width,
      height,
      glyphs: 0,
      getContext: () => ({
        scale() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillText() {
          layer.glyphs++;
        },
      }),
    };
    layers.push(layer);
    return layer as unknown as OffscreenCanvas;
  };
  const calls = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
  };
  const ctx = {
    getTransform: () => ({ a: 2 }),
    clearRect: calls.clearRect,
    drawImage: calls.drawImage,
    fillText: calls.fillText,
    fillRect: calls.fillRect,
    save() {},
    restore() {},
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
  const touched = () =>
    calls.clearRect.mock.calls.length +
    calls.drawImage.mock.calls.length +
    calls.fillText.mock.calls.length +
    calls.fillRect.mock.calls.length;
  return { layers, createLayer, ctx, calls, touched };
}

describe("ASCII mask scene", () => {
  it("paints only the gradient once at rest, then leaves the canvas untouched", () => {
    const { ctx, createLayer, calls, touched } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    scene.draw(ctx, 12, 0, { presence: 0 });
    // Background only: one blit, no mask and no glyph painting on the live canvas.
    expect(calls.drawImage).toHaveBeenCalledTimes(1);
    expect(calls.fillText).not.toHaveBeenCalled();
    const afterFirst = touched();
    for (let frame = 0; frame < 120; frame++) {
      scene.draw(ctx, 12 + frame / 30, 1 / 30, { presence: 0 });
    }
    expect(touched()).toBe(afterFirst);
  });

  it("repaints after a resize wiped the canvas", () => {
    const { ctx, createLayer, calls } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    scene.draw(ctx, 0, 0, { presence: 0 });
    scene.resize(300, 320);
    scene.draw(ctx, 0, 0, { presence: 0 });
    expect(calls.clearRect).toHaveBeenCalledTimes(2);
  });

  it("renders every glyph once into cached layers, never on the live canvas", () => {
    const { ctx, layers, createLayer, calls } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    scene.draw(ctx, 0, 0, { presence: 1 });
    // Background, veil, mask and seven mouth patches, built at the host's pixel ratio.
    expect(layers).toHaveLength(3 + 7);
    expect(layers[0]!.width).toBe(390); // 260 CSS px at the 1.5 cap, not the raw 2x
    const rendered = layers.reduce((sum, layer) => sum + layer.glyphs, 0);
    expect(rendered).toBeGreaterThan(1000);
    for (let frame = 0; frame < 90; frame++) {
      scene.draw(ctx, frame / 30, 1 / 30, { presence: 1 });
    }
    expect(layers.reduce((sum, layer) => sum + layer.glyphs, 0)).toBe(rendered);
    expect(layers).toHaveLength(10);
    expect(calls.fillText).not.toHaveBeenCalled();
  });

  it("lets the mask surface with presence", () => {
    const { ctx, createLayer, calls } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    scene.draw(ctx, 0, 0, { presence: 0 });
    const resting = calls.drawImage.mock.calls.length;
    expect(resting).toBe(1);
    scene.draw(ctx, 0.1, 1 / 30, { presence: 0.5 });
    // Background, veil, mask and the closed mouth.
    expect(calls.drawImage.mock.calls.length - resting).toBe(1 + 3);
  });

  /** The mask is the layer drawn at the largest size after the veil: [x, y, width, height]. */
  function maskRect(width: number, height: number) {
    const { ctx, createLayer, calls } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(width, height);
    scene.draw(ctx, 0, 0, { presence: 1 });
    // Calls: background, veil, mask, mouth.
    const [, x, y, w, h] = calls.drawImage.mock.calls[2]! as number[];
    return { x: x!, y: y!, w: w!, h: h! };
  }

  it("centers the mask behind the conversation at about 78% of the pane height", () => {
    for (const [width, height] of [
      [1440, 640],
      [768, 900],
      [1200, 1100],
    ] as const) {
      const rect = maskRect(width, height);
      expect(rect.x + rect.w / 2).toBeCloseTo(width / 2, 3);
      expect(rect.y + rect.h / 2).toBeCloseTo(height / 2, 3);
      if (rect.w < width) expect(rect.h / height).toBeCloseTo(0.78, 2);
      // The art's aspect is kept.
      expect(rect.w / rect.h).toBeCloseTo((96 * 0.62) / (46 * 1.3), 3);
    }
  });

  it("keeps glyphs at least 6px and crops a very narrow pane instead of shrinking further", () => {
    const narrow = maskRect(200, 600);
    // 6px glyphs: 46 rows of 1.3em.
    expect(narrow.h).toBeCloseTo(46 * 1.3 * 6, 3);
    expect(narrow.w).toBeGreaterThan(200);
    expect(narrow.x).toBeLessThan(0);
    // A short pane never goes below the minimum either.
    expect(maskRect(900, 120).h).toBeCloseTo(46 * 1.3 * 6, 3);
    // A normal portrait pane shrinks to its width but stays above the minimum.
    const portrait = maskRect(390, 1000);
    expect(portrait.w).toBeLessThanOrEqual(390.001);
    expect(portrait.h / portrait.w).toBeCloseTo((46 * 1.3) / (96 * 0.62), 3);
  });

  it("stays faint behind the text: the gradient is capped well below full strength", () => {
    const { ctx, createLayer, calls } = setup();
    const alphas: number[] = [];
    const tracked = ctx as unknown as { globalAlpha: number };
    calls.drawImage.mockImplementation(() => alphas.push(tracked.globalAlpha));
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(1440, 640);
    scene.draw(ctx, 0, 0, { presence: 1 });
    // Background first, then the veil (which only removes background), mask and mouth.
    expect(alphas[0]!).toBeLessThanOrEqual(0.6);
    expect(Math.max(alphas[2]!, alphas[3]!)).toBeLessThan(1);
  });

  it("repaints once per visible presence step and settles back to a single idle state", () => {
    const { ctx, createLayer, calls, touched } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    scene.draw(ctx, 0, 0, { presence: 0.5 });
    const first = calls.clearRect.mock.calls.length;
    scene.draw(ctx, 0.01, 0, { presence: 0.5004 });
    expect(calls.clearRect.mock.calls.length).toBe(first);
    scene.draw(ctx, 0.02, 0, { presence: 0 });
    const idle = touched();
    scene.draw(ctx, 5, 0, { presence: 0 });
    expect(touched()).toBe(idle);
  });

  it("changes mouth shape over time while presence is high, and returns to closed", () => {
    const shapes = new Set<string>();
    for (let frame = 0; frame < 300; frame++) shapes.add(asciiMouthAt(frame / 30, 1));
    expect(shapes.size).toBeGreaterThanOrEqual(5);
    expect(shapes.has("closed")).toBe(true);
    for (const shape of shapes) expect(Object.keys(ASCII_MASK_ART.mouths)).toContain(shape);
    expect(asciiMouthAt(3.3, 1)).toBe(asciiMouthAt(3.3, 1));
    for (let frame = 0; frame < 300; frame++) {
      expect(asciiMouthAt(frame / 30, 0.6)).toBe("closed");
      expect(asciiMouthAt(frame / 30, 0)).toBe("closed");
    }
  });

  it("blits a different mouth patch when the shape changes at full presence", () => {
    const { ctx, createLayer, calls } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(260, 300);
    const patches = new Set<unknown>();
    let paints = 0;
    for (let frame = 0; frame < 300; frame++) {
      const before = calls.clearRect.mock.calls.length;
      scene.draw(ctx, frame / 30, 1 / 30, { presence: 1 });
      if (calls.clearRect.mock.calls.length !== before) {
        paints++;
        patches.add(calls.drawImage.mock.calls.at(-1)![0]);
      }
    }
    expect(patches.size).toBeGreaterThanOrEqual(5);
    // Repainting follows the syllable rhythm, not the 30 fps frame rate.
    expect(paints).toBeLessThan(300 * 0.8);
  });

  it("is deterministic for a still frame", () => {
    const run = () => {
      const { ctx, createLayer, calls } = setup();
      const scene = createAsciiMaskScene(palette, createLayer);
      scene.resize(200, 150);
      scene.draw(ctx, 12, 0, { presence: 0 });
      return calls.drawImage.mock.calls.map((call) => call.slice(1));
    };
    expect(run()).toEqual(run());
  });

  it("releases its layers on dispose and paints nothing for an empty pane", () => {
    const { ctx, layers, createLayer, touched } = setup();
    const scene = createAsciiMaskScene(palette, createLayer);
    scene.resize(0, 0);
    scene.draw(ctx, 0, 0, { presence: 1 });
    expect(touched()).toBe(0);
    scene.resize(260, 300);
    scene.draw(ctx, 0, 0, { presence: 1 });
    expect(layers.every((layer) => layer.width > 0)).toBe(true);
    scene.dispose?.();
    expect(layers.every((layer) => layer.width === 0 && layer.height === 0)).toBe(true);
  });
});
