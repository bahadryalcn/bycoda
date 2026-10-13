// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import {
  DECORATIVE_MOTION_CHANGE_EVENT,
  DECORATIVE_MOTION_KEY,
  decorativeMotionEnabled,
  loadDecorativeMotionEnabled,
  saveDecorativeMotionEnabled,
  subscribeDecorativeMotion,
} from "./decorativeMotion";

let reduced = false;
let mediaListeners: Set<() => void>;
let addMedia: ReturnType<typeof vi.fn>;
let removeMedia: ReturnType<typeof vi.fn>;
const subscriptions: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal("localStorage", new Storage());
  localStorage.clear();
  reduced = false;
  mediaListeners = new Set();
  addMedia = vi.fn((_event: string, listener: () => void) => mediaListeners.add(listener));
  removeMedia = vi.fn((_event: string, listener: () => void) => mediaListeners.delete(listener));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: addMedia,
      removeEventListener: removeMedia,
    })),
  );
  // Clear an in-memory fallback left by any storage failure test.
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
});

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  saveDecorativeMotionEnabled(true);
  localStorage.clear();
});

function subscribe(listener = vi.fn()) {
  const unsubscribe = subscribeDecorativeMotion(listener);
  subscriptions.push(unsubscribe);
  return { listener, unsubscribe };
}

describe("decorative motion", () => {
  it("preserves existing motion by default and broadcasts the stored choice", () => {
    const { listener } = subscribe();
    expect(decorativeMotionEnabled()).toBe(true);
    saveDecorativeMotionEnabled(false);
    expect(localStorage.getItem(DECORATIVE_MOTION_KEY)).toBe("0");
    expect(decorativeMotionEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the local choice usable when storage cannot save", () => {
    subscribe();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveDecorativeMotionEnabled(false);
    expect(loadDecorativeMotionEnabled()).toBe(false);
    expect(decorativeMotionEnabled()).toBe(false);
  });

  it("follows other windows, settings events and storage reset", () => {
    const { listener } = subscribe();
    localStorage.setItem(DECORATIVE_MOTION_KEY, "0");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: DECORATIVE_MOTION_KEY }));
    expect(decorativeMotionEnabled()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem(DECORATIVE_MOTION_KEY, "1");
    window.dispatchEvent(new CustomEvent(DECORATIVE_MOTION_CHANGE_EVENT));
    expect(decorativeMotionEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(decorativeMotionEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("honors live system changes without overwriting the user's choice", () => {
    const { listener } = subscribe();
    reduced = true;
    for (const notify of mediaListeners) notify();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(decorativeMotionEnabled()).toBe(false);
    expect(loadDecorativeMotionEnabled()).toBe(true);
    reduced = false;
    for (const notify of mediaListeners) notify();
    expect(decorativeMotionEnabled()).toBe(true);
    saveDecorativeMotionEnabled(false);
    reduced = true;
    for (const notify of mediaListeners) notify();
    reduced = false;
    for (const notify of mediaListeners) notify();
    expect(decorativeMotionEnabled()).toBe(false);
  });

  it("shares system listeners and detaches them after the last consumer", () => {
    const first = subscribe();
    const second = subscribe();
    expect(addMedia).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    expect(removeMedia).not.toHaveBeenCalled();
    second.unsubscribe();
    expect(removeMedia).toHaveBeenCalledTimes(1);
    saveDecorativeMotionEnabled(false);
    expect(first.listener).not.toHaveBeenCalled();
    expect(second.listener).not.toHaveBeenCalled();
  });
});
