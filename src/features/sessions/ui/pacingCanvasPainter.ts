import type { Canvas2D } from "../../../shared/lib/canvas-worker/types";
import type { CrewTheme } from "../../settings";
import { drawPacingUncle } from "./pacingUncleArt";

export type PacingFrame = { width: number; height: number; elapsed: number; theme: CrewTheme };
/** Both realms call the original painter with identical arguments. No independent clock. */
export function paintPacingFrame(context: Canvas2D, frame: PacingFrame): void {
  drawPacingUncle(context, frame.width, frame.height, frame.elapsed, frame.theme);
}
