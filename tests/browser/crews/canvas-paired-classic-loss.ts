import { createCanvasWorkerHost } from "../../../src/shared/lib/canvas-worker/host";
import { prepareClassicCrewAssets } from "../../../src/features/sessions/ui/crewCanvasAssets";
import { createCrewFrameHarness } from "../../../src/features/sessions/ui/crewCanvasHost";
import type { CrewCanvasFrame } from "../../../src/features/sessions/ui/crewCanvasHost";
import type { CanvasReply } from "../../../src/shared/lib/canvas-worker/types";
async function contextLoss() {
  const assets = await prepareClassicCrewAssets();
  assets.sign?.close();
  assets.sign = null;
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const worker = new Worker(new URL("./crew-context-loss.worker.ts", import.meta.url), {
    type: "module",
  });
  let failure = "";
  let settle: (value: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const host = createCanvasWorkerHost<CrewCanvasFrame>({
    canvas,
    size: { width: 2280, height: 1170, ratio: 1 },
    assets,
    createWorker: () => worker,
    onReady: () => settle(true),
    onFailure: (reason) => {
      failure = reason;
      settle(false);
    },
  });
  const main = await createCrewFrameHarness(
    document.createElement("canvas"),
    "main",
    "canvas",
    true,
  );
  try {
    host.start();
    if (!(await ready)) throw new Error(failure);
    const frame: CrewCanvasFrame = {
      actions: Array(6).fill("idle"),
      activity: Array.from({ length: 6 }, (_, id) => ({ stand: id < 3 ? 1 : 0, talk: 0 })),
      width: 1200,
      time: 1200,
    };
    const draw = () => new Promise<CanvasReply | null>((resolve) => host.draw(frame, resolve));
    const before = await draw();
    if (before?.type !== "drawn" || before.backend !== "webgl")
      throw new Error("Worker WebGL not used");
    const lost = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Context loss timeout")), 2000);
      const receive = (event: MessageEvent) => {
        if (event.data.type === "test-lost") {
          clearTimeout(timer);
          worker.removeEventListener("message", receive);
          resolve(event.data.lost);
        }
      };
      worker.addEventListener("message", receive);
      worker.postMessage({ type: "test-lose-webgl" });
    });
    const after = await draw();
    const capture = await new Promise<CanvasReply | null>((resolve) => host.capture(resolve));
    if (capture?.type !== "captured") throw new Error(failure || "Capture failed");
    await main.draw(frame);
    const reference = (await main.capture()).data;
    let differingPixels = 0,
      maxChannelDelta = 0;
    for (let offset = 0; offset < reference.length; offset += 4) {
      let different = false;
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(reference[offset + c] - capture.pixels[offset + c]);
        different ||= delta !== 0;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      if (different) differingPixels++;
    }
    return {
      lost,
      before: before.backend,
      after: after?.type === "drawn" ? after.backend : after?.type,
      differingPixels,
      maxChannelDelta,
    };
  } finally {
    host.dispose();
    main.dispose();
    canvas.remove();
  }
}
declare global {
  interface Window {
    classicContextLoss: typeof contextLoss;
  }
}
window.classicContextLoss = contextLoss;
