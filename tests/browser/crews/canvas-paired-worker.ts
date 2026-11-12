import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PacingUncle } from "../../../src/features/sessions/ui/PacingUncle";
import {
  createPacingFrameHarness,
  createPacingCanvasHost,
} from "../../../src/features/sessions/ui/pacingCanvasHost";
import { setCanvasWorkerEnabled } from "../../../src/shared/lib/canvas-worker/host";
import { paintPacingFrame } from "../../../src/features/sessions/ui/pacingCanvasPainter";
import type { ProofOptions } from "./canvas-paired";

type Walker = Extract<ProofOptions, { kind: "walker" }>;
const NativeWorker = window.Worker;
const telemetry = {
  urls: [] as string[],
  ready: 0,
  drawn: 0,
  live: 0,
  post: [] as number[],
  ack: [] as number[],
  roundTrip: [] as number[],
};
class ObservedWorker extends NativeWorker {
  private pending = new Map<number, number>();
  private ended = false;
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    if (options?.type !== "module") throw new Error("Expected real module worker");
    telemetry.urls.push(String(url));
    telemetry.live++;
    this.addEventListener("message", ({ data }) => {
      if (data.type === "ready") telemetry.ready++;
      if (data.type === "drawn") {
        telemetry.drawn++;
        const start = this.pending.get(data.sequence);
        if (start !== undefined) telemetry.roundTrip.push(performance.now() - start);
        this.pending.delete(data.sequence);
      }
    });
  }
  override set onmessage(handler: ((this: Worker, event: MessageEvent) => any) | null) {
    super.onmessage = handler
      ? (event) => {
          const start = performance.now();
          handler.call(this, event);
          if (event.data.type === "drawn") telemetry.ack.push(performance.now() - start);
        }
      : null;
  }
  override postMessage(message: any, transfer?: Transferable[] | StructuredSerializeOptions) {
    const start = performance.now();
    if (message.type === "draw") this.pending.set(message.sequence, start);
    super.postMessage(message, (transfer as Transferable[] | undefined) ?? []);
    if (message.type === "draw") telemetry.post.push(performance.now() - start);
  }
  override terminate() {
    if (!this.ended) telemetry.live--;
    this.ended = true;
    super.terminate();
  }
}
window.Worker = ObservedWorker;

export function createWalkerRenderer(canvas: HTMLCanvasElement, options: Walker) {
  const path = options.path ?? "main";
  const initial = telemetry.drawn;
  canvas.id = path;
  canvas.style.width = `${options.width}px`;
  canvas.style.height = "32px";
  canvas.style.display = "block";
  const harness = createPacingFrameHarness(canvas, path, {
    width: options.width,
    height: 32,
    ratio: options.dpr,
  });
  return {
    width: options.width * options.dpr,
    height: 32 * options.dpr,
    gpu: false,
    get backend() {
      return path === "worker" && telemetry.drawn > initial
        ? "worker"
        : path === "main"
          ? "main"
          : "unacknowledged";
    },
    draw: (frame: { time: number }) =>
      harness.drawFrame(Math.round(frame.time * 12), options.theme),
    capture: async () => (await harness.capture()).data,
    png: () => canvas.toDataURL(),
    dispose: harness.dispose,
  };
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
async function timing(theme: Walker["theme"]) {
  const size = { width: 320, height: 32, ratio: 2 };
  const main = document.createElement("canvas");
  main.width = 640;
  main.height = 64;
  const context = main.getContext("2d")!;
  context.setTransform(2, 0, 0, 2, 0, 0);
  const worker = createPacingFrameHarness(document.createElement("canvas"), "worker", size);
  try {
    await worker.drawFrame(0, theme);
    telemetry.post.length = 0;
    telemetry.roundTrip.length = 0;
    const draws: number[] = [];
    for (let frame = 1; frame <= 300; frame++) {
      const start = performance.now();
      paintPacingFrame(context, { width: 320, height: 32, elapsed: frame / 12, theme });
      draws.push(performance.now() - start);
      await worker.drawFrame(frame, theme);
    }
    return {
      theme,
      frames: 300,
      main: stats(draws),
      post: stats(telemetry.post),
      roundTrip: stats(telemetry.roundTrip),
    };
  } finally {
    worker.dispose();
  }
}
async function failure(mode: "constructor" | "never-ready") {
  const holder = document.createElement("div");
  document.body.append(holder);
  const original = document.createElement("canvas");
  holder.append(original);
  let live = 0;
  const makeWorker = () => {
    if (mode === "constructor") throw new Error("Injected constructor failure");
    const url = URL.createObjectURL(
      new Blob(["self.onmessage = () => {};"], { type: "text/javascript" }),
    );
    const worker = new NativeWorker(url, { type: "module" });
    URL.revokeObjectURL(url);
    live++;
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      live--;
      terminate();
    };
    return worker;
  };
  const host = createPacingCanvasHost(original, makeWorker);
  const size = { width: 320, height: 32, ratio: 2 };
  host.resize(size);
  const frame = { width: 320, height: 32, elapsed: 17 / 12, theme: "classic" as const };
  host.draw(frame);
  await delay(mode === "constructor" ? 50 : 2200);
  const active = [...holder.querySelectorAll("canvas")].find(
    (canvas) => canvas.style.visibility !== "hidden",
  )!;
  const reference = createPacingFrameHarness(document.createElement("canvas"), "main", size);
  try {
    await reference.drawFrame(17);
    const a = (await reference.capture()).data;
    const b = active.getContext("2d")!.getImageData(0, 0, 640, 64).data;
    let differingPixels = 0,
      maxChannelDelta = 0;
    for (let i = 0; i < a.length; i += 4) {
      let changed = false;
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(a[i + c] - b[i + c]);
        changed ||= delta !== 0;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (changed) differingPixels++;
    }
    return { fresh: active !== original, live, differingPixels, maxChannelDelta };
  } finally {
    reference.dispose();
    host.dispose();
    holder.remove();
  }
}
async function lifecycle() {
  const initialReady = telemetry.ready;
  const initialCreated = telemetry.urls.length;
  const holder = document.createElement("div");
  holder.style.cssText = "width:320px;position:relative";
  document.body.append(holder);
  const style = document.createElement("style");
  style.textContent = "[data-pacing-uncle]{width:100%;height:32px;display:block}";
  document.head.append(style);
  setCanvasWorkerEnabled("pacing-walker", true);
  try {
    for (let mount = 0; mount < 2; mount++) {
      const root = createRoot(holder);
      root.render(createElement(StrictMode, null, createElement(PacingUncle)));
      const start = performance.now();
      while (telemetry.ready <= initialReady + mount && performance.now() - start < 5000)
        await delay(20);
      root.unmount();
      await delay(150);
    }
    return {
      ready: telemetry.ready - initialReady,
      created: telemetry.urls.length - initialCreated,
      live: telemetry.live,
    };
  } finally {
    setCanvasWorkerEnabled("pacing-walker", false);
    holder.remove();
    style.remove();
  }
}
declare global {
  interface Window {
    workerTelemetry: typeof telemetry;
    walkerTiming: typeof timing;
    walkerFailure: typeof failure;
    walkerLifecycle: typeof lifecycle;
  }
}
window.workerTelemetry = telemetry;
window.walkerTiming = timing;
window.walkerFailure = failure;
window.walkerLifecycle = lifecycle;
