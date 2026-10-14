// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpinnerTicker } from "./TerminalSpinner";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("createSpinnerTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a single interval for any number of subscribers and notifies all", () => {
    const spy = vi.spyOn(window, "setInterval");
    const t = createSpinnerTicker(10, 80);
    const a = vi.fn();
    const b = vi.fn();
    const offA = t.subscribe(a);
    const offB = t.subscribe(b);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(240);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
    expect(t.getSnapshot()).toBe(3);
    offA();
    offB();
    spy.mockRestore();
  });

  it("wraps frames and stops the timer at zero subscribers", () => {
    const t = createSpinnerTicker(3, 80);
    const off = t.subscribe(() => {});
    vi.advanceTimersByTime(240);
    expect(t.getSnapshot()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and resumes on visibilitychange", () => {
    const t = createSpinnerTicker(10, 80);
    const l = vi.fn();
    const off = t.subscribe(l);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(800);
    expect(l).not.toHaveBeenCalled();
    setHidden(false);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(80);
    expect(l).toHaveBeenCalledTimes(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a timer when subscribing while hidden", () => {
    setHidden(true);
    const t = createSpinnerTicker(10, 80);
    const off = t.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(0);
    off();
  });
});
