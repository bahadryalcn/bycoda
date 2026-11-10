import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  VOICE_RECONNECT_CAP_MS,
  VOICE_SLOW_RETRY_MS,
  VoiceReconnectScheduler,
  voiceReconnectDelay,
} from "./voiceReconnectScheduler";
import { VOICE_RECONNECT_DELAYS } from "./voiceReconnect";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("fast attempts come first, then a slow schedule until the cap", () => {
  VOICE_RECONNECT_DELAYS.forEach((delay, attempt) =>
    expect(voiceReconnectDelay(attempt, 0)).toBe(delay),
  );
  const slow = VOICE_RECONNECT_DELAYS.length;
  expect(voiceReconnectDelay(slow, 48_000)).toBe(VOICE_SLOW_RETRY_MS);
  expect(voiceReconnectDelay(slow + 5, VOICE_RECONNECT_CAP_MS - VOICE_SLOW_RETRY_MS)).toBe(
    VOICE_SLOW_RETRY_MS,
  );
  expect(voiceReconnectDelay(slow + 5, VOICE_RECONNECT_CAP_MS - VOICE_SLOW_RETRY_MS + 1)).toBe(
    undefined,
  );
});

function clock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test("keeps retrying every minute and gives up at the cap", () => {
  const time = clock();
  const scheduler = new VoiceReconnectScheduler(time.now);
  const run = vi.fn();
  let attempts = 0;
  while (scheduler.schedule(run)) {
    const before = run.mock.calls.length;
    const next = vi.getTimerCount() ? 1 : 0;
    expect(next).toBe(1);
    vi.runOnlyPendingTimers();
    expect(run.mock.calls.length).toBe(before + 1);
    time.advance(
      attempts < VOICE_RECONNECT_DELAYS.length
        ? VOICE_RECONNECT_DELAYS[attempts]
        : VOICE_SLOW_RETRY_MS,
    );
    attempts++;
    if (attempts > 100) throw new Error("never gave up");
  }
  expect(attempts).toBeGreaterThan(VOICE_RECONNECT_DELAYS.length + 20);
  expect(time.now()).toBeGreaterThanOrEqual(VOICE_RECONNECT_CAP_MS - VOICE_SLOW_RETRY_MS);
});

test("an online event retries immediately, once", () => {
  const scheduler = new VoiceReconnectScheduler();
  const run = vi.fn();
  expect(scheduler.retryNow()).toBe(false);
  scheduler.schedule(run);
  expect(scheduler.retryNow()).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  expect(scheduler.retryNow()).toBe(false);
  vi.runAllTimers();
  expect(run).toHaveBeenCalledTimes(1);
});

test("cancel fences an old timer and a pending online retry", () => {
  const scheduler = new VoiceReconnectScheduler();
  const run = vi.fn();
  scheduler.schedule(run);
  scheduler.cancel();
  expect(scheduler.retryNow()).toBe(false);
  vi.runAllTimers();
  expect(run).not.toHaveBeenCalled();
});

test("rotation reconnects immediately without spending the retry budget", () => {
  const scheduler = new VoiceReconnectScheduler();
  const run = vi.fn();
  scheduler.schedule(run, true);
  vi.advanceTimersByTime(0);
  expect(run).toHaveBeenCalledTimes(1);
  const next = vi.fn();
  scheduler.schedule(next);
  vi.advanceTimersByTime(VOICE_RECONNECT_DELAYS[0] - 1);
  expect(next).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(next).toHaveBeenCalledTimes(1);
});

test("reset restores the fast schedule", () => {
  const scheduler = new VoiceReconnectScheduler();
  for (let i = 0; i < 3; i++) {
    scheduler.schedule(() => undefined);
    vi.runAllTimers();
  }
  scheduler.reset();
  const run = vi.fn();
  scheduler.schedule(run);
  vi.advanceTimersByTime(VOICE_RECONNECT_DELAYS[0]);
  expect(run).toHaveBeenCalledTimes(1);
});
