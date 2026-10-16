import { describe, expect, it } from "vitest";
import { boundedTextPreview, userTextParts } from "./userTextPreview";

describe("user text previews", () => {
  it("recognizes objects and arrays without paste metadata", () => {
    for (const text of ['{"enabled":true}', "[1,2,3]"]) {
      expect(userTextParts(text)).toEqual([{ text, kind: "json", compact: true }]);
    }
    for (const text of ["{invalid}", "[image1]", "true", "Short message"]) {
      expect(userTextParts(text)[0].compact).toBe(false);
    }
  });
  it("keeps explanations and multiple fenced JSON blocks in source order", () => {
    const text = 'Please check:\r\n```json\r\n{"a":1}\r\n```\r\nAnd:\n```\n[2,3]\n```\nThanks';
    const parts = userTextParts(text);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.compact).map((part) => part.kind)).toEqual(["json", "json"]);
    expect(parts[0].compact).toBe(false);
    expect(parts.at(-1)?.text).toBe("\nThanks");
  });
  it("collapses long text and bounds even a single very long line", () => {
    const text = "x".repeat(10000);
    expect(userTextParts(text)[0].compact).toBe(true);
    expect(boundedTextPreview(text).length).toBeLessThan(1210);
    expect(boundedTextPreview("line\n".repeat(100)).split("\n")).toHaveLength(17);
    expect(boundedTextPreview("short")).toBe("short");
  });
});
