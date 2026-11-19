// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "../../../../shared/i18n/format";
import { ActiveElapsed } from "./ActiveElapsed";

let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hidden = false;
});

function mount(startedAt: number | undefined) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(ActiveElapsed, { startedAt })));
  return { host, root };
}

describe("ActiveElapsed", () => {
  it("shows the running duration and re-renders only its label each second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { host, root } = mount(95_000);
    expect(host.textContent).toBe(formatDuration(5_000));
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe(formatDuration(6_000));
    act(() => root.unmount());
  });

  it("subscribes to no timer when there is no start time", () => {
    vi.useFakeTimers();
    const { host, root } = mount(undefined);
    expect(host.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    act(() => root.unmount());
  });

  it("stops ticking while hidden and catches up on the first visible moment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { host, root } = mount(95_000);
    act(() => setHidden(true));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(160_000);
    act(() => vi.advanceTimersByTime(5000));
    expect(host.textContent).toBe(formatDuration(5_000));
    act(() => setHidden(false));
    // The clock was set to 160 s, then advanced 5 s: 165 s since start 95 s is 70 s.
    expect(host.textContent).toBe(formatDuration(70_000));
    act(() => root.unmount());
  });

  it("releases its timer when the last labelled row unmounts", () => {
    vi.useFakeTimers();
    const { root } = mount(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
