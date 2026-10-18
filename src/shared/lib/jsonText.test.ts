import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./jsonText";

describe("parseJsonObject", () => {
  it("finds Git text after an unmatched preamble brace", () => {
    expect(
      parseJsonObject('A literal opening brace { can appear in code.\n{"title":"Fix search"}'),
    ).toEqual({ title: "Fix search" });
  });

  it("recovers from preamble quotes and multiple unmatched braces", () => {
    expect(parseJsonObject('Example { "unfinished {\n{"branch":"fix/search"}')).toEqual({
      branch: "fix/search",
    });
  });

  it("preserves nested objects and braces inside JSON strings", () => {
    expect(parseJsonObject('{"title":"Fix {search}","details":{"count":1}}')).toEqual({
      title: "Fix {search}",
      details: { count: 1 },
    });
  });

  it("prefers Git text over an earlier valid fallback object", () => {
    expect(parseJsonObject('{"count":1}\n{"subject":"Fix search"}')).toEqual({
      subject: "Fix search",
    });
    expect(parseJsonObject('{"count":1}')).toEqual({ count: 1 });
  });

  it("returns null when no complete JSON object exists", () => {
    expect(parseJsonObject("An unfinished { and another {")).toBeNull();
  });
});
