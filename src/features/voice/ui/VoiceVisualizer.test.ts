// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceVisualizer } from "./VoiceVisualizer";
import type { VoiceVisualState } from "../model/voiceVisualState";
import type { VoiceVisual } from "../model/voiceSettings";

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
