// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineAudio } from "./InlineAudio";
import { resetPlaybackForTests } from "./mediaPlayback";
import { clearPeaksForTests } from "./mediaPeaks";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  resetPlaybackForTests();
  clearPeaksForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (path: string) =>
  createElement(InlineAudio, {
    path,
    url: `asset:${path}`,
    label: path,
    playerRef: () => {},
    onFailed: () => {},
    onPlay: () => {},
  });

it("seeks the audio with arrow, Home and End keys on the waveform", async () => {
  await act(async () => root.render(card("/work/a.wav")));
  const audio = container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { value: 60, configurable: true });
  await act(async () => audio.dispatchEvent(new Event("durationchange")));
  const wave = container.querySelector<HTMLElement>("[role=slider]")!;
  expect(wave.getAttribute("aria-label")).toContain("a.wav");
  const press = (key: string) =>
    act(async () => {
      wave.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  await press("ArrowRight");
  expect(audio.currentTime).toBe(5);
  await press("End");
  expect(audio.currentTime).toBe(60);
  await press("Home");
  expect(audio.currentTime).toBe(0);
});

it("lets only one inline player play at a time", async () => {
  await act(async () =>
    root.render(createElement("div", null, card("/work/a.wav"), card("/work/b.wav"))),
  );
  const [first, second] = [...container.querySelectorAll("audio")];
  const pause = vi.spyOn(first, "pause").mockImplementation(() => {});
  for (const audio of [first, second]) {
    Object.defineProperty(audio, "paused", { value: false, configurable: true });
  }
  await act(async () => first.dispatchEvent(new Event("play")));
  await act(async () => second.dispatchEvent(new Event("play")));
  expect(pause).toHaveBeenCalledOnce();
});

it("draws a neutral waveform when the peaks cannot be computed", async () => {
  await act(async () => root.render(card("/work/c.wav")));
  expect(container.querySelectorAll("i").length).toBeGreaterThan(0);
  expect(container.querySelector("[class*=neutral]")).not.toBeNull();
});
