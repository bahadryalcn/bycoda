// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_BACKGROUND_CHANGE_EVENT,
  LIVE_BACKGROUND_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_KEY,
  LIVE_BACKGROUND_INTENSITY_MAX,
  LIVE_BACKGROUND_INTENSITY_MIN,
  LIVE_BACKGROUND_KEY,
  loadLiveBackground,
  loadLiveBackgroundIntensity,
  saveLiveBackground,
  saveLiveBackgroundIntensity,
  type LiveBackground,
} from "./liveBackground";

afterEach(() => localStorage.clear());

describe("live background preference", () => {
  it("defaults to no animation and rejects unknown stored values", () => {
    expect(LIVE_BACKGROUND_DEFAULT).toBe("none");
    expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
    localStorage.setItem(LIVE_BACKGROUND_KEY, "fireworks");
    expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
  });

  it("falls back to the default for removed scenes", () => {
    for (const removed of ["galaxy", "water", "aurora", "shape-waves", "ferrofluid"]) {
      localStorage.setItem(LIVE_BACKGROUND_KEY, removed);
      expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
    }
  });

  it.each(["none", "neural-tree", "latent-face", "thought-weaver", "ascii-mask"] as const)(
    "persists %s and notifies open panes once",
    (effect) => {
      const listener = vi.fn();
      window.addEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
      saveLiveBackground(effect);
      window.removeEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
      expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe(effect);
      expect(loadLiveBackground()).toBe(effect);
      expect(listener).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["gradient-ascii", "latent-face"],
    ["orb", "latent-face"],
    ["world-tree", "neural-tree"],
    ["code-rain", "thought-weaver"],
    ["micro-slats", "thought-weaver"],
    ["web-threads", "thought-weaver"],
    ["scanner", "thought-weaver"],
    ["lightfall", "thought-weaver"],
    ["prism", "thought-weaver"],
    ["side-rays", "thought-weaver"],
    ["light-rays", "thought-weaver"],
    ["pixel-blast", "thought-weaver"],
    ["dot-grid", "thought-weaver"],
    ["hyperspeed", "thought-weaver"],
    ["letter-glitch", "thought-weaver"],
  ] as const)("loads legacy %s as %s without rewriting saved preferences", (legacy, current) => {
    localStorage.setItem(LIVE_BACKGROUND_KEY, legacy);
    localStorage.setItem(LIVE_BACKGROUND_INTENSITY_KEY, "0.24");
    expect(loadLiveBackground()).toBe(current);
    expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe(legacy);
    expect(loadLiveBackgroundIntensity()).toBe(0.24);
    expect(localStorage.getItem(LIVE_BACKGROUND_INTENSITY_KEY)).toBe("0.24");
  });

  it("keeps an explicit no-animation preference after an earlier animated scene", () => {
    localStorage.setItem(LIVE_BACKGROUND_KEY, "world-tree");
    expect(loadLiveBackground()).toBe("neural-tree");
    saveLiveBackground("none");
    expect(loadLiveBackground()).toBe("none");
    expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("none");
  });

  it("does not allow retired or unknown scene IDs to be saved as new selections", () => {
    for (const value of ["scanner", "gradient-ascii", "unknown"]) {
      saveLiveBackground(value as LiveBackground);
      expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("none");
      expect(loadLiveBackground()).toBe("none");
    }
  });

  it("clamps intensity and falls back on malformed values", () => {
    expect(loadLiveBackgroundIntensity()).toBe(LIVE_BACKGROUND_INTENSITY_DEFAULT);
    saveLiveBackgroundIntensity(5);
    expect(loadLiveBackgroundIntensity()).toBe(LIVE_BACKGROUND_INTENSITY_MAX);
    localStorage.setItem(LIVE_BACKGROUND_INTENSITY_KEY, "-1");
    expect(loadLiveBackgroundIntensity()).toBe(LIVE_BACKGROUND_INTENSITY_MIN);
    localStorage.setItem(LIVE_BACKGROUND_INTENSITY_KEY, "bright");
    expect(loadLiveBackgroundIntensity()).toBe(LIVE_BACKGROUND_INTENSITY_DEFAULT);
  });
});
