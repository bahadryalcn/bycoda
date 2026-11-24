import { expect, it } from "vitest";
import { parseRetryAt, retryAtFromDelay, retryAtFromTimestamp } from "./retryAt";

const NOW = 1_000_000_000_000;

it.each([
  ["Rate limited. retry-after: 30", NOW + 30_000],
  ["Overloaded, try again in 12s", NOW + 12_000],
  ["Retrying in 2 minutes", NOW + 120_000],
  ["Please retry after 500ms", NOW + 500],
  ["quota resets in 1 hour", NOW + 3_600_000],
])("reads the wait from %s", (text, expected) => {
  expect(parseRetryAt(text, NOW)).toBe(expected);
});

it("returns nothing without a usable wait", () => {
  expect(parseRetryAt("Reconnecting... 2/5", NOW)).toBeUndefined();
  expect(parseRetryAt("retry-after: 0", NOW)).toBeUndefined();
  expect(parseRetryAt("try again in 5 parsecs", NOW)).toBeUndefined();
});

it("clamps absurd delays and rejects stale or invalid timestamps", () => {
  expect(retryAtFromDelay(Number.POSITIVE_INFINITY, NOW)).toBeUndefined();
  expect(retryAtFromDelay(-5, NOW)).toBeUndefined();
  expect(retryAtFromDelay(10 ** 12, NOW)).toBe(NOW + 24 * 60 * 60 * 1000);
  expect(retryAtFromTimestamp(NOW - 1, NOW)).toBeUndefined();
  expect(retryAtFromTimestamp(NOW + 5000, NOW)).toBe(NOW + 5000);
  expect(retryAtFromTimestamp(NOW / 1000 + 5, NOW)).toBe(NOW + 5000);
  expect(retryAtFromTimestamp("soon", NOW)).toBeUndefined();
});
