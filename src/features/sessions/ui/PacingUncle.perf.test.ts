// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PacingUncle } from "./PacingUncle";

const state = vi.hoisted(() => ({ paint: vi.fn() }));
vi.mock("../../settings/model/decorativeMotion", () => ({
  useDecorativeMotionEnabled: () => true,
}));
vi.mock("./pacingUncleArt", () => ({ drawPacingUncle: state.paint }));

const VSYNC_MS = 16;
let root: Root;
let container: HTMLDivElement;
let wakeups = 0;
let frameQueue: Array<{ id: number; callback: FrameRequestCallback }>;
let nextFrame = 0;
let clock = 0;

/** Simulates a 60 Hz display for `ms` and counts every callback the page is woken for. */
function runFor(ms: number) {
  for (const end = clock + ms; clock < end;) {
    clock += VSYNC_MS;
    vi.advanceTimersByTime(VSYNC_MS);
    const due = frameQueue;
    frameQueue = [];
    for (const { callback } of due) {
      wakeups++;
      callback(clock);
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  wakeups = 0;
  clock = 0;
  nextFrame = 0;
  frameQueue = [];
  state.paint.mockClear();
  // Count timer callbacks as wakeups too, so replacing rAF with a timer is judged fairly.
  const timeout = globalThis.setTimeout;
  const interval = globalThis.setInterval;
  vi.stubGlobal("setTimeout", (callback: () => void, delay?: number) =>
    timeout(() => {
      wakeups++;
      callback();
    }, delay),
  );
  vi.stubGlobal("setInterval", (callback: () => void, delay?: number) =>
    interval(() => {
      wakeups++;
      callback();
    }, delay),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frameQueue.push({ id, callback });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frameQueue = frameQueue.filter((frame) => frame.id !== id);
  });
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(180);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () => act(() => root.render(createElement(PacingUncle, { visible: true })));

describe("pacing uncle wake-up rate", () => {
  // perf P7: animate on a ~50 ms timer, not a per-vsync rAF chain.
  it("wakes the page at most ~20 times a second while walking", () => {
    mount();
    wakeups = 0;
    runFor(2_000);
    expect(wakeups / 2).toBeLessThanOrEqual(25);
  });

  it("keeps walking: repaints several times a second and never faster than 25 Hz", () => {
    mount();
    state.paint.mockClear();
    runFor(2_000);
    expect(state.paint.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(state.paint.mock.calls.length / 2).toBeLessThanOrEqual(25);
  });

  it("leaves no pending frame or timer after unmount", () => {
    mount();
    runFor(200);
    act(() => root.unmount());
    expect(frameQueue).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });
});
