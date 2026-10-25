import type { LiveBackground } from "../../model/liveBackground";
import { createAsciiMaskScene } from "./asciiMask";
import { createAmbientFallbackScene } from "./ambientFallback";
import { createCodeRainScene } from "./codeRain";
import { createDotGridScene } from "./dotGrid";
import { createNeuralTreeScene } from "./neuralTree";
import { createLatentFaceScene } from "./latentFace";
import { createThoughtWeaverScene } from "./thoughtWeaver";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

export { CLOSED_SIGNAL, createLiveSignalDriver } from "./calmSignal";
export type { LiveBackgroundPalette, LiveBackgroundScene, LiveSignal } from "./types";

export function createLiveBackgroundScene(
  kind: Exclude<LiveBackground, "none">,
  palette: LiveBackgroundPalette,
): LiveBackgroundScene {
  switch (kind) {
    case "threads":
    case "silk":
    case "dark-veil":
    case "soft-aurora":
    case "floating-lines":
      return createAmbientFallbackScene(palette);
    case "neural-tree":
      return createNeuralTreeScene(palette);
    case "latent-face":
      return createLatentFaceScene(palette);
    case "thought-weaver":
      return createThoughtWeaverScene(palette);
    case "ascii-mask":
      return createAsciiMaskScene(palette);
    case "dot-grid":
      return createDotGridScene(palette);
    case "code-rain":
      return createCodeRainScene(palette);
  }
}
