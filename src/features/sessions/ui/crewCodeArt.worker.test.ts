// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createCodeArtPainter } from "./crewCodeArt";
import { prepareClassicCrewAssets } from "./crewCanvasAssets";
import { themePalette } from "../../../shared/theme/palette";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("paints software fallback entirely through injected offscreen factory, without document", () => {
  const calls: string[] = [];
  class Surface {
    width = 1;
    height = 1;
    context: any = new Proxy(
      { canvas: this },
      {
        get: (target, key) => {
          if (key in target) return (target as any)[key];
          if (key === "getImageData")
            return () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) });
          if (key === "createImageData")
            return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
          if (key === "createRadialGradient") return () => ({ addColorStop: () => {} });
          return (..._args: unknown[]) => {
            calls.push(String(key));
            return {};
          };
        },
      },
    );
    getContext(kind: string) {
      return kind === "2d" ? this.context : null;
    }
    addEventListener() {}
    removeEventListener() {}
  }
  const surface = new Surface();
  vi.stubGlobal("document", undefined);
  const draw = createCodeArtPainter(surface as unknown as OffscreenCanvas, {
    factory: () => new Surface() as unknown as OffscreenCanvas,
    renderer: "canvas",
    sign: null,
  });
  draw(
    Array(6).fill("idle"),
    Array.from({ length: 6 }, () => ({ stand: 0, talk: 0 })),
    800,
    120,
  );
  expect(calls).toContain("fillText");
  expect(calls).toContain("putImageData");
  expect(draw.backend).toBe("canvas");
  draw.dispose?.();
});
it("waits for main font readiness, then supplies exact glyph pixels and palette without worker font substitution", async () => {
  let finish: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
  vi.stubGlobal("Image", undefined);
  const read = vi.fn(() => ({ width: 12, height: 20, data: new Uint8ClampedArray(960) }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillText: vi.fn(),
    getImageData: read,
  } as unknown as CanvasRenderingContext2D);
  const pending = prepareClassicCrewAssets("canvas");
  expect(read).not.toHaveBeenCalled();
  finish();
  const assets = await pending;
  expect(read).toHaveBeenCalledTimes(3);
  expect(assets.tiles).toHaveLength(3);
  expect(assets.palette).toBe(themePalette);
  expect(assets.renderer).toBe("canvas");
  expect(assets.sign).toBeNull();
});
