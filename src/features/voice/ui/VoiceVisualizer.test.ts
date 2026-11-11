// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceVisualizer } from "./VoiceVisualizer";
import type { VoiceVisualState } from "../model/voiceVisualState";
import type { VoiceVisual } from "../model/voiceSettings";
import { saveDecorativeMotionEnabled } from "../../settings/model/decorativeMotion";

let root: Root;
let container: HTMLDivElement;
let observerCallback: (entries: { isIntersecting: boolean }[]) => void;
let frameCallback: FrameRequestCallback;
let mediaCallback: () => void;
let reduced = false;
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  frameCallback = callback;
  return 42;
});
const cancelFrame = vi.fn();
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) => {
      mediaCallback = callback;
    },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof observerCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(
  state: VoiceVisualState,
  visual: VoiceVisual = "mark",
  level = { current: 0 },
) {
  await act(async () => root.render(createElement(VoiceVisualizer, { state, visual, level })));
}
it("stops frame work for static states, offscreen surfaces and reduced motion", async () => {
  await render("off");
  expect(requestFrame).not.toHaveBeenCalled();
  await render("listening");
  expect(requestFrame).toHaveBeenCalledTimes(1);
  observerCallback([{ isIntersecting: false }]);
  expect(cancelFrame).toHaveBeenCalledWith(42);
  expect(container.firstElementChild?.getAttribute("data-animating")).toBe("false");
  observerCallback([{ isIntersecting: true }]);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  reduced = true;
  mediaCallback();
  expect(container.firstElementChild?.getAttribute("data-animating")).toBe("false");
  expect(cancelFrame).toHaveBeenCalledTimes(2);
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
});
it("reads microphone levels directly without rerendering", async () => {
  const level = { current: 0 };
  await render("user", "dots", level);
  frameCallback(1500);
  const bar = container.querySelector("[data-bar]")!;
  const quiet = Number(bar.getAttribute("height"));
  level.current = 1;
  frameCallback(1500);
  expect(Number(bar.getAttribute("height"))).toBeGreaterThan(quiet);
});
it("leaves different still geometry for user and assistant speech", async () => {
  reduced = true;
  for (const visual of ["mark", "wave", "dots", "orb"] as const) {
    await render("user", visual);
    const user = container.querySelector("svg")!.innerHTML;
    await render("assistant", visual);
    expect(container.querySelector("svg")!.innerHTML, visual).not.toBe(user);
  }
  expect(requestFrame).not.toHaveBeenCalled();
});

it("reacts to microphone RMS while listening in cloud mode and stays still in silence", async () => {
  const level = { current: 0 };
  await render("listening", "dots", level);
  frameCallback(1500);
  const bar = container.querySelector("[data-bar]")!;
  const quiet = bar.getAttribute("height");
  frameCallback(2500);
  expect(bar.getAttribute("height")).toBe(quiet);
  level.current = 0.7;
  frameCallback(2500);
  expect(Number(bar.getAttribute("height"))).toBeGreaterThan(Number(quiet));
  expect(container.firstElementChild?.getAttribute("data-hearing")).toBe("true");
  await render("muted", "dots", level);
  expect(container.firstElementChild?.getAttribute("data-hearing")).toBe("false");
});
it("keeps reduced-motion input feedback reactive without animation frames", async () => {
  vi.useFakeTimers();
  reduced = true;
  const level = { current: 0 };
  await render("listening", "dots", level);
  const bar = container.querySelector("[data-bar]")!;
  const quiet = Number(bar.getAttribute("height"));
  level.current = 0.8;
  await act(async () => vi.advanceTimersByTime(120));
  expect(Number(bar.getAttribute("height"))).toBeGreaterThan(quiet);
  expect(requestFrame).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it("stays still when decorative motion is off and paints at most every 33 ms otherwise", async () => {
  try {
    saveDecorativeMotionEnabled(false);
    await render("listening");
    expect(requestFrame).not.toHaveBeenCalled();
    expect(container.firstElementChild?.getAttribute("data-animating")).toBe("false");
  } finally {
    saveDecorativeMotionEnabled(true);
  }
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  await render("assistant", "dots");
  expect(requestFrame).toHaveBeenCalledTimes(1);
  const bar = container.querySelector("[data-bar]")!;
  frameCallback(1000);
  const first = bar.getAttribute("height");
  frameCallback(1010);
  expect(bar.getAttribute("height")).toBe(first);
  frameCallback(1200);
  expect(bar.getAttribute("height")).not.toBe(first);
  expect(requestFrame).toHaveBeenCalledTimes(4);
});

it("steps connecting progress without decorative motion or animation frames", async () => {
  vi.useFakeTimers();
  try {
    saveDecorativeMotionEnabled(false);
    await render("connecting", "dots");
    expect(requestFrame).not.toHaveBeenCalled();
    const lit = () =>
      [...container.querySelectorAll<SVGRectElement>("[data-bar]")].findIndex(
        (bar) => bar.style.opacity === "1",
      );
    expect(lit()).toBe(0);
    await act(async () => vi.advanceTimersByTime(400));
    expect(lit()).toBe(1);
    await render("listening", "dots");
    await act(async () => vi.advanceTimersByTime(800));
    expect(lit()).toBe(0);
  } finally {
    saveDecorativeMotionEnabled(true);
    vi.useRealTimers();
  }
});

it("gives each visual its own loading motion instead of a shared spinner", async () => {
  for (const visual of ["mark", "wave", "dots", "orb"] as const) {
    await render("connecting", visual);
    expect(container.querySelector("[data-arc]"), visual).toBeNull();
  }
  await render("connecting", "wave");
  const sweep = container.querySelector("[data-sweep]")!;
  frameCallback(0);
  const start = sweep.getAttribute("transform");
  frameCallback(600);
  expect(sweep.getAttribute("transform")).not.toBe(start);

  await render("connecting", "orb");
  const core = container.querySelector<SVGCircleElement>("[data-core]")!;
  frameCallback(0);
  const radius = core.getAttribute("r");
  frameCallback(700);
  expect(core.getAttribute("r")).not.toBe(radius);

  await render("thinking", "dots");
  const bar = container.querySelector("[data-bar]")!;
  frameCallback(280);
  expect(Number(bar.getAttribute("y"))).toBeLessThan(35);
});

it("steps the wave sweep and orb breath without decorative motion", async () => {
  vi.useFakeTimers();
  try {
    saveDecorativeMotionEnabled(false);
    await render("connecting", "wave");
    const sweep = container.querySelector("[data-sweep]")!;
    const first = sweep.getAttribute("transform");
    await act(async () => vi.advanceTimersByTime(400));
    expect(sweep.getAttribute("transform")).not.toBe(first);
    await render("connecting", "orb");
    const core = container.querySelector("[data-core]")!;
    const small = core.getAttribute("r");
    await act(async () => vi.advanceTimersByTime(400));
    expect(core.getAttribute("r")).not.toBe(small);
    expect(requestFrame).not.toHaveBeenCalled();
  } finally {
    saveDecorativeMotionEnabled(true);
    vi.useRealTimers();
  }
});
