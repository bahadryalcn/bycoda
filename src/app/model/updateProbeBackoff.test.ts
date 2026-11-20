import { beforeEach, expect, it, vi } from "vitest";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function backoff() {
  return import("./updateProbeBackoff");
}

beforeEach(() => vi.resetModules());

it("doubles the wait per consecutive failure up to an eight hour ceiling", async () => {
  const { updateProbeDelayMs } = await backoff();
  expect([0, 1, 2, 3, 6, 7, 40].map(updateProbeDelayMs)).toEqual([
    5 * MINUTE,
    10 * MINUTE,
    20 * MINUTE,
    40 * MINUTE,
    320 * MINUTE,
    8 * HOUR,
    8 * HOUR,
  ]);
});

it("lengthens the wait only for failed background checks", async () => {
  const state = await backoff();
  expect(state.nextUpdateProbeDelayMs()).toBe(5 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(0)).toBe(0);

  state.settleUpdateCheck(true, false, 1000);
  expect(state.nextUpdateProbeDelayMs()).toBe(10 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(1000 + 4 * MINUTE)).toBe(6 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(1000 + 2 * HOUR)).toBe(0);

  state.settleUpdateCheck(true, false, 2000);
  expect(state.nextUpdateProbeDelayMs()).toBe(20 * MINUTE);
});

it.each([
  ["a successful background check", false, false],
  ["a successful explicit check", false, true],
  ["a failed explicit check", true, true],
])("restores the base interval after %s", async (_name, failed, explicit) => {
  const state = await backoff();
  for (let streak = 0; streak < 7; streak++) state.settleUpdateCheck(true, false, streak);
  expect(state.nextUpdateProbeDelayMs()).toBe(8 * HOUR);

  state.settleUpdateCheck(failed, explicit, 10);
  expect(state.nextUpdateProbeDelayMs()).toBe(5 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(10)).toBe(0);
});

it("tells subscribers about every settled check until they unsubscribe", async () => {
  const state = await backoff();
  const listener = vi.fn();
  const stop = state.subscribeUpdateProbeBackoff(listener);
  state.settleUpdateCheck(true, false);
  state.settleUpdateCheck(false, true);
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  state.settleUpdateCheck(true, false);
  expect(listener).toHaveBeenCalledTimes(2);
});
