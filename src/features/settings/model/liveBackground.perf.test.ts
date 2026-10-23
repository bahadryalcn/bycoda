// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_BACKGROUND_KEY, loadLiveBackground, saveLiveBackground } from "./liveBackground";

afterEach(() => localStorage.clear());

describe("live background default", () => {
  // perf P1: a fresh install must not default to an animated scene; remove .fails when fixed.
  it.fails("is the static 'none' scene for a user who never chose one", () => {
    localStorage.clear();
    expect(loadLiveBackground()).toBe("none");
  });

  it("still honours an explicit choice of an animated scene", () => {
    saveLiveBackground("code-rain");
    expect(loadLiveBackground()).toBe("code-rain");
  });
});
