// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BinaryFileView } from "./BinaryFileView";

// Regression for #930: a remote image copies through the shared transfer path with byte
// progress and Cancel; local images keep the direct bounded read with nothing to cancel.

const fs = vi.hoisted(() => ({ prepare: vi.fn(), readBinaryFile: vi.fn() }));

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  prepareLocalFile: fs.prepare,
  readBinaryFile: fs.readBinaryFile,
}));
vi.mock("../model/fileWatch", () => ({ watchFile: () => () => {} }));
vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: false, IS_WIN: false }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REMOTE = "remote://mac/shots/a.png";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  fs.prepare.mockReset();
  fs.readBinaryFile.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(path: string) {
  await act(async () => {
    root.render(createElement(BinaryFileView, { path, cwd: "/repo" }));
  });
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

describe("BinaryFileView remote transfer", () => {
  it("copies a remote image with byte progress and reads only the prepared copy", async () => {
    let finish!: (local: string) => void;
    fs.prepare.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    fs.readBinaryFile.mockResolvedValue(PNG);
    await render(REMOTE);

    expect(fs.prepare).toHaveBeenCalledWith(
      REMOTE,
      expect.objectContaining({ signal: expect.any(AbortSignal), maxBytes: 10 * 1024 * 1024 }),
    );
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
    const options = fs.prepare.mock.calls[0][1];
    await act(async () => options.onProgress(512, 1024));
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuemax")).toBe("1024");
    expect(bar.getAttribute("aria-valuenow")).toBe("512");
    expect(button("Cancel")).toBeDefined();

    await act(async () => finish("C:/cache/a.png"));
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();
    expect(fs.readBinaryFile).toHaveBeenCalledWith("C:/cache/a.png");
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("aborts the copy on Cancel, shows no error, and Retry starts a new copy", async () => {
    fs.prepare.mockImplementationOnce(
      (_path: string, options: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    );
    await render(REMOTE);
    const signal = fs.prepare.mock.calls[0][1].signal as AbortSignal;

    await act(async () => button("Cancel")!.click());

    expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Opening cancelled");
    expect(fs.readBinaryFile).not.toHaveBeenCalled();

    fs.prepare.mockResolvedValueOnce("C:/cache/a.png");
    fs.readBinaryFile.mockResolvedValue(PNG);
    await act(async () => button("Retry")!.click());
    expect(fs.prepare).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("aborts the copy when the viewer unmounts", async () => {
    fs.prepare.mockImplementation(() => new Promise<string>(() => {}));
    await render(REMOTE);
    const signal = fs.prepare.mock.calls[0][1].signal as AbortSignal;

    act(() => root.unmount());
    root = createRoot(container);

    expect(signal.aborted).toBe(true);
  });

  it("keeps a local image on the direct read with nothing to cancel", async () => {
    let finish!: (bytes: Uint8Array) => void;
    fs.readBinaryFile.mockImplementation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    await render("/repo/art/a.png");

    expect(fs.prepare).not.toHaveBeenCalled();
    expect(fs.readBinaryFile).toHaveBeenCalledWith("/repo/art/a.png");
    expect(button("Cancel")).toBeUndefined();
    await act(async () => finish(PNG));
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("surfaces the bound rejection from the transfer instead of a progress bar", async () => {
    fs.prepare.mockRejectedValue(new Error("File is too large to preview (maximum 10 MB)."));
    await render(REMOTE);

    expect(container.textContent).toContain("File is too large to preview");
    expect(fs.readBinaryFile).not.toHaveBeenCalled();
  });

  it("quietly retries the read when the Host restarts during a preview transfer", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    fs.prepare.mockImplementation(async () => {
      if (Date.now() - startedAt < 5_000) throw new Error("Host is stopping.");
      return "C:/cache/a.png";
    });
    fs.readBinaryFile.mockResolvedValue(PNG);
    await render(REMOTE);
    for (const elapsed of [2_000, 3_000, 1_000]) {
      await act(async () => vi.advanceTimersByTimeAsync(elapsed));
      expect(container.textContent).not.toContain("Couldn’t open");
    }
    expect(fs.prepare).toHaveBeenCalledTimes(3);
    expect(container.querySelector("img")).not.toBeNull();
  });
});
