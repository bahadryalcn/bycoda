import { createCrewSignLayer, type SignLayerTiming } from "./crewCanvasSignLayer";
import { createCanvasWorkerHost } from "../../../shared/lib/canvas-worker/host";
import type { CanvasReply } from "../../../shared/lib/canvas-worker/types";
import {
  CODE_WIDTH,
  CODE_HEIGHT,
  createCodeArtPainter,
  type CodeArtPainter,
  type TeaPose,
  type CrewActivity,
} from "./crewCodeArt";
import { prepareClassicCrewAssets, type ClassicCrewAssets } from "./crewCanvasAssets";

export const CREW_RENDERER_ID = "classic-crew";
/** Product rollout stays disabled pending owner approval and native acceptance. */
export const CLASSIC_CREW_WORKER_QUALIFIED = false;
export type CrewCanvasFrame = {
  actions: TeaPose[];
  activity?: CrewActivity[];
  width?: number;
  time?: number;
  signLayer?: ImageBitmap;
};
export const createCrewWorker = () =>
  new Worker(new URL("./crewCanvas.worker.ts", import.meta.url), { type: "module" });
const size = { width: CODE_WIDTH * 3, height: CODE_HEIGHT * 3, ratio: 1 };

/** Main clock owns every sample. Startup retains pixels; only acknowledged pixels replace them. */
export function createCrewCanvasHost(
  original: HTMLCanvasElement,
  createWorker = createCrewWorker,
  prepare = prepareClassicCrewAssets,
): CodeArtPainter {
  const candidate = original.cloneNode(false) as HTMLCanvasElement;
  let active = original;
  let main: CodeArtPainter | undefined = createCodeArtPainter(original);
  let host: ReturnType<typeof createCanvasWorkerHost<CrewCanvasFrame>> | undefined;
  let assets: ClassicCrewAssets | undefined;
  let sign: ReturnType<typeof createCrewSignLayer> | undefined;
  let disposed = false;
  let failed = false;
  let ready = false;
  let latest: CrewCanvasFrame | undefined;
  const queue: CrewCanvasFrame[] = [];
  const show = (surface: HTMLCanvasElement) => {
    if (disposed || surface === active) return;
    original.after(surface);
    active.style.display = "none";
    surface.style.display = "";
    if (active !== original) active.remove();
    active = surface;
  };
  const paint = (frame: CrewCanvasFrame) =>
    main?.(frame.actions, frame.activity, frame.width, frame.time);
  const fallback = () => {
    if (disposed || failed) return;
    failed = true;
    ready = false;
    queue.length = 0;
    main?.dispose?.();
    const fresh = original.cloneNode(false) as HTMLCanvasElement;
    main = createCodeArtPainter(fresh);
    if (latest) paint(latest);
    show(fresh);
    sign?.dispose();
    assets?.sign?.close();
  };
  void prepare()
    .then((value) => {
      assets = value;
      if (disposed || failed) {
        value.sign?.close();
        return;
      }
      sign = createCrewSignLayer(!!assets.sign);
      host = createCanvasWorkerHost<CrewCanvasFrame>({
        canvas: candidate,
        size,
        assets,
        prepareFrame: sign,
        createWorker,
        onReady: () => {
          ready = true;
          for (const frame of queue.splice(0)) host!.draw(frame);
        },
        onDrawn: () => {
          main?.dispose?.();
          main = undefined;
          show(candidate);
        },
        onFailure: fallback,
      });
      host.start();
    })
    .catch(fallback);
  const draw: CodeArtPainter = (actions, activity, width, time) => {
    if (disposed) return;
    latest = { actions, activity, width, time };
    if (main) paint(latest);
    if (failed || disposed) return;
    if (ready) host!.draw(latest);
    else if (queue.length < 32) queue.push(latest);
    else {
      host?.abort("Crew startup queue overflow");
      fallback();
    }
  };
  draw.dispose = () => {
    if (disposed) return;
    disposed = true;
    queue.length = 0;
    main?.dispose?.();
    main = undefined;
    host?.dispose();
    sign?.dispose();
    assets?.sign?.close();
    if (active !== original) active.remove();
    candidate.remove();
    original.style.display = "";
  };
  return draw;
}

/** Fixture adapter uses same host and painter; raw capture belongs to owning realm. */
export async function createCrewFrameHarness(
  canvas: HTMLCanvasElement,
  path: "main" | "worker",
  renderer: "auto" | "canvas" = "auto",
  signFailed = false,
  measureSign?: (timing: SignLayerTiming) => void,
) {
  if (path === "main") {
    const draw = createCodeArtPainter(canvas, { renderer, ...(signFailed ? { sign: null } : {}) });
    let backend = draw.backend;
    return {
      draw: async (frame: CrewCanvasFrame) => {
        draw(frame.actions, frame.activity, frame.width, frame.time);
        backend = draw.backend;
      },
      capture: async () => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height),
      backend: () => backend,
      dispose: () => draw.dispose?.(),
    };
  }
  const assets = await prepareClassicCrewAssets(renderer);
  if (signFailed) {
    assets.sign?.close();
    assets.sign = null;
  }
  const sign = createCrewSignLayer(!!assets.sign, measureSign);
  let failure = "Worker failed";
  let backend: string | undefined;
  let settle: (ready: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const host = createCanvasWorkerHost<CrewCanvasFrame>({
    canvas,
    size,
    assets,
    prepareFrame: sign,
    createWorker: createCrewWorker,
    onReady: () => settle(true),
    onFailure: (reason) => {
      failure = reason;
      settle(false);
    },
  });
  host.start();
  if (!(await ready)) {
    assets.sign?.close();
    sign.dispose();
    host.dispose();
    throw new Error(failure);
  }
  return {
    async draw(frame: CrewCanvasFrame) {
      const reply = await new Promise<CanvasReply | null>((resolve) => host.draw(frame, resolve));
      if (reply?.type !== "drawn") throw new Error(failure);
      backend = reply.backend;
    },
    async capture() {
      const reply = await new Promise<CanvasReply | null>((resolve) => host.capture(resolve));
      if (reply?.type !== "captured") throw new Error(failure);
      return new ImageData(new Uint8ClampedArray(reply.pixels), reply.width, reply.height);
    },
    backend: () => backend,
    dispose() {
      host.dispose();
      sign.dispose();
      assets.sign?.close();
    },
  };
}
