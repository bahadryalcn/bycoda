import { expect, it } from "vitest";
import { xPostWeight } from "./publishingFormats";
it("counts X links, CJK and joined emoji using the standard post weighting", () => {
  expect(xPostWeight("https://example.com/a/very/long/path")).toBe(23);
  expect(xPostWeight("abc")).toBe(3);
  expect(xPostWeight("你好")).toBe(4);
  expect(xPostWeight("👨‍👩‍👧‍👦")).toBe(2);
  expect(xPostWeight("e\u0301")).toBe(1);
});
