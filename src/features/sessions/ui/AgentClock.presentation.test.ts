// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePresentationNow } from "./AgentClock";

let container: HTMLDivElement;
let root: Root;
let hidden = false;
let renders = 0;
let last = 0;

function Probe() {
  renders += 1;
  last = usePresentationNow(true);
  return null;
}

function setHidden(next: boolean) {
  hidden = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  hidden = false;
  renders = 0;
  last = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("ticks once a second while the document is visible", () => {
  const start = Date.now();
  act(() => {
    vi.advanceTimersByTime(3_000);
  });
  expect(last).toBe(start + 3_000);
  expect(vi.getTimerCount()).toBe(1);
});

it("schedules no timer and no renders while the document is hidden", () => {
  setHidden(true);
  expect(vi.getTimerCount()).toBe(0);
  const rendersWhileHidden = renders;
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(renders).toBe(rendersWhileHidden);
});

it("resumes ticking when the document becomes visible again", () => {
  setHidden(true);
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  setHidden(false);
  const resumed = Date.now();
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(vi.getTimerCount()).toBe(1);
  expect(last).toBe(resumed + 2_000);
});
