// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaVisibilityContext } from "../model/mediaVisibility";
import { DocumentView } from "./DocumentView";

// Regression for #610: a document viewer that stays mounted behind another tab reads
// nothing until it is first shown and reloads a change seen while covered only on show.

const fs = vi.hoisted(() => ({ readBinaryFile: vi.fn() }));
const watch = vi.hoisted(() => ({ listener: null as null | (() => void), stop: vi.fn() }));

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  readBinaryFile: fs.readBinaryFile,
}));
vi.mock("../model/fileWatch", () => ({
  watchFile: (_path: string, onChange: () => void) => {
    watch.listener = onChange;
    return watch.stop;
  },
}));

const PATH = "/repo/docs/legacy.docx";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fs.readBinaryFile.mockReset();
  fs.readBinaryFile.mockImplementation(() => new Promise<Uint8Array>(() => {}));
  watch.listener = null;
  watch.stop.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(visible: boolean, paneVisible = true) {
  act(() => {
    root.render(
      createElement(
        MediaVisibilityContext.Provider,
        { value: paneVisible },
        createElement(DocumentView, { path: PATH, cwd: "/repo", visible }),
      ),
    );
  });
}

const fileChanged = () =>
  act(() => {
    watch.listener?.();
    vi.advanceTimersByTime(60);
  });

describe("DocumentView visibility", () => {
  it("does not read a viewer that was never shown, and reads once when first shown", () => {
    render(false);
    expect(fs.readBinaryFile).not.toHaveBeenCalled();

    render(true);
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();
  });

  it("waits for the owning pane as well as the tab", () => {
    render(true, false);
    expect(fs.readBinaryFile).not.toHaveBeenCalled();

    render(true, true);
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();
  });

  it("defers a change seen while covered to one reload on the next show", () => {
    render(true);
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();

    render(false);
    fileChanged();
    fileChanged();
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();

    render(true);
    expect(fs.readBinaryFile).toHaveBeenCalledTimes(2);
  });

  it("reloads a change seen while shown without waiting for a visibility change", () => {
    render(true);
    fileChanged();
    expect(fs.readBinaryFile).toHaveBeenCalledTimes(2);
  });

  it("does not re-read when shown again with nothing changed", () => {
    render(true);
    render(false);
    render(true);
    expect(fs.readBinaryFile).toHaveBeenCalledOnce();
  });
});
