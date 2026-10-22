// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";

const state = vi.hoisted(() => ({
  enabled: true,
  listeners: new Set<() => void>(),
  draw: vi.fn(),
  dispose: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../model/decorativeMotion", () => ({
  decorativeMotionEnabled: () => state.enabled,
  subscribeDecorativeMotion: (fn: () => void) => {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },
}));
vi.mock("./live-background", () => ({
  CLOSED_SIGNAL: {},
  createLiveSignalDriver: () => ({ update: () => ({}) }),
  createLiveBackgroundScene: (...args: unknown[]) => {
    state.create(...args);
    return { resize: vi.fn(), draw: state.draw, dispose: state.dispose };
  },
}));
let root: Root, container: HTMLDivElement;
let intersection: (entries: Array<{ isIntersecting: boolean }>) => void;
let raf: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.enabled = true;
  state.listeners.clear();
  vi.clearAllMocks();
  raf = vi.fn(() => 42);
  cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(fn: typeof intersection) {
        intersection = fn;
      }
      observe() {}
      disconnect() {}
    },
  );
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
});
const render = (active = true) =>
  act(() =>
    root.render(
      createElement(LiveBackgroundCanvas, { effect: "gradient-ascii", intensity: 0.4, active }),
    ),
  );
const intersect = (value: boolean) => act(() => intersection([{ isIntersecting: value }]));

it("runs only the visible active panel and retains its last frame and scene across pauses", () => {
  render();
  expect(raf).not.toHaveBeenCalled();
  intersect(true);
  expect(raf).toHaveBeenCalledOnce();
  const paints = state.draw.mock.calls.length;
  render(false);
  expect(cancel).toHaveBeenCalledWith(42);
  expect(state.draw).toHaveBeenCalledTimes(paints);
  expect(state.dispose).not.toHaveBeenCalled();
  render(true);
  expect(raf).toHaveBeenCalledTimes(2);
  intersect(false);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(state.create).toHaveBeenCalledOnce();
});

it("stops immediately through the central gate without repainting, and cleans subscriptions", () => {
  render();
  intersect(true);
  const paints = state.draw.mock.calls.length;
  state.enabled = false;
  act(() => state.listeners.forEach((fn) => fn()));
  expect(cancel).toHaveBeenCalledWith(42);
  expect(state.draw).toHaveBeenCalledTimes(paints);
  state.enabled = true;
  act(() => state.listeners.forEach((fn) => fn()));
  expect(raf).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
  expect(state.listeners.size).toBe(0);
  expect(state.dispose).toHaveBeenCalledOnce();
});

it("caps painting at 30 fps even on a faster display", () => {
  render();
  intersect(true);
  state.draw.mockClear();
  raf.mock.calls[0][0](100);
  raf.mock.calls[1][0](116);
  raf.mock.calls[2][0](132);
  expect(state.draw).toHaveBeenCalledOnce();
  raf.mock.calls[3][0](134);
  expect(state.draw).toHaveBeenCalledTimes(2);
});
