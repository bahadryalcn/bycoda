import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJsonObject, parseJsonObject } from "./jsonText";

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

const legacyObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim();
  let fallback: Record<string, unknown> | null = null;
  for (let start = trimmed.indexOf("{"); start >= 0; start = trimmed.indexOf("{", start + 1)) {
    const json = extractJsonObject(trimmed.slice(start));
    if (!json) continue;
    try {
      const value = JSON.parse(json);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (
        ["subject", "title", "message", "body", "branch"].some(
          (key) => typeof value[key] === "string",
        )
      )
        return value;
      fallback ??= value;
    } catch {
      /* Independent pre-change behavior oracle. */
    }
  }
  return fallback;
};
afterEach(() => vi.restoreAllMocks());

it.each([
  '{"x":{"title":"nested"}}',
  '{"x":{"title":"first"},"x":{"title":"last"}}',
  '{"title":"discarded","title":7,"x":{"branch":"nested"}}',
  '{"title":7,"title":"last"}',
  '{"\\u0074itle":"escaped"}',
  '{"x":[1,-0.2e+3,true,false,null,{"body":"nested-array"}]}',
  '{"x":01} {"message":"after invalid number"}',
  '{"x":[1,]} {"subject":"after trailing comma"}',
  '{"x":"\\q"} {"branch":"after bad escape"}',
  '"preamble {"title":"quoted"} suffix"',
  '{ "unfinished {\n{"branch":"recovered"}',
  '{"a":"{ } and \\\"quote\\\"","b":{"count":1}}',
])("matches legacy candidate preference for %s", (input) => {
  expect(parseJsonObject(input)).toEqual(legacyObject(input));
});

it("matches legacy extraction across deterministic valid, invalid and quoted preambles", () => {
  const bodies = [
    "{}",
    '{"count":1}',
    '{"title":"ok"}',
    '{"title":false,"nested":{"message":"yes"}}',
    '{"a":[{"branch":"a"},{"branch":"b"}]}',
  ];
  const prefixes = ["", "noise { ", '{ "broken ', '"{', "{{{{", "[", "\n```json\n"];
  const suffixes = ["", "}", " text", '"', "\n```", '{"body":"later"}'];
  for (const body of bodies)
    for (const prefix of prefixes)
      for (const suffix of suffixes) {
        const input = `${prefix}${body}${suffix}`;
        expect(parseJsonObject(input)).toEqual(legacyObject(input));
      }
});

it("does not reparse overlapping large invalid candidates", () => {
  const parse = vi.spyOn(JSON, "parse");
  const input = '{"x":'.repeat(1500) + '{"title":"found"}' + ",}".repeat(1500);
  expect(parseJsonObject(input)).toEqual({ title: "found" });
  expect(parse.mock.calls.filter(([text]) => String(text).length > 44).length).toBeLessThanOrEqual(
    1,
  );
});

it("parses one selected deep fallback and preserves the structural extraction API", () => {
  const input = '{"x":'.repeat(2000) + '{"count":1}' + "}".repeat(2000);
  const parse = vi.spyOn(JSON, "parse");
  let value = parseJsonObject(input)!;
  expect(parse.mock.calls.filter(([text]) => String(text).length > 44)).toHaveLength(1);
  for (let level = 0; level < 2000; level++) value = value.x as Record<string, unknown>;
  expect(value.count).toBe(1);
  expect(extractJsonObject('prefix {not JSON} {"title":"later"}')).toBe("{not JSON}");
});
