// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasWorkerEnabled, createCanvasWorkerHost, setCanvasWorkerEnabled } from "./host";
import { createCanvasWorkerRuntime } from "./runtime";
import type { CanvasReply, CanvasRequest } from "./types";

class FakeCanvas extends EventTarget {
  width = 0;
  height = 0;
  context = { setTransform: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
  getContext() {
    return this.context;
  }
}
class FakeWorker {
  onmessage: ((event: MessageEvent<CanvasReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  reply(type: CanvasReply["type"], extra = {}) {
    const generation = this.postMessage.mock.calls[0][0].generation;
    this.onmessage?.({
      data: { version: 1, generation, type, ...extra },
    } as MessageEvent<CanvasReply>);
  }
}
function setup(
  prepareFrame?: (frame: number) => {
    frame: number;
    transfer: Transferable[];
    release?: () => void;
  },
) {
  const canvas = document.createElement("canvas");
  const transfer = vi.fn(() => new FakeCanvas() as unknown as OffscreenCanvas);
  canvas.transferControlToOffscreen = transfer;
  const worker = new FakeWorker();
  const failure = vi.fn();
  const ready = vi.fn();
  const host = createCanvasWorkerHost<number>({
    canvas,
    size: { width: 80, height: 32, ratio: 1.5 },
    createWorker: () => worker as unknown as Worker,
    onReady: ready,
    prepareFrame,
    onFailure: failure,
    deadlineMs: 20,
  });
  return { host, canvas, transfer, worker, failure, ready };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setCanvasWorkerEnabled("test", false);
});
describe("canvas worker host", () => {
  it("handles an actual constructor/CSP throw and bounded queue overflow", () => {
    const { canvas } = setup();
    const failure = vi.fn();
    const denied = createCanvasWorkerHost({
      canvas,
      size: { width: 1, height: 1, ratio: 1 },
      createWorker: () => {
        throw new Error("CSP");
      },
      onReady: vi.fn(),
      onFailure: failure,
    });
    denied.start();
    expect(failure).toHaveBeenCalledExactlyOnceWith("Worker constructor failed");
    const { host, worker, failure: overflow } = setup();
    host.start();
    worker.reply("capabilities");
    worker.reply("ready");
    const complete = vi.fn();
    for (let i = 0; i < 33; i++) host.draw(i, complete);
    expect(overflow).toHaveBeenCalledExactlyOnceWith("Canvas queue overflow");
    expect(complete).toHaveBeenCalledTimes(33);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("defaults off and supports explicit per-renderer opt in", () => {
    expect(canvasWorkerEnabled("test")).toBe(false);
    setCanvasWorkerEnabled("test", true);
    expect(canvasWorkerEnabled("test")).toBe(true);
    expect(canvasWorkerEnabled("other")).toBe(false);
  });
  it("probes before transferring once, rejects stale generations and orders resize/draw", () => {
    const { host, worker, transfer, ready } = setup();
    host.start();
    host.start();
    expect(transfer).not.toHaveBeenCalled();
    worker.reply("capabilities", { generation: -1 });
    expect(transfer).not.toHaveBeenCalled();
    worker.reply("capabilities");
    worker.reply("capabilities");
    expect(transfer).toHaveBeenCalledTimes(1);
    worker.reply("ready");
    worker.reply("ready");
    expect(ready).toHaveBeenCalledTimes(1);
    host.resize({ width: 100, height: 32, ratio: 2 });
    const complete = vi.fn();
    host.draw(7, complete);
    expect(worker.postMessage.mock.calls.map(([m]) => m.type)).toEqual([
      "probe",
      "init",
      "resize",
      "draw",
    ]);
    worker.reply("drawn", { sequence: 1, generation: -1 });
    expect(complete).not.toHaveBeenCalled();
    worker.reply("drawn", { sequence: 1 });
    worker.reply("drawn", { sequence: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    host.dispose();
    worker.reply("disposed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "error",
    "messageerror",
    "timeout",
    "paint-timeout",
    "post",
    "transfer",
    "unsupported",
    "constructor",
  ])("terminates and clears waits on %s", (kind) => {
    const { host, worker, transfer, failure } = setup();
    if (kind === "unsupported") vi.stubGlobal("OffscreenCanvas", undefined);
    if (kind === "constructor")
      worker.postMessage.mockImplementationOnce(() => {
        throw new Error("CSP");
      });
    if (kind === "transfer")
      transfer.mockImplementation(() => {
        throw new Error("transfer");
      });
    host.start();
    if (["paint-timeout", "post"].includes(kind)) {
      worker.reply("capabilities");
      worker.reply("ready");
      if (kind === "post")
        worker.postMessage.mockImplementationOnce(() => {
          throw new Error("clone");
        });
      host.draw(1);
    }
    if (kind === "transfer") worker.reply("capabilities");
    if (kind === "error") worker.onerror?.();
    if (kind === "messageerror") worker.onmessageerror?.();
    vi.advanceTimersByTime(30);
    expect(failure).toHaveBeenCalledTimes(1);
    if (kind !== "unsupported") expect(worker.terminate).toHaveBeenCalledTimes(1);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds disposal when no acknowledgement arrives", () => {
    const { host, worker } = setup();
    host.start();
    host.dispose();
    vi.advanceTimersByTime(100);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects transferring an element again across host instances", () => {
    const { host, canvas, worker, transfer } = setup();
    host.start();
    worker.reply("capabilities");
    host.dispose();
    worker.reply("disposed");
    const next = new FakeWorker();
    const failure = vi.fn();
    const second = createCanvasWorkerHost({
      canvas,
      size: { width: 1, height: 1, ratio: 1 },
      createWorker: () => next as unknown as Worker,
      onReady: vi.fn(),
      onFailure: failure,
    });
    second.start();
    next.reply("capabilities");
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledOnce();
  });
});
describe("canvas worker runtime", () => {
  it("paints exact supplied inputs once and rejects old sequences and generations", () => {
    const post = vi.fn();
    const paint = vi.fn();
    const receive = createCanvasWorkerRuntime<number>(post, paint);
    const send = (message: object) =>
      receive({ version: 1, generation: 3, ...message } as CanvasRequest<number>);
    send({ type: "probe" });
    const canvas = new FakeCanvas();
    send({ type: "init", canvas, size: { width: 80, height: 32, ratio: 2 } });
    send({ type: "draw", sequence: 1, frame: 7 });
    send({ type: "draw", sequence: 1, frame: 8 });
    send({ type: "draw", generation: 2, sequence: 2, frame: 9 });
    expect(paint).toHaveBeenCalledExactlyOnceWith(canvas.context, 7);
    expect(canvas.width).toBe(160);
    canvas.dispatchEvent(new Event("contextlost"));
    expect(post.mock.lastCall?.[0]).toMatchObject({ type: "error", reason: "Canvas context lost" });
    send({ type: "dispose" });
    send({ type: "draw", sequence: 2, frame: 9 });
    expect(paint).toHaveBeenCalledTimes(1);
    expect(post.mock.lastCall?.[0].type).toBe("disposed");
  });
  it("reports missing worker 2D and paint failure", () => {
    const post = vi.fn();
    const receive = createCanvasWorkerRuntime(post, () => {
      throw new Error("paint");
    });
    receive({ version: 1, generation: 1, type: "probe" });
    receive({
      version: 1,
      generation: 1,
      type: "init",
      canvas: new FakeCanvas() as unknown as OffscreenCanvas,
      size: { width: 1, height: 1, ratio: 1 },
    });
    receive({ version: 1, generation: 1, type: "draw", sequence: 1, frame: 0 });
    expect(post.mock.lastCall?.[0]).toMatchObject({ type: "error", reason: "paint" });
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    const missing = createCanvasWorkerRuntime(post, vi.fn());
    missing({ version: 1, generation: 2, type: "probe" });
    expect(post.mock.lastCall?.[0]).toMatchObject({
      type: "error",
      reason: "Worker 2D unavailable",
    });
  });
});

it("prepares transferables only for accepted draws and releases a failed post", () => {
  const release = vi.fn();
  const transfer = new ArrayBuffer(4);
  const prepare = vi.fn((frame: number) => ({ frame: frame + 1, transfer: [transfer], release }));
  const { host, worker } = setup(prepare);
  host.draw(1);
  expect(prepare).not.toHaveBeenCalled();
  host.start();
  worker.reply("capabilities");
  worker.reply("ready");
  host.draw(2);
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ frame: 3 }), [
    transfer,
  ]);
  worker.postMessage.mockImplementationOnce(() => {
    throw new Error("post failed");
  });
  host.draw(3);
  expect(release).toHaveBeenCalledOnce();
  host.draw(4);
  expect(prepare).toHaveBeenCalledTimes(2);
  host.dispose();
});
