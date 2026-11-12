// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { drawPacingUncle, pacingFrameSignature } from "./pacingUncleArt";
import type { Canvas2D } from "../../../shared/lib/canvas-worker/types";

function context(): Canvas2D {
  const state: Record<string, unknown> = {
    imageSmoothingEnabled: true,
    getTransform: () => ({ a: 1.5 }),
  };
  return new Proxy(state, {
    get: (target, key: string) => (target[key] ??= vi.fn()),
  }) as unknown as Canvas2D;
}
afterEach(() => vi.unstubAllGlobals());
it.each(["classic", "lotr", "matrix", "star-wars"] as const)(
  "paints %s without document using offscreen sprite contexts",
  (theme) => {
    vi.stubGlobal(
      "Path2D",
      class {
        rect() {}
      },
    );
    const cells: Canvas2D[] = [];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          const cell = context();
          cells.push(cell);
          return cell;
        }
      },
    );
    vi.stubGlobal("document", undefined);
    const target = context();
    for (let frame = 0; frame < 480; frame += 6) drawPacingUncle(target, 79, 32, frame / 12, theme);
    expect(target.drawImage).toHaveBeenCalled();
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.some((cell) => vi.mocked(cell.fillRect).mock.calls.length > 0)).toBe(true);
  },
);
it("matches main skip decisions across route, turn, gesture, dimensions and DPR", () => {
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.stubGlobal("document", undefined);
  vi.stubGlobal(
    "Path2D",
    class {
      rect() {}
    },
  );
  for (const theme of ["classic", "lotr", "matrix", "star-wars"] as const) {
    for (const width of [24, 80, 880]) {
      for (const ratio of [1, 1.25, 2]) {
        const target = context();
        target.getTransform = () => ({ a: ratio }) as DOMMatrix;
        let previous = "";
        let expectedDraws = 0;
        for (let frame = 0; frame < 480; frame++) {
          const signature = pacingFrameSignature(width, 32, frame / 12, theme, ratio);
          if (signature !== previous) expectedDraws++;
          previous = signature;
          drawPacingUncle(target, width, 32, frame / 12, theme);
        }
        expect(target.clearRect).toHaveBeenCalledTimes(expectedDraws);
      }
    }
  }
});
