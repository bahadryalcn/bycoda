// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTranscriptImageOpen } from "./TranscriptImagePreview";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  resolve: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split(/[\\/]/).at(-1) ?? path,
  readBinaryFile: mocks.read,
  prepareLocalFile: mocks.prepare,
  preparedFileSize: vi.fn(async () => 1024),
  openPathWithDefaultApp: vi.fn(),
  revealPath: vi.fn(),
}));
vi.mock("../../files/model/fileIndex", () => ({ resolveFileOpenRequest: mocks.resolve }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let actions: ReturnType<typeof useTranscriptImageOpen>;
function Harness({ cwd = "/repo" }: { cwd?: string }) {
  actions = useTranscriptImageOpen(cwd, mocks.open);
  return actions.preview;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.resolve.mockImplementation(async (_cwd: string, path: string) => path);
  mocks.prepare.mockImplementation(async (path: string) => path);
  mocks.read.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens a video in a dialog with the existing player, and pauses on close", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => {
    actions.open?.("/repo/demo.mp4");
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const video = dialog.querySelector("video")!;
  expect(video.getAttribute("src")).toBe("asset:/repo/demo.mp4");
  expect(video.hasAttribute("controls")).toBe(true);
  expect(video.hasAttribute("autoplay")).toBe(false);
  expect(mocks.open).not.toHaveBeenCalled();
  const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
  await act(async () => close.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(mocks.prepare.mock.calls[0][1].signal.aborted).toBe(true);
});

it.each(["ctrlKey", "metaKey"])(
  "forwards a %s video click without a dialog or media read",
  async (modifier) => {
    await act(async () => root.render(createElement(Harness)));
    act(() => {
      actions.noteClick({ ctrlKey: modifier === "ctrlKey", metaKey: modifier === "metaKey" });
      actions.open?.("/repo/demo.mp4", { line: 4 }, { pin: true });
    });
    expect(mocks.open).toHaveBeenCalledWith("/repo/demo.mp4", { line: 4 }, { pin: true });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("retains the image lightbox and lets other documents reach the caller", async () => {
  await act(async () => root.render(createElement(Harness)));
  act(() => actions.open?.("/repo/report.pdf"));
  expect(mocks.open).toHaveBeenCalledWith("/repo/report.pdf");
  await act(async () => actions.open?.("/repo/photo.png"));
  expect(document.querySelector('[data-modal-layer="media"]')).not.toBeNull();
  expect(document.querySelector('img[src="blob:test-image"]')).not.toBeNull();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("resolves a remote video through the owning workspace before preparing it", async () => {
  mocks.resolve.mockResolvedValue("remote://machine/repo/demo.mp4");
  mocks.prepare.mockResolvedValue("C:/cache/demo.mp4");
  await act(async () => root.render(createElement(Harness, { cwd: "remote://machine/repo" })));
  await act(async () => {
    actions.open?.("demo.mp4");
    await vi.dynamicImportSettled();
  });
  expect(mocks.resolve).toHaveBeenCalledWith("remote://machine/repo", "demo.mp4");
  expect(mocks.prepare).toHaveBeenCalledWith("remote://machine/repo/demo.mp4", expect.any(Object));
  expect(document.querySelector("video")?.getAttribute("src")).toBe("asset:C:/cache/demo.mp4");
});

it("keeps a failed video path resolution retryable inside the dialog", async () => {
  mocks.resolve.mockRejectedValueOnce(new Error("Host unavailable"));
  await act(async () => root.render(createElement(Harness)));
  await act(async () => actions.open?.("/repo/demo.mp4"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
  expect(mocks.prepare).not.toHaveBeenCalled();
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(document.querySelector("video")?.getAttribute("src")).toBe("asset:/repo/demo.mp4");
});

it("does not prepare a video after its pending dialog has closed", async () => {
  let finish!: (path: string) => void;
  mocks.resolve.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(Harness)));
  await act(async () => actions.open?.("/repo/demo.mp4"));
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!
      .click(),
  );
  await act(async () => finish("/repo/demo.mp4"));
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
