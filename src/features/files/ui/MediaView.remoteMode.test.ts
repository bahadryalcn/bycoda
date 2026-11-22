// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaView } from "./MediaView";

// Remote media modes: mapped and cached files never transfer; stream plays through the gateway;
// data saver waits for a click.

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  info: vi.fn(),
  stream: vi.fn(),
  release: vi.fn(async (_lease: string) => undefined),
  mapped: vi.fn((_path: string): string | undefined => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../shared/lib/remoteExplorerPaths", () => ({ localExplorerPath: mocks.mapped }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").at(-1),
  prepareLocalFile: mocks.prepare,
  preparedFileSize: vi.fn(async () => 1024),
  remoteMediaInfo: mocks.info,
  remoteMediaStreamUrl: mocks.stream,
  releaseRemoteMediaLease: mocks.release,
  openPathWithDefaultApp: vi.fn(),
}));

const remote = "remote://mac/project/demo.mp4";
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const mock of [mocks.prepare, mocks.info, mocks.stream, mocks.mapped]) mock.mockReset();
  mocks.release.mockClear();
  mocks.mapped.mockReturnValue(undefined);
  mocks.info.mockResolvedValue({ size: 2048, cachedPath: null });
  mocks.prepare.mockResolvedValue("C:/cache/demo.mp4");
  mocks.stream.mockResolvedValue({
    url: "http://127.0.0.1:5000/cap/demo.mp4",
    size: 2048,
    lease: "lease-1",
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.removeItem("bycoda.remoteMediaMode");
  vi.unstubAllGlobals();
});

const mode = (value: string) => localStorage.setItem("bycoda.remoteMediaMode", value);
const render = () => act(async () => root.render(createElement(MediaView, { path: remote })));
const click = (label: string) =>
  act(async () =>
    [...container.querySelectorAll("button")]
      .find((item) => item.textContent?.trim() === label)!
      .click(),
  );
const src = () => container.querySelector("video")?.getAttribute("src");

it("plays a mapped shared path directly in every mode without asking the Host", async () => {
  mocks.mapped.mockReturnValue("D:/share/demo.mp4");
  mocks.prepare.mockResolvedValue("D:/share/demo.mp4");
  for (const value of ["stream", "download", "saver"]) {
    mode(value);
    await render();
    expect(src()).toBe("asset:D:/share/demo.mp4");
    act(() => root.unmount());
    root = createRoot(container);
  }
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
});

it("reuses a finished copy of this version in every mode without a second transfer", async () => {
  mocks.info.mockResolvedValue({ size: 2048, cachedPath: "C:/cache/v1/demo.mp4" });
  for (const value of ["stream", "download", "saver"]) {
    mode(value);
    await render();
    expect(src()).toBe("asset:C:/cache/v1/demo.mp4");
    act(() => root.unmount());
    root = createRoot(container);
  }
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();
});

it("plays right away from the gateway URL by default without copying", async () => {
  await render();
  expect(src()).toBe("http://127.0.0.1:5000/cap/demo.mp4");
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("falls back to the full copy when the gateway is unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.stream.mockRejectedValue(new Error("Update bycoda Host"));
  await render();
  expect(src()).toBe("asset:C:/cache/demo.mp4");
});

it("downloads then plays in download mode", async () => {
  mode("download");
  await render();
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(src()).toBe("asset:C:/cache/demo.mp4");
});

it("transfers nothing in data saver until Play or Download is clicked", async () => {
  mode("saver");
  await render();
  expect(container.textContent).toContain("2.0 KB");
  expect(container.querySelector("video")).toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.stream).not.toHaveBeenCalled();

  await click("Play");
  expect(src()).toBe("http://127.0.0.1:5000/cap/demo.mp4");
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("downloads in data saver only after Download is clicked", async () => {
  mode("saver");
  await render();
  await click("Download");
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(src()).toBe("asset:C:/cache/demo.mp4");
});

it("holds a gateway lease while the player is open and releases it on close", async () => {
  await render();
  expect(mocks.release).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(mocks.release).toHaveBeenCalledWith("lease-1");
  root = createRoot(container);
});

it("asks for a fresh URL once on a playback error and resumes at the same position", async () => {
  mocks.stream.mockResolvedValueOnce({
    url: "http://127.0.0.1:5000/old/demo.mp4",
    size: 2048,
    lease: "old",
  });
  mocks.stream.mockResolvedValueOnce({
    url: "http://127.0.0.1:5001/new/demo.mp4",
    size: 2048,
    lease: "new",
  });
  await render();
  const first = container.querySelector("video")!;
  Object.defineProperty(first, "currentTime", { value: 42.5, configurable: true });
  Object.defineProperty(first, "paused", { value: false, configurable: true });
  await act(async () => first.dispatchEvent(new Event("error")));
  expect(mocks.stream).toHaveBeenCalledTimes(2);
  expect(src()).toBe("http://127.0.0.1:5001/new/demo.mp4");
  expect(mocks.release).toHaveBeenCalledWith("old");
  const next = container.querySelector("video")!;
  const play = vi.spyOn(next, "play").mockResolvedValue(undefined);
  await act(async () => next.dispatchEvent(new Event("loadedmetadata")));
  expect(next.currentTime).toBe(42.5);
  expect(play).toHaveBeenCalled();
  // A second failure is a real error, not another refresh.
  await act(async () => next.dispatchEvent(new Event("error")));
  expect(mocks.stream).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("could not be played");
});
