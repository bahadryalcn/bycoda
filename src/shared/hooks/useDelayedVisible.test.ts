// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS, LOADING_MIN_VISIBLE_MS, useDelayedVisible } from "./useDelayedVisible";

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let visible = false;
  function Probe({ active }: { active: boolean }) {
    visible = useDelayedVisible(active);
    return null;
  }
  const render = (active: boolean) => act(() => root.render(createElement(Probe, { active })));
  return { render, visible: () => visible, root };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("never shows a loader for work that finishes inside the delay", () => {
  const probe = setup();
  probe.render(true);
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS - 1));
  expect(probe.visible()).toBe(false);
  probe.render(false);
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS * 2));
  expect(probe.visible()).toBe(false);
  act(() => probe.root.unmount());
});

it("shows after the delay and holds for the minimum visible time", () => {
  const probe = setup();
  probe.render(true);
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS));
  expect(probe.visible()).toBe(true);
  act(() => vi.advanceTimersByTime(100));
  probe.render(false);
  expect(probe.visible()).toBe(true);
  act(() => vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS - 101));
  expect(probe.visible()).toBe(true);
  act(() => vi.advanceTimersByTime(2));
  expect(probe.visible()).toBe(false);
  act(() => probe.root.unmount());
});

it("hides at once when the loader already outlasted the minimum", () => {
  const probe = setup();
  probe.render(true);
  act(() => vi.advanceTimersByTime(LOADING_DELAY_MS + LOADING_MIN_VISIBLE_MS + 50));
  probe.render(false);
  act(() => vi.advanceTimersByTime(0));
  expect(probe.visible()).toBe(false);
  act(() => probe.root.unmount());
});
