import { createCanvasWorkerRuntime } from "../../../shared/lib/canvas-worker/runtime";
import type { CanvasRequest } from "../../../shared/lib/canvas-worker/types";
import { paintPacingFrame, type PacingFrame } from "./pacingCanvasPainter";

const receive = createCanvasWorkerRuntime<PacingFrame>(
  (reply) => self.postMessage(reply),
  paintPacingFrame,
);
self.onmessage = (event: MessageEvent<CanvasRequest<PacingFrame>>) => receive(event.data);
