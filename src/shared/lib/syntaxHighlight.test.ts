import { javascript } from "@codemirror/lang-javascript";
import { describe, expect, it } from "vitest";
import { highlightSource } from "./syntaxHighlight";

describe("highlightSource", () => {
  it("returns syntax colors without feature-module dependencies", () => {
    const lines = highlightSource('const answer = "yes";', javascript(), "dark");

    expect(lines[0]).toContainEqual({
      text: "const",
      color: "var(--syntax-keyword)",
    });
    expect(lines[0]).toContainEqual({
      text: '"yes"',
      color: "var(--syntax-string)",
    });
  });

  it("returns unstyled lines when language is unavailable", () => {
    expect(highlightSource("plain text\nnext", null, "light")).toEqual([
      [{ text: "plain text" }],
      [{ text: "next" }],
    ]);
  });
});
