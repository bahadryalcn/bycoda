// @vitest-environment happy-dom
import { showErrorDetails } from "./errorDetails.test-support";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaView } from "./MediaView";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  open: vi.fn(),
  info: vi.fn(async () => ({ size: 4, cachedPath: null as string | null })),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").at(-1),
  prepareLocalFile: mocks.prepare,
  preparedFileSize: vi.fn(async () => 1024),
  remoteMediaInfo: mocks.info,
  remoteMediaStreamUrl: vi.fn(),
  openPathWithDefaultApp: mocks.open,
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.prepare.mockReset();
  mocks.open.mockReset();
  localStorage.setItem("bycoda.remoteMediaMode", "download");
});
afterEach(() => {
  localStorage.removeItem("bycoda.remoteMediaMode");
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("prepares the owning remote file and plays only the returned local asset without autoplay", async () => {
  mocks.prepare.mockResolvedValue("C:/cache/demo.mp4");
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/project/demo.mp4" })),
  );
  expect(mocks.prepare).toHaveBeenCalledWith(
    "remote://mac/project/demo.mp4",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(container.querySelector("video")?.getAttribute("src")).toBe("asset:C:/cache/demo.mp4");
  expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true);
  expect(container.querySelector("video")?.hasAttribute("autoplay")).toBe(false);
});
it("ignores stale downloads after switching files and aborts the former request", async () => {
  let finish!: (path: string) => void;
  mocks.prepare
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce("/cache/new.mp3");
  await act(async () => root.render(createElement(MediaView, { path: "remote://mac/old.mp4" })));
  const options = mocks.prepare.mock.calls[0][1];
  await act(async () => root.render(createElement(MediaView, { path: "remote://linux/new.mp3" })));
  await act(async () => finish("/cache/old.mp4"));
  expect(options.signal.aborted).toBe(true);
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("asset:/cache/new.mp3");
});
it("exposes codec errors and retry instead of a blank player", async () => {
  mocks.prepare.mockResolvedValue("/demo.mp4");
  await act(async () => root.render(createElement(MediaView, { path: "/demo.mp4" })));
  act(() => container.querySelector("video")!.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be played");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Try again")!
      .click(),
  );
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
});

it("does not download restored inactive media tabs", async () => {
  mocks.prepare.mockResolvedValue("/cache/demo.mp4");
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/demo.mp4", active: false })),
  );
  expect(mocks.prepare).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/demo.mp4", active: true })),
  );
  expect(mocks.prepare).toHaveBeenCalledOnce();
});

it("keeps a loaded player mounted and does not reload it when its tab is hidden and shown again", async () => {
  mocks.prepare.mockResolvedValue("/cache/demo.mp4");
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/demo.mp4", active: true })),
  );
  const video = container.querySelector("video");
  expect(video?.getAttribute("src")).toBe("asset:/cache/demo.mp4");
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/demo.mp4", active: false })),
  );
  expect(container.querySelector("video")).toBe(video);
  expect(video?.getAttribute("src")).toBe("asset:/cache/demo.mp4");
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/demo.mp4", active: true })),
  );
  expect(container.querySelector("video")).toBe(video);
  expect(mocks.prepare).toHaveBeenCalledOnce();
});

it("keeps external-open progress local, blocks duplicates and allows retry after failure", async () => {
  mocks.prepare.mockResolvedValue("/demo.mp4");
  let reject!: (error: Error) => void;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => root.render(createElement(MediaView, { path: "/demo.mp4" })));
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Open in default app",
  )!;
  button.focus();
  act(() => {
    button.click();
    button.click();
  });
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
  await act(async () => reject(new Error("Application unavailable")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn’t open the file in its default app",
  );
  await showErrorDetails(container);
  expect(document.body.textContent).toContain("Application unavailable");
  mocks.open.mockResolvedValue(undefined);
  await act(async () => button.click());
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
