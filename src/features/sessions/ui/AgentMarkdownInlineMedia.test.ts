// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) => `asset:${path}`,
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  prepareLocalFile: async (path: string) => path,
  statFiles: async (paths: string[]) => paths.map((path) => ({ path, mtimeMs: 1, isDir: false })),
}));

it.each([
  ["Film: `temp/film/bycoda.mp4`", "video", "asset:/repo/temp/film/bycoda.mp4"],
  ["Music: `/repo/out/theme.mp3`", "audio", "asset:/repo/out/theme.mp3"],
] as const)("plays a media path written as code: %s", async (text, tag, src) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text, cwd: "/repo", localMedia: true })),
    );
    await act(async () => {});
    expect(container.querySelector(tag)?.getAttribute("src")).toBe(src);
    // The path stays below the player for opening and its context actions.
    expect(container.querySelector("code")?.textContent).toContain(text.split("`")[1]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("keeps a media path as code when local media is off", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(AgentMarkdown, { text: "`temp/a.mp4`", cwd: "/repo" })),
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain("temp/a.mp4");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
