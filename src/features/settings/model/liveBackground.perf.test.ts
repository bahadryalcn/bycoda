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

  it.each(["bycoda.onboarding.v1", "bycoda.recentProjects"])(
    "maps the earlier implicit default to Latent Face when %s exists",
    async (historyKey) => {
      localStorage.clear();
      localStorage.setItem(historyKey, "existing");
      vi.resetModules();
      const fresh = await import("./liveBackground");
      expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("gradient-ascii");
      expect(fresh.loadLiveBackground()).toBe("latent-face");
      expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("gradient-ascii");
    },
  );

  it("does not revive animation for an earlier install that explicitly chose none", async () => {
    localStorage.setItem("bycoda.onboarding.v1", "complete");
    localStorage.setItem(LIVE_BACKGROUND_KEY, "none");
    vi.resetModules();
    const fresh = await import("./liveBackground");
    expect(fresh.loadLiveBackground()).toBe("none");
    expect(localStorage.getItem(LIVE_BACKGROUND_KEY)).toBe("none");
  });

  it("still honours an explicit choice of an animated scene", () => {
    saveLiveBackground("thought-weaver");
    expect(loadLiveBackground()).toBe("thought-weaver");
  });
});
