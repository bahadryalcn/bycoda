// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PacingUncle } from "./PacingUncle";
import { setCanvasWorkerEnabled } from "../../../shared/lib/canvas-worker/host";
import { PACING_RENDERER_ID } from "./pacingCanvasHost";
const state = vi.hoisted(() => ({ motion: true, focused: true, paint: vi.fn() }));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => state.motion,
  useWindowHasFocus: () => state.focused,
}));
vi.mock("./pacingUncleArt", () => ({
  drawPacingUncle: state.paint,
  pacingFrameSignature: (...args: unknown[]) => args.join("|"),
}));
const workers: WorkerFake[] = [];
class WorkerFake {
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((message: { type: string; generation: number; sequence?: number }) => {
    const type = (
      { probe: "capabilities", init: "ready", draw: "drawn", dispose: "disposed" } as Record<
        string,
        string
      >
    )[message.type];
    if (type) this.onmessage?.({ data: { ...message, type, version: 1 } });
  });
  constructor() {
    workers.push(this);
  }
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", WorkerFake);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("IntersectionObserver", undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
    configurable: true,
    value: vi.fn(() => ({})),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
  state.motion = true;
  state.focused = true;
  state.paint.mockClear();
  workers.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setCanvasWorkerEnabled(PACING_RENDERER_ID, true);
});
afterEach(() => {
  act(() => root.unmount());
  setCanvasWorkerEnabled(PACING_RENDERER_ID, false);
  container.remove();
  delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = (visible = true) => act(() => root.render(createElement(PacingUncle, { visible })));
it("retains original main clock, 83ms cadence, focus, visibility and motion gates", () => {
  render();
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(83));
  const frame = workers[0].postMessage.mock.calls.filter(([m]) => m.type === "draw").at(-1)?.[0];
  expect(frame).toMatchObject({
    frame: { width: 180, height: 32, elapsed: 0.083, theme: "classic" },
  });
  render(false);
  expect(vi.getTimerCount()).toBe(0);
  render();
  expect(vi.getTimerCount()).toBe(1);
  state.focused = false;
  render();
  expect(vi.getTimerCount()).toBe(0);
  state.focused = true;
  state.motion = false;
  render();
  expect(vi.getTimerCount()).toBe(0);
  act(() => root.unmount());
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("StrictMode double mount transfers fresh elements and cleans every worker", () => {
  act(() => root.render(createElement(StrictMode, null, createElement(PacingUncle))));
  const transfers = vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mock.contexts;
  expect(transfers.length).toBeGreaterThanOrEqual(2);
  expect(new Set(transfers).size).toBe(transfers.length);
  expect(container.querySelectorAll("canvas")).toHaveLength(2);
  act(() => root.unmount());
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
