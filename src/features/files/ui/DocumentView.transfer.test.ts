// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentView } from "./DocumentView";

// Regression for #930: a remote document shows byte progress and Cancel from the shared
// transfer path; local documents and attachment reads keep their indeterminate opening state.

const fs = vi.hoisted(() => ({ prepare: vi.fn(), readBinaryFile: vi.fn() }));

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  prepareLocalFile: fs.prepare,
  readBinaryFile: fs.readBinaryFile,
}));
vi.mock("../model/fileWatch", () => ({ watchFile: () => () => {} }));

const REMOTE = "remote://mac/docs/report.pdf";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
});

async function render(props: { path: string; readBytes?: () => Promise<Uint8Array> }) {
  await act(async () => {
    root.render(createElement(DocumentView, { cwd: "/repo", ...props }));
  });
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

describe("DocumentView remote transfer", () => {
  it("shows byte progress for a remote document and bounds the copy at 25 MB", async () => {
    fs.prepare.mockImplementation(() => new Promise<string>(() => {}));
    await render({ path: REMOTE });

    expect(fs.prepare).toHaveBeenCalledWith(
      REMOTE,
      expect.objectContaining({ signal: expect.any(AbortSignal), maxBytes: 25 * 1024 * 1024 }),
    );
    await act(async () => fs.prepare.mock.calls[0][1].onProgress(5, 20));
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuemax")).toBe("20");
    expect(bar.getAttribute("aria-valuenow")).toBe("5");
    expect(button("Cancel")).toBeDefined();
  });

  it("aborts on Cancel without an error and Retry copies again", async () => {
    fs.prepare.mockImplementationOnce(
      (_path: string, options: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError")),
          );
        }),
    );
    await render({ path: REMOTE });
    const signal = fs.prepare.mock.calls[0][1].signal as AbortSignal;

    await act(async () => button("Cancel")!.click());

    expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Opening cancelled");
    expect(fs.readBinaryFile).not.toHaveBeenCalled();

    fs.prepare.mockImplementation(() => new Promise<string>(() => {}));
    await act(async () => button("Retry")!.click());
    expect(fs.prepare).toHaveBeenCalledTimes(2);
    expect(button("Cancel")).toBeDefined();
  });

  it("reads only the prepared local copy after the transfer", async () => {
    fs.prepare.mockResolvedValue("C:/cache/report.pdf");
    fs.readBinaryFile.mockRejectedValue(new Error("stop here"));
    await render({ path: REMOTE });

    expect(fs.readBinaryFile).toHaveBeenCalledOnce();
    expect(fs.readBinaryFile).toHaveBeenCalledWith("C:/cache/report.pdf");
  });

  it("keeps local documents and attachment reads indeterminate with nothing to cancel", async () => {
    fs.readBinaryFile.mockImplementation(() => new Promise<Uint8Array>(() => {}));
    await render({ path: "/repo/docs/report.pdf" });
    expect(fs.prepare).not.toHaveBeenCalled();
    expect(button("Cancel")).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    await render({
      path: REMOTE,
      readBytes: () => new Promise<Uint8Array>(() => {}),
    });
    expect(fs.prepare).not.toHaveBeenCalled();
    expect(button("Cancel")).toBeUndefined();
  });
});
