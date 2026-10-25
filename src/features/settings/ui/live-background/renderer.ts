import type { LiveBackground } from "../../model/liveBackground";
import { createLiveBackgroundScene } from "./index";
import { createReactBitsSurface } from "./reactBitsSurface";
import type { LiveBackgroundPalette, LiveSignal } from "./types";

export const isAmbientBackground = (
  effect: LiveBackground,
): effect is "threads" | "silk" | "dark-veil" | "soft-aurora" | "floating-lines" =>
  effect === "threads" ||
  effect === "silk" ||
  effect === "dark-veil" ||
  effect === "soft-aurora" ||
  effect === "floating-lines";

export type BackgroundRenderer = {
  resize(width: number, height: number, ratio: number): void;
  draw(time: number, delta: number, signal: LiveSignal): void;
  dispose(): void;
};

/** GPU scenes render directly into the visible canvas; ordinary scenes retain 2D. */
export function createBackgroundRenderer(
  effect: Exclude<LiveBackground, "none">,
  canvas: HTMLCanvasElement,
  palette: LiveBackgroundPalette,
): BackgroundRenderer | null {
  if (isAmbientBackground(effect)) {
    const surface = createReactBitsSurface(effect, canvas, palette);
    if (surface) {
      canvas.dataset.backgroundRenderer = "webgl";
      return surface;
    }
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.dataset.backgroundRenderer = "unavailable";
    return null;
  }
  canvas.dataset.backgroundRenderer = "2d";
  const scene = createLiveBackgroundScene(effect, palette);
  let ratio = 1;
  return {
    resize(width, height, nextRatio) {
      ratio = nextRatio;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      scene.resize(width, height);
    },
    draw(time, delta, signal) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      scene.draw(ctx, time, delta, signal);
    },
    dispose() {
      scene.dispose?.();
    },
  };
}
