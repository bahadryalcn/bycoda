import {
  CANVAS_PROTOCOL,
  type Canvas2D,
  type CanvasReply,
  type CanvasRequest,
  type CanvasSize,
} from "./types";

type ReplyBody<T = CanvasReply> = T extends CanvasReply ? Omit<T, "version" | "generation"> : never;

/** No worker clock or loop: each ordered message paints exactly one supplied sample. */
export function createCanvasWorkerRuntime<Frame>(
  post: (reply: CanvasReply) => void,
  paint: (context: Canvas2D, frame: Frame) => void | { backend?: string; busy?: boolean },
  lifecycle?: {
    init?: (canvas: OffscreenCanvas, assets: unknown) => void;
    dispose?: () => void;
    releaseFrame?: (frame: Frame) => void;
  },
) {
  let generation = 0;
  let sequence = 0;
  let canvas: OffscreenCanvas | undefined;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  let disposed = false;
  const reply = (value: ReplyBody) =>
    post({ version: CANVAS_PROTOCOL, generation, ...value } as CanvasReply);
  const lost = (event: Event) => {
    event.preventDefault();
    // A fresh main-thread surface is safer than claiming unproven cache restoration.
    reply({ type: "error", reason: "Canvas context lost" });
  };
  const resize = (size: CanvasSize) => {
    if (!canvas || !context) throw new Error("Canvas not initialized");
    canvas.width = Math.round(size.width * size.ratio);
    canvas.height = Math.round(size.height * size.ratio);
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
  };
  return (message: CanvasRequest<Frame>) => {
    if (message.version !== CANVAS_PROTOCOL || disposed) {
      if (message.type === "draw") lifecycle?.releaseFrame?.(message.frame);
      return;
    }
    if (message.type === "probe") {
      if (generation) return;
      generation = message.generation;
    }
    if (!generation || message.generation !== generation) {
      if (message.type === "draw") lifecycle?.releaseFrame?.(message.frame);
      return;
    }
    try {
      switch (message.type) {
        case "probe": {
          const probe = new OffscreenCanvas(1, 1);
          if (!probe.getContext("2d")) throw new Error("Worker 2D unavailable");
          reply({ type: "capabilities" });
          break;
        }
        case "init":
          if (canvas) throw new Error("Canvas already initialized");
          canvas = message.canvas;
          context = canvas.getContext("2d");
          if (!context) throw new Error("Worker 2D unavailable");
          canvas.addEventListener("contextlost", lost);
          resize(message.size);
          lifecycle?.init?.(canvas, message.assets);
          reply({ type: "ready" });
          break;
        case "resize":
          resize(message.size);
          break;
        case "draw":
          if (!context) throw new Error("Draw before init");
          if (message.sequence <= sequence) return;
          sequence = message.sequence;
          reply({ type: "drawn", sequence, ...paint(context, message.frame) });
          break;
        case "capture": {
          if (!context || !canvas) throw new Error("Capture before init");
          if (message.sequence <= sequence) return;
          sequence = message.sequence;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          post({
            version: CANVAS_PROTOCOL,
            generation,
            type: "captured",
            sequence,
            width: canvas.width,
            height: canvas.height,
            pixels,
          });
          break;
        }
        case "dispose":
          lifecycle?.dispose?.();
          canvas?.removeEventListener("contextlost", lost);
          canvas = undefined;
          context = null;
          disposed = true;
          reply({ type: "disposed" });
          break;
      }
    } catch (error) {
      reply({
        type: "error",
        reason: error instanceof Error ? error.message : "Canvas paint failed",
      });
    } finally {
      if (message.type === "draw") lifecycle?.releaseFrame?.(message.frame);
    }
  };
}
