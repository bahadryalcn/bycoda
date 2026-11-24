import { beforeEach, expect, it, vi } from "vitest";
import {
  claimPlayback,
  releasePlayback,
  resetPlaybackForTests,
  playbackText,
  scrubKeyValue,
} from "./mediaPlayback";

const element = (paused = false) => ({ paused, pause: vi.fn() }) as unknown as HTMLMediaElement;

beforeEach(resetPlaybackForTests);

it("pauses the playing element when another one claims playback", () => {
  const first = element();
  const second = element();
  claimPlayback(first);
  claimPlayback(second);
  expect(first.pause).toHaveBeenCalledOnce();
  expect(second.pause).not.toHaveBeenCalled();
});

it("does not pause an element that already paused or was released", () => {
  const first = element(true);
  claimPlayback(first);
  claimPlayback(element());
  expect(first.pause).not.toHaveBeenCalled();
  const third = element();
  claimPlayback(third);
  releasePlayback(third);
  claimPlayback(element());
  expect(third.pause).not.toHaveBeenCalled();
});

it("maps seek keys to clamped values", () => {
  expect(scrubKeyValue("ArrowRight", 10, 60, 5)).toBe(15);
  expect(scrubKeyValue("ArrowLeft", 3, 60, 5)).toBe(0);
  expect(scrubKeyValue("ArrowUp", 58, 60, 5)).toBe(60);
  expect(scrubKeyValue("PageDown", 30, 100, 2)).toBe(10);
  expect(scrubKeyValue("Home", 30, 60, 5)).toBe(0);
  expect(scrubKeyValue("End", 30, 60, 5)).toBe(60);
  expect(scrubKeyValue("a", 30, 60, 5)).toBeUndefined();
});

it("formats playback positions without locale text", () => {
  expect(playbackText(0)).toBe("0:00");
  expect(playbackText(Number.NaN)).toBe("0:00");
  expect(playbackText(65.9)).toBe("1:05");
  expect(playbackText(3725)).toBe("1:02:05");
});
