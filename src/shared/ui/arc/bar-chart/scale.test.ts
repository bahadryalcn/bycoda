import { expect, it } from "vitest";
import { scaleFor } from "./scale";

it("keeps whole-number steps for count data so tick labels never repeat", () => {
  expect(scaleFor(2, true).ticks).toEqual([0, 1, 2]);
  expect(scaleFor(3, true).ticks).toEqual([0, 1, 2, 3]);
  expect(scaleFor(0, true).ticks).toEqual([0, 1]);
});

it("still uses fractional steps for fractional data", () => {
  expect(scaleFor(2).ticks).toEqual([0, 0.5, 1, 1.5, 2]);
  expect(scaleFor(40, true).ticks).toEqual([0, 10, 20, 30, 40]);
});
