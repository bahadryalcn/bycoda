import { CODE_WIDTH, CODE_HEIGHT, drawSign } from "./crewCodeArt";
import { themePalette } from "../../../shared/theme/palette";
import type { CrewCanvasFrame } from "./crewCanvasHost";

/** Same mask pixel grid and sRGB premultiplied backing store, without a readback
 * or async decode. Called only after the host accepts an ordered draw request.
 * CrewScene's unchanged-frame signature remains the sole frame admission owner. */
export type SignLayerTiming = { draw: number; bitmap: number };
export function createCrewSignLayer(loaded: boolean, measure?: (timing: SignLayerTiming) => void) {
  let canvas: OffscreenCanvas | undefined;
  let cached: ImageBitmap | undefined;
  let signature = "";
  const prepare = (frame: CrewCanvasFrame) => {
    if (!loaded) return { frame, transfer: [] };
    canvas ??= new OffscreenCanvas(CODE_WIDTH * 2, (CODE_HEIGHT * 6) / 5);
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("Crew sign 2D unavailable");
    const start = measure ? performance.now() : 0;
    const next = JSON.stringify([frame.time ?? 0, themePalette, canvas.width, canvas.height]);
    if (next !== signature) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(canvas.width / CODE_WIDTH, canvas.height / CODE_HEIGHT);
      drawSign(context as unknown as CanvasRenderingContext2D, frame.time ?? 0);
    }
    const drawn = measure ? performance.now() : 0;
    if (next !== signature) {
      cached?.close();
      cached = canvas.transferToImageBitmap();
      signature = next;
    }
    const signLayer = structuredClone(cached!);
    measure?.({ draw: drawn - start, bitmap: performance.now() - drawn });
    return {
      frame: { ...frame, signLayer },
      transfer: [signLayer],
      release: () => signLayer.close(),
    };
  };
  prepare.dispose = () => {
    cached?.close();
    cached = undefined;
    signature = "";
  };
  return prepare;
}
