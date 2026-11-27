import { describe, expect, it } from "vitest";
import { MAX_JSON_TREE_CHARS, jsonOpenDepth, parseJsonTree } from "./jsonTree";

describe("parseJsonTree", () => {
  it("parses an object or array", () => {
    expect(parseJsonTree('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
    expect(parseJsonTree(" [1, 2]\n")).toEqual({ ok: true, data: [1, 2] });
  });
  it("keeps invalid, truncated and scalar text raw", () => {
    expect(parseJsonTree('{"a": 1,')).toEqual({ ok: false });
    expect(parseJsonTree("{a: 1}")).toEqual({ ok: false });
    expect(parseJsonTree("42")).toEqual({ ok: false });
    expect(parseJsonTree('"text"')).toEqual({ ok: false });
    expect(parseJsonTree("")).toEqual({ ok: false });
  });
  it("keeps oversized text raw", () => {
    const big = `[${"1,".repeat(MAX_JSON_TREE_CHARS)}1]`;
    expect(parseJsonTree(big)).toEqual({ ok: false });
  });
  it("returns the same result for the same settled text", () => {
    const text = '{"k":[1,2,3]}';
    expect(parseJsonTree(text)).toBe(parseJsonTree(text));
  });
});

describe("jsonOpenDepth", () => {
  it("opens small documents deeper than large ones", () => {
    expect(jsonOpenDepth({ a: { b: 1 } })).toBe(3);
    expect(jsonOpenDepth(Array.from({ length: 100 }, (_, i) => ({ i })))).toBe(1);
    expect(jsonOpenDepth(Array.from({ length: 100 }, (_, i) => i))).toBe(2);
    expect(jsonOpenDepth(Array.from({ length: 1000 }, (_, i) => i))).toBe(1);
  });
});
