// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { useExternalFileDrop } from "./useExternalFileDrop";

const native = vi.hoisted(() => ({ listen: vi.fn(), directory: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: native.listen }),
}));
vi.mock("../../../platform/tauri/fs", () => ({ isLocalDirectory: native.directory }));
vi.mock("../../../features/files/ui/FileEditor", () => ({ FileEditor: () => null }));
vi.mock("../../../shared/lib/dragPoint", () => ({
  dragPointToClient: (x: number, y: number) => ({ x: x / 2, y: y / 2 }),
}));

let root: Root;
let container: HTMLDivElement;
let handler: (event: { payload: DragDropEvent }) => void;
let target: HTMLElement;
const stop = vi.fn();
const open = vi.fn();

function Harness({ callback = open }: { callback?: typeof open }) {
  useExternalFileDrop(callback);
  return null;
}

async function drop(paths: string[]) {
  await act(async () => {
    handler({ payload: { type: "drop", paths, position: { x: 80, y: 120 } } as DragDropEvent });
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  target = document.createElement("div");
  container.append(target);
  vi.spyOn(document, "elementFromPoint").mockImplementation(() => target);
  native.directory.mockResolvedValue(false);
  native.listen.mockImplementation(async (callback) => {
    handler = callback;
    return stop;
  });
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("external native file drops", () => {
  it("opens every format in a pinned tab with the original path and local parent", async () => {
    const paths = ["md", "png", "html", "txt", "json", "pdf", "xlsx"].map(
      (ext) => `C:\\Users\\owner\\file.${ext}`,
    );
    await drop(paths);
    expect(open).toHaveBeenCalledTimes(paths.length);
    for (const path of paths) {
      expect(open).toHaveBeenCalledWith(
        path,
        undefined,
        { exact: true, pin: true },
        {
          cwd: "C:/Users/owner",
          projectCwd: "",
          external: true,
        },
      );
    }
    expect(document.elementFromPoint).toHaveBeenCalledWith(40, 60);
  });

  it.each(["data-composer-box", "data-external-drop-owner"])(
    "preserves the %s target's existing drop behavior",
    async (attribute) => {
      const parent = document.createElement("div");
      parent.setAttribute(attribute, "");
      container.append(parent);
      parent.append(target);
      await drop(["C:/file.txt"]);
      expect(open).not.toHaveBeenCalled();
      expect(native.directory).not.toHaveBeenCalled();
    },
  );

  it("ignores folders, relative and remote paths, and duplicate Windows paths", async () => {
    native.directory.mockImplementation(async (path) => path === "C:/folder");
    await drop([
      "C:/folder",
      "C:/file.txt",
      "c:/FILE.txt",
      "relative.txt",
      "remote://mac/file.txt",
    ]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("c:/FILE.txt");
  });

  it("opens from the session background without attaching or assigning a project", async () => {
    container.setAttribute("data-session-drop", "session-1");
    await drop(["C:/Users/owner/file.json"]);
    expect(open).toHaveBeenCalledWith(
      "C:/Users/owner/file.json",
      undefined,
      { exact: true, pin: true },
      {
        cwd: "C:/Users/owner",
        projectCwd: "",
        external: true,
      },
    );
  });

  it("uses the current callback without resubscribing and unregisters on unmount", async () => {
    const updated = vi.fn();
    await act(async () => root.render(createElement(Harness, { callback: updated })));
    await drop(["/Users/owner/report.pdf"]);
    expect(open).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledTimes(1);
    expect(native.listen).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not open a file if unmounted while checking the path", async () => {
    let resolve!: (directory: boolean) => void;
    native.directory.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    await drop(["C:/file.txt"]);
    await act(async () => root.unmount());
    await act(async () => resolve(false));
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a ready file without waiting for another dropped path's slow metadata", async () => {
    let finish!: (directory: boolean) => void;
    native.directory.mockImplementation((path) =>
      path === "C:/slow.pdf"
        ? new Promise<boolean>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(false),
    );
    await drop(["C:/slow.pdf", "C:/ready.txt"]);
    expect(native.directory).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe("C:/ready.txt");
    await act(async () => finish(false));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1][0]).toBe("C:/slow.pdf");
  });
});
