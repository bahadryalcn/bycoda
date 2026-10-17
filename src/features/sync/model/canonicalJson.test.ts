import { expect, it } from "vitest";
import { canonicalJson } from "./canonicalJson";

it("preserves ordinary JSON keys that also name object prototype properties", () => {
  const value = JSON.parse('{"__proto__":"first","constructor":"second"}');
  expect(JSON.parse(canonicalJson(value))).toEqual(value);
  expect(canonicalJson(value)).not.toBe(canonicalJson({ constructor: "second" }));
});

it("sorts nested object keys while preserving array order", () => {
  expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: 0 })).toBe('{"a":0,"z":[{"a":1,"b":2}]}');
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
});
