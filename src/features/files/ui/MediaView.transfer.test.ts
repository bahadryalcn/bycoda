// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaView } from "./MediaView";

// Regression for #930: media shares the document/image transfer progress and gains its Cancel.

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").at(-1),
  prepareLocalFile: mocks.prepare,
  preparedFileSize: vi.fn(async () => 1024),
  openPathWithDefaultApp: vi.fn(),
}));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.prepare.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

it("aborts a remote media copy on Cancel and Retry copies again", async () => {
  mocks.prepare.mockImplementationOnce(
    (_path: string, options: { signal: AbortSignal }) =>
      new Promise<string>((_resolve, reject) => {
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("Cancelled", "AbortError")),
        );
      }),
  );
  await act(async () =>
    root.render(createElement(MediaView, { path: "remote://mac/project/demo.mp4" })),
  );
  const signal = mocks.prepare.mock.calls[0][1].signal as AbortSignal;
  await act(async () => mocks.prepare.mock.calls[0][1].onProgress(1, 4));
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");

  await act(async () => button("Cancel")!.click());

  expect(signal.aborted).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Cancelled");

  mocks.prepare.mockResolvedValueOnce("C:/cache/demo.mp4");
  await act(async () => button("Retry")!.click());
  expect(mocks.prepare).toHaveBeenCalledTimes(2);
  expect(container.querySelector("video")?.getAttribute("src")).toBe("asset:C:/cache/demo.mp4");
});

it("offers no Cancel for a media file that needs no remote copy", async () => {
  mocks.prepare.mockImplementation(() => new Promise<string>(() => {}));
  await act(async () => root.render(createElement(MediaView, { path: "/project/demo.mp4" })));

  expect(button("Cancel")).toBeUndefined();
});
