import { describe, expect, it } from "vitest";
import { randomThemePrompt } from "./themePromptIdeas";

describe("randomThemePrompt", () => {
  it("combines a scene with an optional light and finish", () => {
    expect(randomThemePrompt("", () => 0)).toBe("midnight ocean, moonlight, full black");
    expect(randomThemePrompt("", () => 0.99).split(", ")).toHaveLength(1);
  });

  it("never repeats the current prompt", () => {
    const values = [0, 0, 0, 0, 0, 0, 0.5, 0.9, 0.9];
    let index = 0;
    const random = () => values[index++ % values.length]!;
    const current = "midnight ocean, moonlight, full black";
    expect(randomThemePrompt(current, random)).not.toBe(current);
  });

  it("offers many distinct prompts", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomThemePrompt()));
    expect(seen.size).toBeGreaterThan(100);
  });
});
