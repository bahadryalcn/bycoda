// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveBackgroundCanvas } from "./LiveBackgroundCanvas";

const state = vi.hoisted(() => ({
  enabled: true,
  focused: true,
  listeners: new Set<() => void>(),
  draw: vi.fn(),
  dispose: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../model/decorativeMotion", () => ({
  decorativeMotionEnabled: () => state.enabled,
  windowHasFocus: () => state.focused,
  subscribeDecorativeMotion: (fn: () => void) => {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },
}));
vi.mock("./live-background/reactBitsSurface", () => ({
  createReactBitsSurface: () => {
    state.create();
    return { resize: vi.fn(), draw: state.draw, dispose: state.dispose };
  },
}));
let root: Root, host: HTMLDivElement;
let queue: Map<number, FrameRequestCallback>, next: number, now: number, executed: number;
const run = (ms: number, hz = 60) => {
  for (const end = now + ms; now < end;) {
    now += 1000 / hz;
    vi.advanceTimersByTime(1000 / hz);
    const callbacks = [...queue.values()];
    queue.clear();
    executed += callbacks.length;
    act(() => callbacks.forEach((fn) => fn(now)));
  }
};
const render = (speech = -1, activity = speech, active = true) =>
  act(() =>
    root.render(
      createElement(LiveBackgroundCanvas, {
        effect: "threads",
        intensity: 0.35,
        speech,
        activity,
        active,
      }),
    ),
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.enabled = state.focused = true;
  state.listeners.clear();
  vi.clearAllMocks();
  queue = new Map();
  next = 0;
  now = 1000;
  executed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    queue.set(++next, fn);
    return next;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1200,
    height: 800,
  } as DOMRect);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps a slow ambient rhythm after settling and increases cadence during replies", () => {
  render();
  run(4000);
  state.draw.mockClear();
  run(2000);
  expect(state.draw.mock.calls.length).toBeGreaterThanOrEqual(18);
  expect(state.draw.mock.calls.length).toBeLessThanOrEqual(25);
  render(20);
  state.draw.mockClear();
  run(1000);
  expect(state.draw.mock.calls.length).toBeGreaterThan(20);
  expect(state.draw.mock.calls.length).toBeLessThanOrEqual(31);
});

it.each([60, 144, 240])("only wakes for ambient draws on a %s Hz display", (hz) => {
  render();
  run(4000, hz);
  state.draw.mockClear();
  const before = executed;
  run(2000, hz);
  expect(state.draw.mock.calls.length).toBeGreaterThanOrEqual(20);
  expect(state.draw.mock.calls.length).toBeLessThanOrEqual(25);
  expect(executed - before).toBe(state.draw.mock.calls.length);
  expect(executed - before).toBeLessThanOrEqual(25);
});

it("freezes ambient work on blur or reduced motion and resumes without reallocating", () => {
  render();
  run(500);
  state.draw.mockClear();
  state.focused = false;
  act(() => state.listeners.forEach((fn) => fn()));
  run(1000);
  expect(state.draw).not.toHaveBeenCalled();
  expect(queue.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  state.focused = true;
  act(() => state.listeners.forEach((fn) => fn()));
  run(500);
  expect(state.draw).toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledOnce();
  state.draw.mockClear();
  state.enabled = false;
  act(() => state.listeners.forEach((fn) => fn()));
  run(1000);
  expect(state.draw).not.toHaveBeenCalled();
  expect(queue.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("suspends on GPU context loss and recreates resources on restoration", () => {
  render();
  run(500);
  state.draw.mockClear();
  act(() =>
    host
      .querySelector("canvas")!
      .dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
  );
  run(1000);
  expect(state.draw).not.toHaveBeenCalled();
  expect(queue.size).toBe(0);
  act(() => host.querySelector("canvas")!.dispatchEvent(new Event("webglcontextrestored")));
  run(500);
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.dispose).toHaveBeenCalledOnce();
  expect(state.draw).toHaveBeenCalled();
});

it("passes new streamed text as motion energy without recreating the renderer", () => {
  render(0);
  run(2000);
  const waiting = state.draw.mock.calls.at(-1)![2];
  for (let chunk = 1; chunk <= 12; chunk++) {
    render(chunk * 9);
    run(100);
  }
  const speaking = state.draw.mock.calls.at(-1)![2];
  expect(speaking.presence).toBe(1);
  expect(speaking.energy).toBeGreaterThan((waiting.energy ?? 0) + 0.1);
  expect(state.create).toHaveBeenCalledOnce();
  render(-1);
  run(2200);
  expect(state.draw.mock.calls.at(-1)![2]).toEqual({ presence: 0 });
});

it("eases unchanged busy work to rest and wakes for speech even when activity is unchanged", () => {
  render(20, 100);
  run(1000);
  const speaking = state.draw.mock.calls.at(-1)![2];
  expect(speaking.presence).toBe(1);
  run(4000);
  expect(state.draw.mock.calls.at(-1)![2]).toEqual({ presence: 0 });
  render(30, 100);
  run(500);
  expect(state.draw.mock.calls.at(-1)![2].presence).toBeGreaterThan(0.8);
  expect(state.draw.mock.calls.at(-1)![2].energy).toBeGreaterThan(0);
  expect(state.create).toHaveBeenCalledOnce();
});

it.each(["timer", "frame"])(
  "cancels both pending mechanisms on every gate during %s wait",
  (phase) => {
    render();
    if (phase === "timer") run(100);
    const paints = state.draw.mock.calls.length;
    render(-1, -1, false);
    expect(queue.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    run(1000);
    expect(state.draw).toHaveBeenCalledTimes(paints);
    render();
    if (phase === "timer") run(100);
    state.focused = false;
    act(() => state.listeners.forEach((fn) => fn()));
    expect(queue.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    state.focused = true;
    act(() => state.listeners.forEach((fn) => fn()));
    if (phase === "timer") run(100);
    state.enabled = false;
    act(() => state.listeners.forEach((fn) => fn()));
    expect(queue.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("does no late work after unmounting while a draw timer is pending", () => {
  render();
  run(100);
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.unmount());
  const paints = state.draw.mock.calls.length;
  run(1000);
  expect(state.draw).toHaveBeenCalledTimes(paints);
  expect(state.dispose).toHaveBeenCalledOnce();
  expect(state.listeners.size).toBe(0);
  expect(queue.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
