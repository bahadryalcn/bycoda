import { createCanvasWorkerHost } from "../../../shared/lib/canvas-worker/host";
import type { CanvasReply, CanvasSize } from "../../../shared/lib/canvas-worker/types";
import { paintPacingFrame, type PacingFrame } from "./pacingCanvasPainter";
import { pacingFrameSignature } from "./pacingUncleArt";

export const PACING_RENDERER_ID = "pacing-walker";
export const createPacingWorker = () =>
  new Worker(new URL("./pacingCanvas.worker.ts", import.meta.url), { type: "module" });

/** Retain original pixels until an acknowledged worker frame or freshly painted fallback exists. */
export function createPacingCanvasHost(
  original: HTMLCanvasElement,
  createWorker = createPacingWorker,
) {
  const candidate = original.cloneNode(false) as HTMLCanvasElement;
  let active = original;
  let context = original.getContext("2d");
  let size: CanvasSize = { width: 0, height: 32, ratio: 1 };
  let latest: PacingFrame | undefined;
  let signature = "";
  let ready = false;
  let failed = false;
  let started = false;
  let disposed = false;
  const queue: Array<{ frame: PacingFrame; size: CanvasSize }> = [];
  const show = (canvas: HTMLCanvasElement) => {
    if (disposed || active === canvas) return;
    active.style.visibility = "hidden";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    original.after(canvas);
    if (active !== original) active.remove();
    canvas.hidden = false;
    canvas.style.visibility = "";
    active = canvas;
  };
  const resizeMain = (canvas: HTMLCanvasElement) => {
    canvas.width = Math.round(size.width * size.ratio);
    canvas.height = Math.round(size.height * size.ratio);
    context = canvas.getContext("2d");
    context?.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
  };
  const host = createCanvasWorkerHost<PacingFrame>({
    canvas: candidate,
    size,
    createWorker,
    onReady: () => {
      ready = true;
      let previous = size;
      for (const item of queue.splice(0)) {
        if (
          item.size.width !== previous.width ||
          item.size.height !== previous.height ||
          item.size.ratio !== previous.ratio
        ) {
          host.resize(item.size);
          previous = item.size;
        }
        host.draw(item.frame);
      }
    },
    onDrawn: () => show(candidate),
    onFailure: () => {
      failed = true;
      queue.length = 0;
      const fallback = original.cloneNode(false) as HTMLCanvasElement;
      fallback.hidden = false;
      resizeMain(fallback);
      if (context && latest) paintPacingFrame(context, latest);
      if (context) show(fallback);
    },
  });
  return {
    resize(next: CanvasSize) {
      size = next;
      signature = "";
      if (!ready || failed) resizeMain(active);
      host.resize(next);
    },
    draw(frame: PacingFrame) {
      latest = frame;
      if (failed) {
        if (context) paintPacingFrame(context, frame);
        return;
      }
      if (!ready && context) paintPacingFrame(context, frame);
      const next = pacingFrameSignature(
        frame.width,
        frame.height,
        frame.elapsed,
        frame.theme,
        size.ratio,
      );
      if (next === signature) return;
      signature = next;
      if (ready) host.draw(frame);
      else if (queue.length < 32) queue.push({ frame, size });
      else {
        host.abort("Canvas startup queue overflow");
      }
      if (!started) {
        started = true;
        host.start();
      }
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      host.dispose();
      if (active !== original) active.remove();
      candidate.remove();
      original.hidden = false;
      original.style.visibility = "";
    },
  };
}

/** Fixture-only deterministic session. Owns supplied fresh canvas; caller must dispose. */
export function createPacingFrameHarness(
  canvas: HTMLCanvasElement,
  path: "main" | "worker",
  size: CanvasSize,
) {
  let context: CanvasRenderingContext2D | null = null;
  let failure: string | undefined;
  let settleReady: (value: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    settleReady = resolve;
  });
  void ready.catch(() => {});
  const host =
    path === "worker"
      ? createCanvasWorkerHost<PacingFrame>({
          canvas,
          size,
          createWorker: createPacingWorker,
          onReady: () => settleReady(true),
          onFailure: (reason) => {
            failure = reason;
            settleReady(false);
          },
        })
      : null;
  if (host) host.start();
  else {
    canvas.width = Math.round(size.width * size.ratio);
    canvas.height = Math.round(size.height * size.ratio);
    context = canvas.getContext("2d");
    context?.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    settleReady(!!context);
  }
  return {
    async drawFrame(frameNumber: number, theme: PacingFrame["theme"] = "classic") {
      if (!(await ready)) throw new Error(failure ?? "Canvas unavailable");
      const frame = { width: size.width, height: size.height, elapsed: frameNumber / 12, theme };
      if (!host) {
        paintPacingFrame(context!, frame);
        return;
      }
      const result = await new Promise<CanvasReply | null>((resolve) => host.draw(frame, resolve));
      if (!result) throw new Error(failure ?? "Worker draw failed");
    },
    async capture() {
      if (!(await ready)) throw new Error(failure ?? "Canvas unavailable");
      if (!host) return context!.getImageData(0, 0, canvas.width, canvas.height);
      const result = await new Promise<CanvasReply | null>((resolve) => host.capture(resolve));
      if (result?.type !== "captured") throw new Error(failure ?? "Worker capture failed");
      return new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height);
    },
    dispose() {
      settleReady(false);
      host?.dispose();
    },
  };
}
