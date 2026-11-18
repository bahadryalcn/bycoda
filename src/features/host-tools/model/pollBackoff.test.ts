import { expect, it } from "vitest";
import { pollDelay } from "./pollBackoff";

it("keeps the base interval until a poll fails, then doubles per failure up to four times", () => {
  expect([0, 1, 2, 3, 6].map((failures) => pollDelay(1_000, failures))).toEqual([
    1_000, 2_000, 4_000, 4_000, 4_000,
  ]);
});

it("reads a quiet list less often and composes that with the failure backoff", () => {
  expect(pollDelay(1_000, 0, 2)).toBe(1_000);
  expect(pollDelay(1_000, 0, 3)).toBe(2_000);
  expect(pollDelay(1_000, 0, 6)).toBe(4_000);
  expect(pollDelay(1_000, 1, 3)).toBe(4_000);
});
