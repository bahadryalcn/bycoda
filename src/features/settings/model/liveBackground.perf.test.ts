// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_BACKGROUND_KEY, loadLiveBackground, saveLiveBackground } from "./liveBackground";

afterEach(() => localStorage.clear());

describe("live background default", () => {
  // perf P1: a fresh install must not default to an animated scene.
  it("is the static 'none' scene for a user who never chose one", () => {
    localStorage.clear();
    expect(loadLiveBackground()).toBe("none");
  });

  it("keeps the animated scene an earlier install has been seeing", async () => {
    localStorage.clear();
    localStorage.setItem("bycoda.onboarding.v1", "complete");
    vi.resetModules();
    const fresh = await import("./liveBackground");
    expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("gradient-ascii");
    expect(fresh.loadLiveBackground()).toBe("gradient-ascii");
  });

  it("still honours an explicit choice of an animated scene", () => {
    saveLiveBackground("code-rain");
    expect(loadLiveBackground()).toBe("code-rain");
  });
});
