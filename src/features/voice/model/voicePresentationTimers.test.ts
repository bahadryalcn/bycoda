// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  VOICE_HEARING_SAMPLE_MS,
  VOICE_SECOND_MS,
  subscribeVoiceSecond,
  voiceHearingStore,
} from "./voicePresentationTimers";

let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => {
  vi.useRealTimers();
});

// Regression #319: three readouts each ran their own 120 ms timer, two of them while hidden.
it("samples the level with one timer for every reader and tells them only about flips", () => {
  const level = { current: 0 };
  const store = voiceHearingStore(level);
  expect(voiceHearingStore(level)).toBe(store);
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = store.subscribe(first);
  const stopSecond = store.subscribe(second);
  expect(vi.getTimerCount()).toBe(1);

  // A streaming level inside one state never wakes the readers.
  level.current = 0.2;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS);
  expect(store.get()).toBe(true);
  level.current = 0.5;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS * 3);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);

  level.current = 0;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS);
  expect(store.get()).toBe(false);
  expect(first).toHaveBeenCalledTimes(2);

  stopFirst();
  expect(vi.getTimerCount()).toBe(1);
  stopSecond();
  expect(vi.getTimerCount()).toBe(0);
});

it("sleeps while hidden, catches up when visible, and forgets sound once nobody reads it", () => {
  const level = { current: 0.3 };
  const store = voiceHearingStore(level);
  const listener = vi.fn();
  const stop = store.subscribe(listener);
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS);
  expect(store.get()).toBe(true);

  setHidden(true);
  expect(vi.getTimerCount()).toBe(0);
  level.current = 0;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS * 10);
  expect(listener).toHaveBeenCalledTimes(1);

  setHidden(false);
  expect(store.get()).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);

  level.current = 0.3;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS);
  stop();
  expect(store.get()).toBe(false);
});

it("keeps sampling while hidden for the detached window that mirrors the text", () => {
  const level = { current: 0 };
  const store = voiceHearingStore(level);
  const listener = vi.fn();
  const stop = store.subscribeAlways(listener);
  setHidden(true);
  expect(vi.getTimerCount()).toBe(1);
  level.current = 0.3;
  vi.advanceTimersByTime(VOICE_HEARING_SAMPLE_MS);
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("runs one second timer for all readouts and pauses it while hidden", () => {
  const clock = vi.fn();
  const actions = vi.fn();
  const stopClock = subscribeVoiceSecond(clock);
  const stopActions = subscribeVoiceSecond(actions);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(VOICE_SECOND_MS * 2);
  expect(clock).toHaveBeenCalledTimes(2);
  expect(actions).toHaveBeenCalledTimes(2);

  setHidden(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(VOICE_SECOND_MS * 30);
  expect(clock).toHaveBeenCalledTimes(2);

  // Visible again: one immediate catch-up tick, then the cadence resumes.
  setHidden(false);
  expect(clock).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(VOICE_SECOND_MS);
  expect(clock).toHaveBeenCalledTimes(4);

  stopClock();
  expect(vi.getTimerCount()).toBe(1);
  stopActions();
  expect(vi.getTimerCount()).toBe(0);
});
