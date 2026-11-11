// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginResizeGesture,
  deferDuringResize,
  onResizeGestureEnd,
  resizeGestureActive,
} from "./resizeGesture";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("resize gesture", () => {
  it("stays live until every holder has ended and notifies once", () => {
    const ended = vi.fn();
    const off = onResizeGestureEnd(ended);
    const endFirst = beginResizeGesture();
    const endSecond = beginResizeGesture();
    expect(resizeGestureActive()).toBe(true);

    endFirst();
    endFirst();
    expect(resizeGestureActive()).toBe(true);
    expect(ended).not.toHaveBeenCalled();

    endSecond();
    expect(resizeGestureActive()).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });

  it("shows the drag cursor on one shield element and leaves <html> untouched", () => {
    const before = document.documentElement.className;
    const end = beginResizeGesture("col-resize");
    const shield = document.querySelector<HTMLElement>("[data-resize-shield]");
    expect(shield?.style.cursor).toBe("col-resize");
    expect(document.documentElement.className).toBe(before);
    expect(document.body.style.cursor).toBe("");

    end();
    expect(document.querySelector("[data-resize-shield]")).toBeNull();
  });

  it("runs deferred work at once when idle and once at the end of a live resize", () => {
    const run = vi.fn();
    const work = deferDuringResize(run);
    work();
    expect(run).toHaveBeenCalledTimes(1);

    const end = beginResizeGesture();
    work();
    work();
    work();
    expect(run).toHaveBeenCalledTimes(1);
    end();
    expect(run).toHaveBeenCalledTimes(2);

    // Nothing stays subscribed after the flush.
    beginResizeGesture()();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops cancelled work", () => {
    const run = vi.fn();
    const work = deferDuringResize(run);
    const end = beginResizeGesture();
    work();
    work.cancel();
    end();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps notifying the other listeners when one throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const offBad = onResizeGestureEnd(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const offGood = onResizeGestureEnd(good);
    beginResizeGesture()();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
    error.mockRestore();
  });

  it("treats a burst of window resize events as one gesture", () => {
    vi.useFakeTimers();
    const ended = vi.fn();
    const off = onResizeGestureEnd(ended);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(100);
    expect(resizeGestureActive()).toBe(true);
    expect(ended).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(resizeGestureActive()).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
    off();
  });
});
