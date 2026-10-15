import { expect, it } from "vitest";
import { remoteSessionPollDelay } from "./remotePollingPolicy";

it("slows hidden active tabs and minimized windows while retaining fast foreground updates", () => {
  expect(remoteSessionPollDelay(true, true, false)).toBe(750);
  expect(remoteSessionPollDelay(true, false, false)).toBe(3_000);
  expect(remoteSessionPollDelay(true, true, true)).toBe(5_000);
  expect(remoteSessionPollDelay(false, true, true)).toBe(30_000);
  expect(remoteSessionPollDelay(false, true, false)).toBe(1_500);
  expect(remoteSessionPollDelay(true, false, true, 6)).toBe(30_000);
});

it("shares one backoff curve and jitters it within 15 percent", async () => {
  const { remoteBackoffDelay, withBackoffJitter } = await import("./remotePollingPolicy");
  expect([1, 2, 3, 4, 9].map(remoteBackoffDelay)).toEqual([6_000, 12_000, 24_000, 30_000, 30_000]);
  expect(withBackoffJitter(10_000, () => 0)).toBe(8_500);
  expect(withBackoffJitter(10_000, () => 0.5)).toBe(10_000);
  expect(withBackoffJitter(10_000, () => 1)).toBe(11_500);
});
