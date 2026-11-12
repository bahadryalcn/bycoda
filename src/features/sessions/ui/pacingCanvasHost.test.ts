// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPacingCanvasHost, createPacingFrameHarness } from "./pacingCanvasHost";
import { paintPacingFrame } from "./pacingCanvasPainter";
import type { CanvasReply } from "../../../shared/lib/canvas-worker/types";
const paint = vi.hoisted(() => vi.fn());
vi.mock("./pacingUncleArt", () => ({
  drawPacingUncle: paint,
  pacingFrameSignature: (w: number, h: number, t: number, theme: string, dpr: number) =>
    `${w}|${h}|${Math.floor(t * 12)}|${theme}|${dpr}`,
}));
class FakeWorker {
  onmessage: ((e: MessageEvent<CanvasReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  reply(type: string, extra = {}) {
    this.onmessage?.({
      data: {
        version: 1,
        generation: this.postMessage.mock.calls[0][0].generation,
        type,
        ...extra,
      },
    } as MessageEvent<CanvasReply>);
  }
}
let original: HTMLCanvasElement;
let worker: FakeWorker;
let contexts: WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>;
beforeEach(() => {
  vi.useFakeTimers();
  paint.mockClear();
  contexts = new WeakMap();
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this);
    if (!context) {
      context = { canvas: this, setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;
      contexts.set(this, context);
    }
    return context;
  } as typeof HTMLCanvasElement.prototype.getContext);
  vi.stubGlobal("Worker", FakeWorker);
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
    configurable: true,
    value: vi.fn(() => ({})),
  });
  original = document.createElement("canvas");
  document.body.append(original);
  worker = new FakeWorker();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  vi.useRealTimers();
});
const frame = { width: 180, height: 32, elapsed: 1, theme: "classic" as const };
it.each(["classic", "lotr", "matrix", "star-wars"] as const)(
  "passes unchanged %s painter arguments",
  (theme) => {
    const context = original.getContext("2d")!;
    paintPacingFrame(context, { ...frame, theme });
    expect(paint).toHaveBeenCalledExactlyOnceWith(context, 180, 32, 1, theme);
  },
);
it("retains old canvas until ACK and sends main painter inputs with identical frame skipping", () => {
  const host = createPacingCanvasHost(original, () => worker as unknown as Worker);
  host.resize({ width: 180, height: 32, ratio: 1.5 });
  host.draw(frame);
  const originalContext = contexts.get(original);
  expect(paint).toHaveBeenLastCalledWith(originalContext, 180, 32, 1, "classic");
  worker.reply("capabilities");
  worker.reply("ready");
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
  const message = worker.postMessage.mock.calls.find(([m]) => m.type === "draw")![0];
  expect(message.frame).toEqual(frame);
  host.draw({ ...frame, elapsed: 1.001 });
  expect(worker.postMessage.mock.calls.filter(([m]) => m.type === "draw")).toHaveLength(1);
  worker.reply("drawn", { sequence: message.sequence });
  expect(original.style.visibility).toBe("hidden");
  host.dispose();
  worker.reply("disposed");
  expect(original.style.visibility).toBe("");
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["constructor", "unsupported", "transfer", "timeout", "worker", "context", "messageerror"])(
  "paints fresh fallback before swap on %s",
  (failure) => {
    const factory = () => {
      if (failure === "constructor") throw new Error("CSP");
      return worker as unknown as Worker;
    };
    if (failure === "unsupported") vi.stubGlobal("OffscreenCanvas", undefined);
    if (failure === "transfer")
      vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mockImplementation(() => {
        throw new Error("transfer");
      });
    const host = createPacingCanvasHost(original, factory);
    host.resize({ width: 180, height: 32, ratio: 2 });
    host.draw(frame);
    if (["transfer", "context"].includes(failure)) worker.reply("capabilities");
    if (failure === "worker") worker.onerror?.();
    if (failure === "messageerror") worker.onmessageerror?.();
    if (failure === "context") worker.reply("error", { reason: "Canvas context lost" });
    if (failure === "timeout") vi.advanceTimersByTime(2000);
    const fallback = original.nextElementSibling as HTMLCanvasElement;
    expect(fallback).toBeInstanceOf(HTMLCanvasElement);
    expect(fallback).not.toBe(original);
    expect(fallback.width).toBe(360);
    expect(paint).toHaveBeenLastCalledWith(contexts.get(fallback), 180, 32, 1, "classic");
    expect(original.style.visibility).toBe("hidden");
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  },
);
it("StrictMode-style teardown and recreation transfer distinct candidates", () => {
  const first = createPacingCanvasHost(original, () => worker as unknown as Worker);
  first.draw(frame);
  worker.reply("capabilities");
  const firstCanvas = vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mock
    .contexts[0];
  first.dispose();
  worker.reply("disposed");
  const nextWorker = new FakeWorker();
  const second = createPacingCanvasHost(original, () => nextWorker as unknown as Worker);
  second.draw(frame);
  nextWorker.reply("capabilities");
  expect(
    vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mock.contexts[1],
  ).not.toBe(firstCanvas);
  second.dispose();
  nextWorker.reply("disposed");
  expect(vi.getTimerCount()).toBe(0);
});
it("restores a visible freshly painted canvas after an acknowledged worker crashes", () => {
  const host = createPacingCanvasHost(original, () => worker as unknown as Worker);
  host.resize({ width: 180, height: 32, ratio: 1 });
  host.draw(frame);
  worker.reply("capabilities");
  worker.reply("ready");
  worker.reply("drawn", { sequence: 1 });
  const transferred = original.nextElementSibling;
  worker.onerror?.();
  const fallback = original.nextElementSibling as HTMLCanvasElement;
  expect(fallback).not.toBe(transferred);
  expect(fallback.style.visibility).toBe("");
  expect(fallback.hidden).toBe(false);
  expect(paint).toHaveBeenLastCalledWith(contexts.get(fallback), 180, 32, 1, "classic");
  expect(worker.terminate).toHaveBeenCalledOnce();
  host.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("fixture entry draws deterministic frame N using original painter", async () => {
  const harness = createPacingFrameHarness(original, "main", { width: 180, height: 32, ratio: 1 });
  await harness.drawFrame(36, "lotr");
  expect(paint).toHaveBeenLastCalledWith(contexts.get(original), 180, 32, 3, "lotr");
  harness.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("replays startup sizes before their affected samples without dropping frames", () => {
  const host = createPacingCanvasHost(original, () => worker as unknown as Worker);
  host.resize({ width: 180, height: 32, ratio: 1 });
  host.draw(frame);
  host.resize({ width: 200, height: 32, ratio: 2 });
  host.draw({ ...frame, width: 200, elapsed: 2 });
  worker.reply("capabilities");
  worker.reply("ready");
  const messages = worker.postMessage.mock.calls
    .map(([m]) => m)
    .filter((m) => ["resize", "draw"].includes(m.type));
  expect(messages.map((m) => m.type)).toEqual(["resize", "draw", "resize", "draw"]);
  expect(messages[0].size).toEqual({ width: 180, height: 32, ratio: 1 });
  expect(messages[1].frame).toEqual(frame);
  expect(messages[2].size).toEqual({ width: 200, height: 32, ratio: 2 });
  host.dispose();
  worker.reply("disposed");
  expect(vi.getTimerCount()).toBe(0);
});
it("fixture worker entry awaits sequence ACK and reads pixels in owning realm", async () => {
  vi.stubGlobal("Worker", function TestWorker() {
    return worker;
  });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  const harness = createPacingFrameHarness(original, "worker", { width: 1, height: 1, ratio: 1 });
  worker.reply("capabilities");
  worker.reply("ready");
  let drawn = false;
  const drawing = harness.drawFrame(36, "matrix").then(() => {
    drawn = true;
  });
  await Promise.resolve();
  expect(drawn).toBe(false);
  expect(worker.postMessage.mock.lastCall?.[0]).toMatchObject({
    type: "draw",
    sequence: 1,
    frame: { elapsed: 3, theme: "matrix" },
  });
  worker.reply("drawn", { sequence: 1 });
  await drawing;
  const capture = harness.capture();
  await Promise.resolve();
  worker.reply("captured", {
    sequence: 2,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([1, 2, 3, 4]),
  });
  expect((await capture).data).toEqual(new Uint8ClampedArray([1, 2, 3, 4]));
  harness.dispose();
  worker.reply("disposed");
  expect(vi.getTimerCount()).toBe(0);
});
