// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Storage } from "happy-dom";
import {
  DECORATIVE_MOTION_CHANGE_EVENT,
  DECORATIVE_MOTION_KEY,
  applyThemeDecorativeMotion,
  decorativeMotionEnabled,
  audioFeedbackMotionEnabled,
  loadDecorativeMotionEnabled,
  noteDisplayRefreshRate,
  loadFollowSystemMotionEnabled,
  prefersReducedMotion,
  saveDecorativeMotionEnabled,
  saveFollowSystemMotionEnabled,
  subscribeDecorativeMotion,
  windowHasFocus,
} from "./decorativeMotion";

let reduced = false;
let mediaListeners: Set<() => void>;
let addMedia: ReturnType<typeof vi.fn>;
let removeMedia: ReturnType<typeof vi.fn>;
const subscriptions: (() => void)[] = [];

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
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
  it("keeps visible motion running when another application takes focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    expect(decorativeMotionEnabled()).toBe(true);
    subscribe();
    window.dispatchEvent(new Event("blur"));
    expect(document.hidden).toBe(false);
    expect(decorativeMotionEnabled()).toBe(true);
    expect(document.documentElement.dataset.decorativeMotion).toBe("on");
    expect(loadDecorativeMotionEnabled()).toBe(true);
    window.dispatchEvent(new Event("focus"));
    expect(decorativeMotionEnabled()).toBe(true);
  });

  it("follows DOM focus and blur for the window focus gate outside Tauri", () => {
    const { listener } = subscribe();
    expect(windowHasFocus()).toBe(true);
    expect(document.documentElement.dataset.windowFocus).toBe("on");
    window.dispatchEvent(new Event("blur"));
    expect(windowHasFocus()).toBe(false);
    expect(document.documentElement.dataset.windowFocus).toBe("off");
    expect(listener).toHaveBeenCalledTimes(1);
    // Decorative CSS motion itself keeps its existing rules while unfocused.
    expect(decorativeMotionEnabled()).toBe(true);
    window.dispatchEvent(new Event("focus"));
    expect(windowHasFocus()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("wakes subscribers only when the exposed state changes", () => {
    const { listener } = subscribe();
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    }
    for (const notify of mediaListeners) notify();
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("requires visibility without changing the saved choice", () => {
    const hidden = vi.spyOn(document, "hidden", "get");
    subscribe();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(decorativeMotionEnabled()).toBe(false);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(decorativeMotionEnabled()).toBe(true);
    saveDecorativeMotionEnabled(false);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(decorativeMotionEnabled()).toBe(false);
  });
  it("updates CSS consumers before a React consumer subscribes", () => {
    saveDecorativeMotionEnabled(false);
    expect(document.documentElement.dataset.decorativeMotion).toBe("off");
    saveDecorativeMotionEnabled(true);
    expect(document.documentElement.dataset.decorativeMotion).toBe("on");
  });

  it("preserves existing motion by default and broadcasts the stored choice", () => {
    const { listener } = subscribe();
    expect(decorativeMotionEnabled()).toBe(true);
    expect(document.documentElement.dataset.decorativeMotion).toBe("on");
    saveDecorativeMotionEnabled(false);
    expect(localStorage.getItem(DECORATIVE_MOTION_KEY)).toBe("0");
    expect(decorativeMotionEnabled()).toBe(false);
    expect(document.documentElement.dataset.decorativeMotion).toBe("off");
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
    localStorage.setItem(DECORATIVE_MOTION_KEY, "0");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(3);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(decorativeMotionEnabled()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("honors live system changes without overwriting the user's choice", () => {
    const { listener } = subscribe();
    reduced = true;
    for (const notify of mediaListeners) notify();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(decorativeMotionEnabled()).toBe(false);
    expect(document.documentElement.dataset.decorativeMotion).toBe("off");
    expect(loadDecorativeMotionEnabled()).toBe(true);
    reduced = false;
    for (const notify of mediaListeners) notify();
    expect(decorativeMotionEnabled()).toBe(true);
    expect(document.documentElement.dataset.decorativeMotion).toBe("on");
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

it("ignores the system reduce-motion request only while Follow system setting is off", () => {
  reduced = true;
  expect(decorativeMotionEnabled()).toBe(false);
  saveFollowSystemMotionEnabled(false);
  expect(loadFollowSystemMotionEnabled()).toBe(false);
  expect(prefersReducedMotion()).toBe(false);
  expect(decorativeMotionEnabled()).toBe(true);
  saveFollowSystemMotionEnabled(true);
  expect(decorativeMotionEnabled()).toBe(false);
});

describe("high refresh displays", () => {
  afterEach(() => noteDisplayRefreshRate(null));

  it("keeps capped audio feedback live while honoring explicit, system and visibility choices", () => {
    const { listener } = subscribe();
    noteDisplayRefreshRate(240);
    expect(decorativeMotionEnabled()).toBe(false);
    expect(audioFeedbackMotionEnabled()).toBe(true);
    listener.mockClear();
    saveDecorativeMotionEnabled(false);
    expect(audioFeedbackMotionEnabled()).toBe(false);
    expect(listener).toHaveBeenCalled();
    saveDecorativeMotionEnabled(true);
    reduced = true;
    expect(audioFeedbackMotionEnabled()).toBe(false);
    reduced = false;
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    expect(audioFeedbackMotionEnabled()).toBe(false);
  });

  it("turns decorative motion off by default at 120 Hz and above unless the user chose it", () => {
    const { listener } = subscribe();
    expect(loadDecorativeMotionEnabled()).toBe(true);
    noteDisplayRefreshRate(239.9);
    expect(loadDecorativeMotionEnabled()).toBe(false);
    expect(document.documentElement.dataset.decorativeMotion).toBe("off");
    expect(listener).toHaveBeenCalled();
    saveDecorativeMotionEnabled(true);
    expect(loadDecorativeMotionEnabled()).toBe(true);
    expect(document.documentElement.dataset.decorativeMotion).toBe("on");
  });

  it("lets a theme turn motion off anywhere but on only where the display default allows", () => {
    noteDisplayRefreshRate(239.9);
    applyThemeDecorativeMotion(true);
    expect(loadDecorativeMotionEnabled()).toBe(false);
    expect(localStorage.getItem(DECORATIVE_MOTION_KEY)).toBeNull();
    saveDecorativeMotionEnabled(true);
    applyThemeDecorativeMotion(false);
    expect(loadDecorativeMotionEnabled()).toBe(false);
    noteDisplayRefreshRate(60);
    applyThemeDecorativeMotion(true);
    expect(loadDecorativeMotionEnabled()).toBe(true);
  });

  it("keeps the product default on ordinary displays", () => {
    noteDisplayRefreshRate(60);
    expect(loadDecorativeMotionEnabled()).toBe(true);
    noteDisplayRefreshRate(119);
    expect(loadDecorativeMotionEnabled()).toBe(true);
  });
});
