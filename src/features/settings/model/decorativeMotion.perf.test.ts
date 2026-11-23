// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  DECORATIVE_MOTION_KEY,
  decorativeMotionEnabled,
  saveDecorativeMotionEnabled,
  subscribeDecorativeMotion,
  useDecorativeMotionEnabled,
} from "./decorativeMotion";

let hidden = false;
beforeEach(() => {
  hidden = false;
  localStorage.clear();
  saveDecorativeMotionEnabled(true);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("decorative motion gate (loops depend on it to stop)", () => {
  it("shares saved preferences across repeated renders of visible indicators", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const get = vi.spyOn(localStorage, "getItem");
    const container = document.createElement("div");
    const root = createRoot(container);
    function Indicator() {
      return String(useDecorativeMotionEnabled());
    }
    const draw = () =>
      act(() =>
        root.render(Array.from({ length: 5 }, (_, key) => createElement(Indicator, { key }))),
      );
    try {
      draw();
      get.mockClear();
      draw();
      expect(get.mock.calls.filter(([key]) => key.includes("Motion.v1"))).toHaveLength(0);
      act(() => {
        localStorage.setItem(DECORATIVE_MOTION_KEY, "0");
        window.dispatchEvent(new StorageEvent("storage", { key: DECORATIVE_MOTION_KEY }));
      });
      expect(container.textContent).toBe("false".repeat(5));
      act(() => {
        localStorage.clear();
        window.dispatchEvent(new StorageEvent("storage", { key: null }));
      });
      expect(container.textContent).toBe("true".repeat(5));
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("turns off when the document is hidden and tells subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDecorativeMotion(listener);
    expect(decorativeMotionEnabled()).toBe(true);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalled();
    expect(decorativeMotionEnabled()).toBe(false);
    hidden = false;
    listener.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalled();
    expect(decorativeMotionEnabled()).toBe(true);
    unsubscribe();
  });

  it("stops notifying and drops its window listeners after the last unsubscribe", () => {
    const listener = vi.fn();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const unsubscribe = subscribeDecorativeMotion(listener);
    unsubscribe();
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
  });
});
