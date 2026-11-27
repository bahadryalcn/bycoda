import { expect, it } from "vitest";
import { hourCellState } from "./hourCell";

it("keeps outside, unpriced and measured-zero hours apart", () => {
  expect(hourCellState({ amount: 0, outside: true, unpriced: false })).toBe("outside");
  expect(hourCellState({ amount: 0, outside: false, unpriced: true })).toBe("unavailable");
  expect(hourCellState({ amount: 2, outside: false, unpriced: true })).toBe("partial");
  expect(hourCellState({ amount: 0, outside: false, unpriced: false })).toBe("zero");
  expect(hourCellState({ amount: 2, outside: false, unpriced: false })).toBe("value");
});
