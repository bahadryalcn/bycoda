// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newFileTab } from "../model/layout";
import {
  applyWindowDragPreview,
  getExternalPaneDrop,
  paneDropFromPoint,
  setExternalPaneDrop,
} from "../model/paneDrop";
import { beginWindowTabDrag } from "../../../app/model/windowDragPreview";
import { SurfaceTabs } from "./SurfaceTabs";

vi.mock("../../../app/model/windowDragPreview", () => ({
  beginWindowTabDrag: vi.fn(() => ({ move: vi.fn(), finish: vi.fn() })),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setExternalPaneDrop(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(target: EventTarget, type: string, x: number) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: 15,
        screenX: x + 1000,
        screenY: 215,
      }),
    ),
  );
}

describe("editor tab docking", () => {
  it.each([false, true])(
    "previews precise insertion and preserves unsaved files (dirty=%s)",
    (dirty) => {
      const file = newFileTab("/repo/source.ts", "/repo");
      const targetFile = newFileTab("/repo/target.ts", "/repo");
      const onMoveFile = vi.fn();
      const onReorder = vi.fn();
      const base = {
        fileErrorCounts: new Map(),
        onCloseFile: vi.fn(),
        onCloseOtherFiles: vi.fn(),
        onSelectFile: vi.fn(),
        onReorder,
        onMoveFile,
      };
      act(() =>
        root.render(
          createElement(
            "div",
            {},
            createElement(SurfaceTabs, {
              ...base,
              files: [file],
              activeFileId: file.id,
              dirtyFileIds: new Set(dirty ? [file.id] : []),
              paneId: "source",
            }),
            createElement(SurfaceTabs, {
              ...base,
              files: [targetFile],
              activeFileId: targetFile.id,
              dirtyFileIds: new Set(),
              paneId: "target",
            }),
          ),
        ),
      );
      const source = container.querySelector<HTMLElement>(`[data-surface-tab-id="${file.id}"]`)!;
      const target = container.querySelector<HTMLElement>(
        `[data-surface-tab-id="${targetFile.id}"]`,
      )!;
      let captured = false;
      Object.assign(source, {
        setPointerCapture: () => {
          captured = true;
        },
        hasPointerCapture: () => captured,
        releasePointerCapture: () => {
          captured = false;
        },
      });
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 30));
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 0, 100, 30));
      vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
      expect(paneDropFromPoint(210, 15)).toEqual({
        id: "target",
        edge: "center",
        targetFileId: targetFile.id,
        tabPosition: "before",
      });
      act(() => applyWindowDragPreview("window:generic", 210, 15));
      expect(getExternalPaneDrop()).toMatchObject({
        edge: "center",
        targetFileId: undefined,
        tabPosition: undefined,
      });
      act(() => applyWindowDragPreview("window:file", 210, 15, false, true));
      expect(getExternalPaneDrop()).toMatchObject({
        targetFileId: targetFile.id,
        tabPosition: "before",
      });
      pointer(source, "pointerdown", 50);
      pointer(window, "pointermove", 210);
      expect(getExternalPaneDrop()).toMatchObject({
        overId: "target",
        targetFileId: targetFile.id,
        tabPosition: "before",
        invalid: dirty,
      });
      expect(container.querySelector('[data-file-tab-drop="before"]')).not.toBeNull();
      pointer(window, "pointerup", 210);
      if (dirty) expect(onMoveFile).not.toHaveBeenCalled();
      else
        expect(onMoveFile).toHaveBeenCalledWith(
          file.id,
          "target",
          "center",
          targetFile.id,
          "before",
        );
      expect(onReorder).not.toHaveBeenCalled();
      expect(getExternalPaneDrop()).toBeNull();
      expect(document.querySelector(".pointer-drop-hint")).toBeNull();
    },
  );

  it.each(["drop", "cancel"])(
    "routes a saved file outside the window and ends native preview on %s",
    (action) => {
      vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(1.75);
      const file = newFileTab("/repo/source.ts", "/repo");
      const onOpenInNewWindow = vi.fn();
      act(() =>
        root.render(
          createElement(SurfaceTabs, {
            files: [file],
            activeFileId: file.id,
            dirtyFileIds: new Set(),
            fileErrorCounts: new Map(),
            paneId: "source",
            onMoveFile: vi.fn(),
            onCloseFile: vi.fn(),
            onCloseOtherFiles: vi.fn(),
            onSelectFile: vi.fn(),
            onReorder: vi.fn(),
            onOpenInNewWindow,
          }),
        ),
      );
      const source = container.querySelector<HTMLElement>(`[data-surface-tab-id="${file.id}"]`)!;
      let captured = false;
      Object.assign(source, {
        setPointerCapture: () => {
          captured = true;
        },
        hasPointerCapture: () => captured,
        releasePointerCapture: () => {
          captured = false;
        },
      });
      vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 30));
      vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
      const outsideX = window.innerWidth + 30;
      pointer(source, "pointerdown", 50);
      pointer(window, "pointermove", outsideX);
      expect(beginWindowTabDrag).toHaveBeenCalledWith(`file:${file.id}`, [file.id]);
      const native = vi.mocked(beginWindowTabDrag).mock.results[0].value;
      expect(native.move).toHaveBeenCalled();
      if (action === "drop") {
        pointer(window, "pointerup", outsideX);
        expect(onOpenInNewWindow).toHaveBeenCalledWith(file.id, {
          x: outsideX + 880,
          y: 199,
          clientX: outsideX,
          clientY: 15,
          pixelRatio: 1.75,
        });
      } else {
        act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(onOpenInNewWindow).not.toHaveBeenCalled();
      }
      expect(native.finish).toHaveBeenCalled();
      expect(document.querySelector(".pointer-drop-hint")).toBeNull();
      expect(getExternalPaneDrop()).toBeNull();
    },
  );
});
