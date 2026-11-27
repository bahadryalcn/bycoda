// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { validateChatBackgroundMedia } from "./backgroundMedia";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not load HTML in the privileged app renderer", async () => {
  const create = vi.spyOn(document, "createElement");
  await validateChatBackgroundMedia("/scene.html");
  expect(create).not.toHaveBeenCalled();
});

it("accepts decoded video silently and releases its decoder", async () => {
  const video = document.createElement("video");
  const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
  const load = vi.spyOn(video, "load").mockImplementation(() => {});
  vi.spyOn(document, "createElement").mockReturnValue(video);
  const pending = validateChatBackgroundMedia("/video.webm");
  expect(video.muted).toBe(true);
  expect(video.autoplay).toBe(false);
  video.dispatchEvent(new Event("loadeddata"));
  await pending;
  expect(pause).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledOnce();
  expect(video.hasAttribute("src")).toBe(false);
});

it("requires an image load event and rejects decode errors", async () => {
  const image = document.createElement("img");
  vi.spyOn(image, "src", "set").mockImplementation(() => {});
  vi.stubGlobal("Image", function () {
    return image;
  });
  const ready = validateChatBackgroundMedia("/image.png");
  image.dispatchEvent(new Event("load"));
  await ready;
  const failed = expect(validateChatBackgroundMedia("/broken.png")).rejects.toThrow(
    "Background could not be loaded",
  );
  image.dispatchEvent(new Event("error"));
  await failed;
});

it("rejects unsupported codecs or a stalled load before selection can change", async () => {
  vi.useFakeTimers();
  const video = document.createElement("video");
  vi.spyOn(video, "pause").mockImplementation(() => {});
  vi.spyOn(video, "load").mockImplementation(() => {});
  vi.spyOn(document, "createElement").mockReturnValue(video);
  const failed = expect(validateChatBackgroundMedia("/broken.mp4")).rejects.toThrow(
    "Background could not be loaded",
  );
  video.dispatchEvent(new Event("error"));
  await failed;
  const stalled = expect(validateChatBackgroundMedia("/stalled.mp4")).rejects.toThrow(
    "Background could not be loaded",
  );
  await vi.advanceTimersByTimeAsync(10_000);
  await stalled;
  expect(video.hasAttribute("src")).toBe(false);
});
