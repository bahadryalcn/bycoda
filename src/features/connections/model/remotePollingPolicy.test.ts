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

it("checks a down machine rarely unless the user works in it", async () => {
  const { machineStatusPollDelay } = await import("./remotePollingPolicy");
  const { focusMachine } = await import("./machineFocus");
  expect(machineStatusPollDelay(0, "env")).toBe(15_000);
  expect(machineStatusPollDelay(2, "env")).toBe(5 * 60_000);
  const release = focusMachine("env");
  expect(machineStatusPollDelay(2, "env")).toBe(12_000);
  release();
  release();
  expect(machineStatusPollDelay(2, "env")).toBe(5 * 60_000);
});

it("shares one backoff curve and jitters it within 15 percent", async () => {
  const { remoteBackoffDelay, withBackoffJitter } = await import("./remotePollingPolicy");
  expect([1, 2, 3, 4, 9].map(remoteBackoffDelay)).toEqual([6_000, 12_000, 24_000, 30_000, 30_000]);
  expect(withBackoffJitter(10_000, () => 0)).toBe(8_500);
  expect(withBackoffJitter(10_000, () => 0.5)).toBe(10_000);
  expect(withBackoffJitter(10_000, () => 1)).toBe(11_500);
});
