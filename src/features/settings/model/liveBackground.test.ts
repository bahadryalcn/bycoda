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
} from "./liveBackground";

afterEach(() => localStorage.clear());

describe("live background preference", () => {
  it("defaults to the gradient ASCII scene and rejects unknown stored values", () => {
    expect(LIVE_BACKGROUND_DEFAULT).toBe("gradient-ascii");
    expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
    localStorage.setItem(LIVE_BACKGROUND_KEY, "fireworks");
    expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
  });

  it("falls back to the default for removed scenes", () => {
    for (const removed of ["galaxy", "water", "aurora"]) {
      localStorage.setItem(LIVE_BACKGROUND_KEY, removed);
      expect(loadLiveBackground()).toBe(LIVE_BACKGROUND_DEFAULT);
    }
  });

  it("persists the scene and notifies open panes", () => {
    const listener = vi.fn();
    window.addEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
    saveLiveBackground("shape-waves");
    window.removeEventListener(LIVE_BACKGROUND_CHANGE_EVENT, listener);
    expect(loadLiveBackground()).toBe("shape-waves");
    expect(listener).toHaveBeenCalledTimes(1);
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
