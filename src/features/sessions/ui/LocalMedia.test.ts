// @vitest-environment happy-dom
import { Activity, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocalMedia } from "./LocalMedia";
import { MediaVisibilityContext } from "../../files/model/mediaVisibility";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split(/[\\/]/).pop() ?? "",
  prepareLocalFile: vi.fn(async (path: string) => path),
  readBinaryFile: vi.fn(),
}));

it("pauses the retained video when Activity hides its pane and never resumes it automatically", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (visible: boolean) =>
    root.render(
      createElement(
        MediaVisibilityContext.Provider,
        { value: visible },
        createElement(
          Activity,
          { mode: visible ? "visible" : "hidden" },
          createElement(LocalMedia, { path: "/project/demo.mp4", label: "Demo", fallback: null }),
        ),
      ),
    );
  try {
    await act(async () => render(true));
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    pause.mockClear();
    await act(async () => render(false));
    expect(container.querySelector("video")).toBe(video);
    expect(pause).toHaveBeenCalled();
    await act(async () => render(true));
    expect(play).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
