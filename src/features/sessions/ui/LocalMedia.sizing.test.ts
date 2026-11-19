// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocalMedia } from "./LocalMedia";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop() ?? "",
  prepareLocalFile: async (path: string) => path,
}));

it.each([
  ["portrait.png", "img", "load", "naturalWidth", "naturalHeight", 600, 1200],
  ["wide.mp4", "video", "loadedmetadata", "videoWidth", "videoHeight", 1600, 600],
] as const)(
  "replaces the placeholder with the measured frame for %s",
  async (path, tag, event, widthKey, heightKey, width, height) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(LocalMedia, { path: `/work/${path}`, label: path, fallback: null }),
        ),
      );
      const frame = container.querySelector<HTMLElement>("[data-local-media]")!;
      const media = frame.querySelector(tag)!;
      expect(frame.classList.contains("aspect-video")).toBe(true);
      expect(frame.classList.contains("w-80")).toBe(true);

      Object.defineProperties(media, {
        [widthKey]: { value: width },
        [heightKey]: { value: height },
      });
      await act(async () => media.dispatchEvent(new Event(event)));

      expect(frame.style.aspectRatio).toBe(`${width} / ${height}`);
      expect(frame.style.width).toContain("40rem");
      expect(frame.classList.contains("w-80")).toBe(false);
      expect(frame.classList.contains("aspect-video")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      pause.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
