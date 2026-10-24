import type { LiveBackground } from "../../model/liveBackground";
import { createAsciiMaskScene } from "./asciiMask";
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
    case "neural-tree":
      return createNeuralTreeScene(palette);
    case "latent-face":
      return createLatentFaceScene(palette);
    case "thought-weaver":
      return createThoughtWeaverScene(palette);
    case "ascii-mask":
      return createAsciiMaskScene(palette);
  }
}
