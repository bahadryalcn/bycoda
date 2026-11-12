export type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasSize = { width: number; height: number; ratio: number };
export const CANVAS_PROTOCOL = 1;
type Envelope = { version: 1; generation: number };
export type CanvasRequest<Frame> = Envelope &
  (
    | { type: "probe" }
    | { type: "init"; canvas: OffscreenCanvas; size: CanvasSize; assets?: unknown }
    | { type: "resize"; size: CanvasSize }
    | { type: "draw"; sequence: number; frame: Frame }
    | { type: "capture"; sequence: number }
    | { type: "dispose" }
  );
export type CanvasReply = Envelope &
  (
    | { type: "capabilities" }
    | { type: "ready" }
    | { type: "drawn"; sequence: number; backend?: string; busy?: boolean }
    | {
        type: "captured";
        sequence: number;
        width: number;
        height: number;
        pixels: Uint8ClampedArray;
      }
    | { type: "error"; reason: string }
    | { type: "disposed" }
  );
