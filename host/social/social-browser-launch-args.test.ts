import { describe, expect, it } from "vitest";
import { launchArgs } from "./social-browser-launch";

describe("launchArgs", () => {
  it("starts a hidden browser without creating a desktop window", () => {
    const args = launchArgs("hidden");
    expect(args).toContain("--headless=new");
    expect(args.some((arg) => arg.startsWith("--window-position"))).toBe(false);
    expect(args).not.toContain("--no-startup-window");
    expect(args).not.toContain("--start-minimized");
    expect(args.some((arg) => arg.startsWith("--window-state"))).toBe(false);
  });

  it("adds no argument for a visible window", () => {
    expect(launchArgs("visible")).toEqual([]);
  });
});
