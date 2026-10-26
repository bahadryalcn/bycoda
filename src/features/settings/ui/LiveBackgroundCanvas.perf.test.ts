// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";

const state = vi.hoisted(() => ({
  draw: vi.fn(),
  focused: true,
  listeners: new Set<() => void>(),
}));
vi.mock("../model/decorativeMotion", () => ({
  decorativeMotionEnabled: () => true,
  windowHasFocus: () => state.focused,
  subscribeDecorativeMotion: (fn: () => void) => {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },
}));
vi.mock("./live-background", () => ({
  CLOSED_SIGNAL: {},
  createLiveSignalDriver: () => ({ update: () => ({}) }),
  createLiveBackgroundScene: () => ({
    resize: vi.fn(),
    draw: state.draw,
    dispose: vi.fn(),
  }),
}));

const VSYNC_MS = 1000 / 60;
let root: Root;
let container: HTMLDivElement;
let frameQueue: Array<{ id: number; callback: FrameRequestCallback }>;
let nextFrame = 0;
let scheduled = 0;
let clock = 0;

/** Plays `ms` of a 60 Hz display; returns how many frames the canvas asked for. */
function runFor(ms: number): number {
  const before = scheduled;
  for (const end = clock + ms; clock < end;) {
    clock += VSYNC_MS;
    vi.advanceTimersByTime(VSYNC_MS);
    const due = frameQueue;
    frameQueue = [];
    act(() => due.forEach(({ callback }) => callback(clock)));
  }
  return scheduled - before;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.draw.mockClear();
  state.focused = true;
  state.listeners.clear();
  frameQueue = [];
  nextFrame = 0;
  scheduled = 0;
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    scheduled++;
    frameQueue.push({ id, callback });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frameQueue = frameQueue.filter((frame) => frame.id !== id);
  });
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    getImageData: () => ({ data: [1, 2, 3, 255] }),
  } as unknown as CanvasRenderingContext2D);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (props: { active?: boolean; speech?: number; activity?: number } = {}) =>
  act(() =>
    root.render(
      createElement(LiveBackgroundCanvas, {
        effect: "latent-face",
        intensity: 0.4,
        active: true,
        speech: -1,
        activity: -1,
        ...props,
      }),
    ),
  );

describe("live background frame loop", () => {
  // perf P1: an idle (no reply streaming) pane must stop scheduling frames once settled.
  it("schedules no frames for a focused, visible pane with nothing happening", () => {
    render();
    runFor(5_000);
    expect(runFor(2_000)).toBe(0);
  });

  // perf P1: the loop must stop again when a reply finishes.
  it("stops scheduling frames after a streaming reply ends", () => {
    render({ speech: 120, activity: 120 });
    runFor(1_000);
    render({ speech: -1, activity: -1 });
    runFor(5_000);
    expect(runFor(2_000)).toBe(0);
  });

  it("settles during a busy turn without new output and wakes for the next chunk", () => {
    render({ speech: 40, activity: 80 });
    runFor(5_000);
    state.draw.mockClear();
    expect(runFor(2_000)).toBe(0);
    expect(state.draw).not.toHaveBeenCalled();
    render({ speech: 60, activity: 100 });
    expect(runFor(500)).toBeGreaterThan(0);
    expect(state.draw).toHaveBeenCalled();
  });

  it("settles while a tool or approval waits without changing activity", () => {
    render({ speech: -1, activity: 80 });
    runFor(5_000);
    state.draw.mockClear();
    expect(runFor(2_000)).toBe(0);
    expect(state.draw).not.toHaveBeenCalled();
    render({ speech: -1, activity: 92 });
    expect(runFor(500)).toBeGreaterThan(0);
    expect(state.draw).toHaveBeenCalled();
  });

  it("keeps animating while a reply is streaming", () => {
    render({ speech: 40, activity: 40 });
    runFor(1_000);
    state.draw.mockClear();
    render({ speech: 400, activity: 400 });
    expect(runFor(1_000)).toBeGreaterThan(0);
    expect(state.draw.mock.calls.length).toBeGreaterThan(5);
  });

  it("resumes drawing when work starts after the pane settled", () => {
    render();
    runFor(5_000);
    state.draw.mockClear();
    render({ speech: 30, activity: 30 });
    runFor(1_000);
    expect(state.draw.mock.calls.length).toBeGreaterThan(5);
  });

  it("schedules no frames at all for a pane that is not the active one", () => {
    render({ active: false, speech: 30, activity: 30 });
    expect(runFor(2_000)).toBe(0);
  });

  it("never draws faster than 30 fps", () => {
    render({ speech: 30, activity: 30 });
    runFor(500);
    state.draw.mockClear();
    runFor(2_000);
    expect(state.draw.mock.calls.length / 2).toBeLessThanOrEqual(31);
  });

  // perf P1: a window behind another application keeps its last frame and schedules nothing.
  it("schedules no frames while the window is unfocused and resumes on focus", () => {
    render({ speech: 30, activity: 30 });
    runFor(500);
    state.focused = false;
    act(() => state.listeners.forEach((fn) => fn()));
    const painted = state.draw.mock.calls.length;
    expect(runFor(3_000)).toBe(0);
    expect(state.draw.mock.calls.length).toBe(painted);
    state.focused = true;
    act(() => state.listeners.forEach((fn) => fn()));
    expect(runFor(1_000)).toBeGreaterThan(0);
    expect(state.draw.mock.calls.length).toBeGreaterThan(painted);
  });
});
