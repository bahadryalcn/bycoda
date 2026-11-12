import "./canvas-paired-classic-loss";
import { compareSequence } from "./paired-proof";
import { createCrewFrameHarness } from "../../../src/features/sessions/ui/crewCanvasHost";
import {
  createCodeArtPainter,
  loadCrewSignLogo,
} from "../../../src/features/sessions/ui/crewCodeArt";
import type { CrewCanvasFrame } from "../../../src/features/sessions/ui/crewCanvasHost";
import type { ProofOptions } from "./canvas-paired";

type Classic = Extract<ProofOptions, { kind: "crew" }>;
function inputs(options: Classic, frame: { time: number; stand: number }): CrewCanvasFrame {
  return {
    actions: Array(Math.max(6, options.count)).fill("idle"),
    activity: Array.from({ length: Math.max(6, options.count) }, (_, id) => ({
      stand: id < options.count ? frame.stand : 0,
      talk: 0,
      ...(options.scenario === "arrivals" ? { arrival: id < 6 ? 1 : frame.stand } : {}),
      ...(options.scenario === "growth"
        ? {
            age: {
              stage: Math.min(3, Math.floor(frame.time * 2)),
              growth: (frame.time * 2) % 1,
              from: 0,
              change: frame.stand,
            },
          }
        : {}),
    })),
    width: 1200,
    time: frame.time * 1000,
  };
}
export async function createClassicRenderer(canvas: HTMLCanvasElement, options: Classic) {
  await loadCrewSignLogo();
  const path = options.path ?? "main";
  canvas.id = path;
  canvas.style.cssText = "display:block;width:760px;height:390px";
  const harness = await createCrewFrameHarness(canvas, path, options.renderer, options.signFailed);
  let acknowledged = false;
  return {
    width: 2280,
    height: 1170,
    get gpu() {
      return harness.backend() === "webgl";
    },
    get backend() {
      return path === "main" ? "main" : acknowledged ? "worker" : "unacknowledged";
    },
    async draw(frame: { time: number; stand: number }) {
      await harness.draw(inputs(options, frame));
      acknowledged = true;
    },
    capture: async () => (await harness.capture()).data,
    png: () => canvas.toDataURL(),
    dispose: harness.dispose,
  };
}
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    total: values.reduce((a, b) => a + b, 0),
  };
};
async function mainTiming() {
  await document.fonts.ready;
  await loadCrewSignLogo();
  const results = [];
  for (const renderer of ["auto", "canvas"] as const) {
    const canvas = document.createElement("canvas");
    const start = performance.now();
    const draw = createCodeArtPainter(canvas, { renderer });
    const creation = performance.now() - start;
    const durations = [];
    for (let index = 0; index < 300; index++) {
      const frame = inputs({ kind: "crew", count: 3, renderer }, { time: index * 0.12, stand: 1 });
      const start = performance.now();
      draw(frame.actions, frame.activity, frame.width, frame.time);
      durations.push(performance.now() - start);
    }
    results.push({
      renderer,
      creation,
      frames: 300,
      dpr: devicePixelRatio,
      backend: draw.backend,
      paint: stats(durations),
    });
    draw.dispose?.();
  }
  return results;
}
async function workerTiming() {
  const results = [];
  for (const renderer of ["auto", "canvas"] as const) {
    const signDraw: number[] = [];
    const bitmap: number[] = [];
    const harness = await createCrewFrameHarness(
      document.createElement("canvas"),
      "worker",
      renderer,
      false,
      (timing) => {
        signDraw.push(timing.draw);
        bitmap.push(timing.bitmap);
      },
    );
    const durations: number[] = [];
    const submit: number[] = [];
    window.workerTelemetry.post.length = 0;
    window.workerTelemetry.roundTrip.length = 0;
    window.workerTelemetry.ack.length = 0;
    for (let index = 0; index < 300; index++) {
      const start = performance.now();
      const pending = harness.draw(
        inputs({ kind: "crew", count: 3, renderer }, { time: index * 0.12, stand: 1 }),
      );
      submit.push(performance.now() - start);
      await pending;
      durations.push(performance.now() - start);
    }
    results.push({
      renderer,
      frames: 300,
      backend: harness.backend(),
      post: stats(window.workerTelemetry.post),
      ack: stats(window.workerTelemetry.ack),
      signDraw: stats(signDraw),
      bitmap: stats(bitmap),
      main: stats(
        submit.map((duration, index) => duration + (window.workerTelemetry.ack[index] ?? 0)),
      ),
      roundTrip: stats(durations),
    });
    harness.dispose();
  }
  return results;
}
declare global {
  interface Window {
    classicMainTiming: typeof mainTiming;
    classicWorkerTiming: typeof workerTiming;
  }
}
window.classicMainTiming = mainTiming;
window.classicWorkerTiming = workerTiming;

async function animatedTiming() {
  const results = [];
  for (const renderer of ["auto", "canvas"] as const) {
    const harness = await createCrewFrameHarness(
      document.createElement("canvas"),
      "worker",
      renderer,
    );
    window.workerTelemetry.post.length = 0;
    window.workerTelemetry.ack.length = 0;
    const start = performance.now();
    let frames = 0;
    while (performance.now() - start < 30000) {
      await harness.draw(
        inputs({ kind: "crew", count: 3, renderer }, { time: frames * 0.12, stand: 1 }),
      );
      frames++;
      const wait = start + frames * 120 - performance.now();
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    results.push({
      renderer,
      frames,
      wallMs: performance.now() - start,
      mainTotal:
        window.workerTelemetry.post.reduce((a, b) => a + b, 0) +
        window.workerTelemetry.ack.reduce((a, b) => a + b, 0),
    });
    harness.dispose();
  }
  return results;
}
declare global {
  interface Window {
    classicAnimatedTiming: typeof animatedTiming;
  }
}
window.classicAnimatedTiming = animatedTiming;

async function mainParity(renderer: "auto" | "canvas") {
  const options = { kind: "crew" as const, count: 3, renderer };
  const a = await createClassicRenderer(document.createElement("canvas"), options);
  const b = await createClassicRenderer(document.createElement("canvas"), options);
  return compareSequence(
    a,
    b,
    Array.from({ length: 33 }, (_, index) => ({
      time: (index * Math.PI * 4.8) / 32,
      stand: index / 32,
    })),
    a.width,
    a.height,
  );
}
declare global {
  interface Window {
    classicMainParity: typeof mainParity;
  }
}
window.classicMainParity = mainParity;
