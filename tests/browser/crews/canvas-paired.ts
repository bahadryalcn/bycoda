import { createClassicRenderer } from "./canvas-paired-classic";
import { createWalkerRenderer } from "./canvas-paired-worker";
import { compareSequence, type PairedRenderer } from "./paired-proof";
import {
  createPacingRoute,
  GESTURE_SECONDS,
  PACING_FPS,
} from "../../../src/features/sessions/ui/pacingUncleArt";
import { createDotGridScene } from "../../../src/features/settings/ui/live-background/dotGrid";
import type { CrewTheme } from "../../../src/features/settings/model/settings";

export type ProofOptions =
  | { kind: "walker"; theme: CrewTheme; width: number; dpr: number; path?: "main" | "worker" }
  | {
      kind: "crew";
      count: number;
      renderer: "auto" | "canvas";
      path?: "main" | "worker";
      scenario?: "growth" | "arrivals";
      signFailed?: boolean;
    }
  | { kind: "dots"; dark: boolean };
type Frame = { time: number; stand: number; presence: number };
type Renderer = PairedRenderer<Frame> & {
  width: number;
  height: number;
  gpu: boolean;
  backend?: string;
};
declare global {
  interface Window {
    createPairedRenderer: (options: ProofOptions) => Promise<Renderer>;
    runPairedProof: typeof runPairedProof;
    checkPairedHarness: typeof checkPairedHarness;
  }
}

window.createPairedRenderer = async (options) => {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  if (options.kind === "walker") return createWalkerRenderer(canvas, options);
  let draw: (frame: Frame) => void;
  let dispose: (() => void) | undefined;
  let gpu = false;
  if (options.kind === "crew") return createClassicRenderer(canvas, options);
  {
    const width = 480;
    const height = 320;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    const scene = createDotGridScene({
      content: options.dark ? "rgb(225, 225, 225)" : "rgb(30, 30, 30)",
      accent: "rgb(80, 140, 220)",
      monoFont: "monospace",
    });
    scene.resize(width, height);
    let previous = 0;
    draw = (frame) => {
      scene.draw(context, frame.time, frame.time - previous, {
        presence: frame.presence,
        energy: frame.presence * 0.5,
      });
      previous = frame.time;
    };
    dispose = scene.dispose;
  }

  // Classic WebGL is private and copied synchronously into this 2D destination.
  // Capture after draw ACK reads that destination, never a cleared GL backbuffer.
  const context = canvas.getContext("2d")!;
  return {
    width: canvas.width,
    height: canvas.height,
    get gpu() {
      return gpu;
    },
    async draw(frame) {
      draw(frame);
    },
    capture: () => context.getImageData(0, 0, canvas.width, canvas.height).data,
    png: () => canvas.toDataURL(),
    dispose,
  };
};

function sequence(options: ProofOptions): Frame[] {
  if (options.kind === "walker") {
    const legs = createPacingRoute(Math.max(0, options.width - 36));
    // Match route's walk, gesture, pause and direction-change durations.
    // No route below 36px: exercise stationary blink/gesture quantisation instead.
    const cycle = legs.length
      ? legs.reduce(
          (total, leg, index) =>
            total +
            leg.duration +
            (index % 4 === 3 ? GESTURE_SECONDS : 0) +
            0.28 +
            (leg.dir !== legs[(index + 1) % legs.length].dir ? 0.3 : 0),
          0,
        )
      : GESTURE_SECONDS;
    return Array.from({ length: Math.ceil(cycle * PACING_FPS) + 1 }, (_, index) => ({
      time: index / PACING_FPS,
      stand: 0,
      presence: 0,
    }));
  }
  if (options.kind === "crew") {
    const times = new Set([
      ...Array.from({ length: 17 }, (_, index) => index / 8),
      ...Array.from({ length: 33 }, (_, index) => index * ((Math.PI * 4.8) / 32)),
      0.599,
      0.6,
      0.601,
      1.599,
      1.6,
      1.601,
    ]);
    return [...times]
      .sort((a, b) => a - b)
      .map((time) => ({
        time,
        stand: time <= 1 ? Math.min(1, time / 0.6) : Math.max(0, 1 - (time - 1) / 0.6),
        presence: 0,
      }));
  }
  return Array.from({ length: 49 }, (_, index) => ({
    time: index / 12,
    stand: 0,
    presence: index < 12 ? index / 12 : index < 36 ? 1 : (48 - index) / 12,
  }));
}

async function realm() {
  const iframe = document.createElement("iframe");
  iframe.width = "1600";
  iframe.height = "850";
  const ready = new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve();
    iframe.onerror = () => reject(new Error("Renderer realm failed to load"));
  });
  iframe.src = `${location.pathname}?renderer=1`;
  document.body.append(iframe);
  await ready;
  return iframe;
}

async function runPairedProof(options: ProofOptions) {
  const referenceRealm = await realm();
  const candidateRealm = await realm();
  try {
    // Separate module realms isolate route/sprite/glyph caches and asset instances.
    const reference = await referenceRealm.contentWindow!.createPairedRenderer(options);
    const candidate = await candidateRealm.contentWindow!.createPairedRenderer(
      options.kind !== "dots" ? { ...options, path: "worker" } : options,
    );
    return {
      ...(await compareSequence(
        reference,
        candidate,
        sequence(options),
        reference.width,
        reference.height,
      )),
      gpu: [reference.gpu, candidate.gpu],
      backend: [reference.backend, candidate.backend],
    };
  } finally {
    referenceRealm.remove();
    candidateRealm.remove();
  }
}

async function checkPairedHarness() {
  let acknowledged = -1;
  const renderer = (candidate: boolean): PairedRenderer<number> => ({
    async draw(_frame, sequence) {
      await Promise.resolve();
      acknowledged = sequence;
    },
    capture: () => new Uint8ClampedArray([candidate && acknowledged === 0 ? 1 : 0, 0, 0, 255]),
    png: () => "data:image/png;base64,",
  });
  return compareSequence(renderer(false), renderer(true), [0, 1], 1, 1);
}
window.runPairedProof = runPairedProof;
window.checkPairedHarness = checkPairedHarness;
