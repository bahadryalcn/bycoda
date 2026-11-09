import { describe, expect, it } from "vitest";
import { titleFromPrompt } from "./session";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("titleFromPrompt", () => {
  it("cuts a long first line at a grapheme boundary instead of inside an emoji", () => {
    // Code units 0-70 end on the first emoji's high surrogate, so a UTF-16 cut would split it.
    const title = titleFromPrompt(`${"a".repeat(70)}🚀🚀b`, "codex");
    expect(title).toBe(`codex · ${"a".repeat(70)}🚀…`);
    expect(title).not.toMatch(LONE_SURROGATE);
  });

  it("keeps short titles intact", () => {
    expect(titleFromPrompt("Fix the 🚀 launch", "codex")).toBe("codex · Fix the 🚀 launch");
  });
});
