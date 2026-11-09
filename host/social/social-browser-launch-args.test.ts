import { describe, expect, it } from "vitest";
import { launchArgs } from "./social-browser-launch";

describe("launchArgs", () => {
  it("keeps a hidden window off every display and never minimized", () => {
    const args = launchArgs("hidden");
    expect(args).toContain("--window-position=-32000,-32000");
    expect(args).not.toContain("--start-minimized");
    expect(args.some((arg) => arg.startsWith("--window-state"))).toBe(false);
  });

  it("adds no argument for a visible window", () => {
    expect(launchArgs("visible")).toEqual([]);
  });
});
