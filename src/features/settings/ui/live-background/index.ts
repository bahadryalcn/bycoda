import type { LiveBackground } from "../../model/liveBackground";
import { createCodeRainScene } from "./codeRain";
import { createDotGridScene } from "./dotGrid";
import { createGradientAsciiScene } from "./gradientAscii";
import { createHyperspeedScene } from "./hyperspeed";
import { createLetterGlitchScene } from "./letterGlitch";
import { createLightfallScene } from "./lightfall";
import { createLightRaysScene } from "./lightRays";
import { createMicroSlatsScene } from "./microSlats";
import { createPixelBlastScene } from "./pixelBlast";
import { createPrismScene } from "./prism";
import { createScannerScene } from "./scanner";
import { createSideRaysScene } from "./sideRays";
import { createWebThreadsScene } from "./webThreads";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";
import { createOrbScene } from "./orb";
import { createWorldTreeScene } from "./worldTree";

export { CLOSED_SIGNAL, createLiveSignalDriver } from "./mouth";
export type { LiveBackgroundPalette, LiveBackgroundScene, LiveSignal } from "./types";

export function createLiveBackgroundScene(
  kind: Exclude<LiveBackground, "none">,
  palette: LiveBackgroundPalette,
): LiveBackgroundScene {
  switch (kind) {
    case "orb":
      return createOrbScene(palette);
    case "world-tree":
      return createWorldTreeScene(palette);
    case "gradient-ascii":
      return createGradientAsciiScene(palette);
    case "code-rain":
      return createCodeRainScene(palette);
    case "micro-slats":
      return createMicroSlatsScene(palette);
    case "web-threads":
      return createWebThreadsScene(palette);
    case "scanner":
      return createScannerScene(palette);
    case "lightfall":
      return createLightfallScene(palette);
    case "prism":
      return createPrismScene(palette);
    case "side-rays":
      return createSideRaysScene(palette);
    case "light-rays":
      return createLightRaysScene(palette);
    case "pixel-blast":
      return createPixelBlastScene(palette);
    case "dot-grid":
      return createDotGridScene(palette);
    case "hyperspeed":
      return createHyperspeedScene(palette);
    case "letter-glitch":
      return createLetterGlitchScene(palette);
  }
}
