// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCrewCanvasHost, CLASSIC_CREW_WORKER_QUALIFIED } from "./crewCanvasHost";
import { createCrewCanvasRuntime } from "./crewCanvasRuntime";
import type { ClassicCrewAssets } from "./crewCanvasAssets";
import type { CanvasReply, CanvasRequest } from "../../../shared/lib/canvas-worker/types";
import type { CrewCanvasFrame } from "./crewCanvasHost";
const state = vi.hoisted(() => ({ painters: [] as any[] }));
vi.mock("./crewCodeArt", async (original) => ({
  ...(await original<object>()),
  createCodeArtPainter: vi.fn((canvas: HTMLCanvasElement, options: object) => {
    const draw = Object.assign(vi.fn(), { dispose: vi.fn(), backend: "webgl" });
    state.painters.push({ canvas, options, draw });
    return draw;
  }),
}));
class FakeWorker {
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  reply(type: string, body = {}) {
    this.onmessage?.({
      data: { version: 1, generation: this.postMessage.mock.calls[0][0].generation, type, ...body },
    });
  }
}
class FakeCanvas {
  width = 1;
  height = 1;
  context = {
    setTransform: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  };
  getContext = vi.fn(() => this.context);
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}
let canvas: HTMLCanvasElement;
let worker: FakeWorker;
let assets: ClassicCrewAssets;
const frame: CrewCanvasFrame = {
  actions: ["idle", "sip"],
  activity: [
    { stand: 0.5, talk: 0 },
    { stand: 0, talk: 1 },
  ],
  width: 800,
  time: 240,
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  state.painters.length = 0;
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
    configurable: true,
    value: vi.fn(() => new FakeCanvas()),
  });
  canvas = document.createElement("canvas");
  document.body.append(canvas);
  worker = new FakeWorker();
  assets = {
    tiles: [],
    sign: null,
    signWidth: 0,
    signHeight: 0,
    palette: {} as never,
    renderer: "auto",
  };
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
});
const start = () =>
  createCrewCanvasHost(
    canvas,
    () => worker as unknown as Worker,
    async () => assets,
  );
it("refuses product admission until both loaded-sign backends have exact parity", () => {
  expect(CLASSIC_CREW_WORKER_QUALIFIED).toBe(false);
});
it("replays every main argument in order, assets before draws; retains original until ACK", async () => {
  const draw = start();
  draw(frame.actions, frame.activity, frame.width, frame.time);
  const next = { ...frame, time: 480 };
  draw(next.actions, next.activity, next.width, next.time);
  expect(state.painters[0].draw.mock.calls).toEqual([
    [frame.actions, frame.activity, 800, 240],
    [next.actions, next.activity, 800, 480],
  ]);
  await flush();
  worker.reply("capabilities");
  worker.reply("ready");
  const messages = worker.postMessage.mock.calls.map(([m]) => m);
  expect(messages.map((m) => m.type)).toEqual(["probe", "init", "draw", "draw"]);
  expect(messages[1].assets).toBe(assets);
  expect(messages.slice(2).map((m) => m.frame)).toEqual([frame, next]);
  expect(canvas.style.display).toBe("");
  worker.reply("drawn", { sequence: 1 });
  expect(canvas.style.display).toBe("none");
  expect(state.painters[0].draw.dispose).toHaveBeenCalledOnce();
  draw.dispose?.();
  worker.reply("disposed");
  expect(vi.getTimerCount()).toBe(0);
});
it.each([
  "constructor",
  "unsupported",
  "transfer",
  "init-timeout",
  "paint-timeout",
  "error",
  "messageerror",
  "post",
  "paint",
  "context",
  "overflow",
  "assets",
])("fresh prepainted fallback after %s", async (mode) => {
  if (mode === "unsupported") vi.stubGlobal("OffscreenCanvas", undefined);
  if (mode === "transfer")
    vi.mocked(canvas.transferControlToOffscreen).mockImplementation(() => {
      throw new Error("transfer");
    });
  const draw = createCrewCanvasHost(
    canvas,
    () => {
      if (mode === "constructor") throw new Error("CSP");
      return worker as unknown as Worker;
    },
    async () => {
      if (mode === "assets") throw new Error("assets");
      return assets;
    },
  );
  draw(frame.actions, frame.activity, frame.width, frame.time);
  await flush();
  if (["transfer", "paint-timeout", "paint", "context", "overflow", "post"].includes(mode))
    worker.reply("capabilities");
  if (["paint-timeout", "paint", "context", "overflow", "post"].includes(mode))
    worker.reply("ready");
  if (mode === "error") worker.onerror?.();
  if (mode === "messageerror") worker.onmessageerror?.();
  if (mode === "paint" || mode === "context") worker.reply("error", { reason: mode });
  if (mode === "post") {
    worker.postMessage.mockImplementation(() => {
      throw new Error("post");
    });
    draw(frame.actions, frame.activity, 800, 360);
  }
  if (mode === "overflow") for (let n = 0; n < 33; n++) draw(frame.actions, frame.activity, 800, n);
  if (mode.endsWith("timeout")) vi.advanceTimersByTime(2000);
  const fallback = state.painters.at(-1);
  expect(fallback.canvas).not.toBe(canvas);
  expect(fallback.draw).toHaveBeenCalled();
  expect(canvas.nextElementSibling).toBe(fallback.canvas);
  expect(canvas.style.display).toBe("none");
  draw.dispose?.();
  vi.advanceTimersByTime(100);
  expect(vi.getTimerCount()).toBe(0);
});
it("crash after ACK replaces transferred canvas; stale replies cannot swap it back", async () => {
  const draw = start();
  draw(frame.actions, frame.activity, 800, 240);
  await flush();
  worker.reply("capabilities");
  worker.reply("ready");
  worker.reply("drawn", { sequence: 1 });
  const transferred = canvas.nextElementSibling;
  const receive = worker.onmessage!;
  worker.onerror?.();
  expect(canvas.nextElementSibling).not.toBe(transferred);
  receive({
    data: {
      version: 1,
      generation: worker.postMessage.mock.calls[0][0].generation,
      type: "drawn",
      sequence: 1,
    },
  });
  expect(canvas.nextElementSibling).toBe(state.painters.at(-1).canvas);
  draw.dispose?.();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("teardown during asset preparation closes late assets without creating worker", async () => {
  let finish: (value: ClassicCrewAssets) => void = () => {};
  const prepare = new Promise<ClassicCrewAssets>((resolve) => {
    finish = resolve;
  });
  const factory = vi.fn(() => worker as unknown as Worker);
  const draw = createCrewCanvasHost(canvas, factory, () => prepare);
  draw.dispose?.();
  const close = vi.fn();
  finish({ ...assets, sign: { close } as unknown as ImageBitmap });
  await flush();
  expect(close).toHaveBeenCalledOnce();
  expect(factory).not.toHaveBeenCalled();
});
it("StrictMode-style remount uses distinct transfer candidates and bounded disposal", async () => {
  const first = start();
  await flush();
  worker.reply("capabilities");
  first.dispose?.();
  vi.advanceTimersByTime(100);
  worker = new FakeWorker();
  const second = start();
  await flush();
  worker.reply("capabilities");
  const transfers = vi.mocked(canvas.transferControlToOffscreen).mock.contexts;
  expect(transfers).toHaveLength(2);
  expect(new Set(transfers).size).toBe(2);
  second.dispose?.();
  worker.reply("disposed");
  expect(vi.getTimerCount()).toBe(0);
});
it("runtime initializes shared painter from assets, paints supplied sample, captures and disposes", () => {
  const replies: CanvasReply[] = [];
  const receive = createCrewCanvasRuntime((reply) => replies.push(reply));
  const send = (message: object) =>
    receive({ version: 1, generation: 1, ...message } as CanvasRequest<CrewCanvasFrame>);
  const target = new FakeCanvas();
  send({ type: "probe" });
  send({
    type: "init",
    canvas: target,
    size: { width: 2280, height: 1170, ratio: 1 },
    assets: { ...assets, tiles: [{ width: 12, height: 20, data: new Uint8ClampedArray(960) }] },
  });
  send({ type: "resize", size: { width: 2280, height: 1170, ratio: 1 } });
  send({ type: "draw", sequence: 1, frame });
  send({ type: "draw", sequence: 1, frame });
  expect(state.painters[0].draw).toHaveBeenCalledExactlyOnceWith(
    frame.actions,
    frame.activity,
    800,
    240,
  );
  expect(replies.at(-1)).toMatchObject({
    type: "drawn",
    sequence: 1,
    backend: "webgl",
    busy: false,
  });
  send({ type: "capture", sequence: 2 });
  expect(replies.at(-1)?.type).toBe("captured");
  send({ type: "dispose" });
  expect(state.painters[0].draw.dispose).toHaveBeenCalledOnce();
  expect(replies.at(-1)?.type).toBe("disposed");
});
it("runtime rejects missing assets without acknowledging pixels", () => {
  const replies: CanvasReply[] = [];
  const receive = createCrewCanvasRuntime((reply) => replies.push(reply));
  const send = (message: object) =>
    receive({ version: 1, generation: 1, ...message } as CanvasRequest<CrewCanvasFrame>);
  send({ type: "probe" });
  send({ type: "init", canvas: new FakeCanvas(), size: { width: 2280, height: 1170, ratio: 1 } });
  expect(replies.at(-1)).toMatchObject({ type: "error", reason: "Crew assets unavailable" });
});

it("runtime reports paint errors and releases decoded sign on disposal", () => {
  const replies: CanvasReply[] = [];
  const receive = createCrewCanvasRuntime((reply) => replies.push(reply));
  const send = (message: object) =>
    receive({ version: 1, generation: 1, ...message } as CanvasRequest<CrewCanvasFrame>);
  const close = vi.fn();
  send({ type: "probe" });
  send({
    type: "init",
    canvas: new FakeCanvas(),
    size: { width: 2280, height: 1170, ratio: 1 },
    assets: {
      ...assets,
      sign: { close },
      tiles: [{ width: 12, height: 20, data: new Uint8ClampedArray(960) }],
    },
  });
  state.painters[0].draw.mockImplementation(() => {
    throw new Error("Injected paint error");
  });
  send({ type: "draw", sequence: 1, frame });
  expect(replies.at(-1)).toMatchObject({ type: "error", reason: "Injected paint error" });
  expect(replies.some((reply) => reply.type === "drawn")).toBe(false);
  send({ type: "dispose" });
  expect(close).toHaveBeenCalledOnce();
});

it("closes frame bitmaps after paint, errors, stale requests and disposal", () => {
  const receive = createCrewCanvasRuntime(() => {});
  const send = (message: object) =>
    receive({ version: 1, generation: 1, ...message } as CanvasRequest<CrewCanvasFrame>);
  send({ type: "probe" });
  send({
    type: "init",
    canvas: new FakeCanvas(),
    size: { width: 2280, height: 1170, ratio: 1 },
    assets: { ...assets, sign: { close: vi.fn() }, tiles: [{ width: 12, height: 20 }] },
  });
  const context = {
    save: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    imageSmoothingEnabled: true,
  };
  state.painters[0].draw.mockImplementation(() => state.painters[0].options.paintSign(context));
  const close = vi.fn();
  send({ type: "draw", sequence: 1, frame: { ...frame, signLayer: { close } } });
  expect(context.setTransform).toHaveBeenCalledExactlyOnceWith(1, 0, 0, 1, 0, 0);
  expect(context.drawImage).toHaveBeenCalledWith(expect.objectContaining({ close }), 0, 0);
  expect(context.imageSmoothingEnabled).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  send({ type: "draw", sequence: 1, frame: { ...frame, signLayer: { close } } });
  state.painters[0].draw.mockImplementation(() => {
    throw new Error("paint failed");
  });
  send({ type: "draw", sequence: 2, frame: { ...frame, signLayer: { close } } });
  send({ type: "draw", sequence: 3, generation: 9, frame: { ...frame, signLayer: { close } } });
  send({ type: "dispose" });
  send({ type: "draw", sequence: 4, frame: { ...frame, signLayer: { close } } });
  expect(close).toHaveBeenCalledTimes(5);
});
