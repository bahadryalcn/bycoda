// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decorativeMotionEnabled,
  saveDecorativeMotionEnabled,
  subscribeDecorativeMotion,
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
