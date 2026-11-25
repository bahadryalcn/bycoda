// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { inlineMediaAttachmentPath, isLocalMediaPath, LocalMedia } from "./LocalMedia";
import type { Attachment } from "../model/session";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset:${path}`,
}));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split(/[\\/]/).pop() ?? "",
  prepareLocalFile: vi.fn(async (path: string) => path),
  readBinaryFile: vi.fn(),
}));

it("plays a local audio file inline with its fallback link below", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(LocalMedia, {
          path: "/work/theme.mp3",
          label: "Theme",
          fallback: createElement("a", { href: "#" }, "theme.mp3"),
        }),
      ),
    );
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("asset:/work/theme.mp3");
    expect(audio?.getAttribute("aria-label")).toBe("Theme");
    expect(container.querySelector("a")?.textContent).toBe("theme.mp3");
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("recognizes local audio paths but not remote URLs", () => {
  expect(isLocalMediaPath(String.raw`C:\music\loop.wav`)).toBe(true);
  expect(isLocalMediaPath("https://example.com/loop.wav")).toBe(false);
});

it("plays only sent media attachments whose file is on this computer", () => {
  const base: Attachment = {
    id: "a",
    name: "clip.mp4",
    mimeType: "video/mp4",
    kind: "file",
    size: 10,
    path: String.raw`C:\clips\clip.mp4`,
  };
  expect(inlineMediaAttachmentPath(base)).toBe(String.raw`C:\clips\clip.mp4`);
  expect(inlineMediaAttachmentPath({ ...base, kind: "audio", path: "/a/song.mp3" })).toBe(
    "/a/song.mp3",
  );
  expect(inlineMediaAttachmentPath({ ...base, path: "/a/notes.pdf" })).toBeUndefined();
  expect(inlineMediaAttachmentPath({ ...base, missing: true })).toBeUndefined();
  expect(inlineMediaAttachmentPath({ ...base, hostEnvironmentId: "host" })).toBeUndefined();
  expect(inlineMediaAttachmentPath({ ...base, loadPreview: async () => "" })).toBeUndefined();
  expect(inlineMediaAttachmentPath({ ...base, path: undefined, data: "AAAA" })).toBeUndefined();
});
