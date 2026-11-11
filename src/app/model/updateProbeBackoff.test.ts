import { beforeEach, expect, it, vi } from "vitest";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function backoff() {
  return import("./updateProbeBackoff");
}

beforeEach(() => vi.resetModules());

it("doubles the wait per consecutive failure up to an eight hour ceiling", async () => {
  const { updateProbeDelayMs } = await backoff();
  expect([0, 1, 2, 3, 4, 5, 40].map(updateProbeDelayMs)).toEqual([
    30 * MINUTE,
    HOUR,
    2 * HOUR,
    4 * HOUR,
    8 * HOUR,
    8 * HOUR,
    8 * HOUR,
  ]);
});

it("lengthens the wait only for failed background checks", async () => {
  const state = await backoff();
  expect(state.nextUpdateProbeDelayMs()).toBe(30 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(0)).toBe(0);

  state.settleUpdateCheck(true, false, 1000);
  expect(state.nextUpdateProbeDelayMs()).toBe(HOUR);
  expect(state.pendingUpdateProbeWaitMs(1000 + 20 * MINUTE)).toBe(40 * MINUTE);
  expect(state.pendingUpdateProbeWaitMs(1000 + 2 * HOUR)).toBe(0);

  state.settleUpdateCheck(true, false, 2000);
  expect(state.nextUpdateProbeDelayMs()).toBe(2 * HOUR);
});

it.each([
  ["a successful background check", false, false],
  ["a successful explicit check", false, true],
  ["a failed explicit check", true, true],
])("restores the base interval after %s", async (_name, failed, explicit) => {
  const state = await backoff();
  for (let streak = 0; streak < 6; streak++) state.settleUpdateCheck(true, false, streak);
  expect(state.nextUpdateProbeDelayMs()).toBe(8 * HOUR);

  state.settleUpdateCheck(failed, explicit, 10);
  expect(state.nextUpdateProbeDelayMs()).toBe(30 * MINUTE);
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
