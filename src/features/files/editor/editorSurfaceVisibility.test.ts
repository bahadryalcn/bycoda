// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginResizeGesture } from "../../../shared/lib/resizeGesture";
import { editorSurfaceActive, observeEditorSurface } from "./editorSurfaceVisibility";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("editor surface visibility", () => {
  let pane: HTMLDivElement;
  let editor: HTMLDivElement;
  let onChange: ReturnType<typeof vi.fn<() => void>>;
  let stop: () => void;

  beforeEach(() => {
    pane = document.createElement("div");
    editor = document.createElement("div");
    pane.append(editor);
    document.body.append(pane);
    onChange = vi.fn<() => void>();
    stop = observeEditorSurface(editor, onChange);
  });

  afterEach(() => {
    stop();
    pane.remove();
    vi.restoreAllMocks();
  });

  it("ignores geometry-only style writes on an ancestor", async () => {
    pane.style.width = "300px";
    pane.style.left = "10px";
    pane.style.flexBasis = "40%";
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still reports an inline display, class or attribute hide and show", async () => {
    pane.style.display = "none";
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    pane.style.display = "";
    await settle();
    expect(onChange).toHaveBeenCalledTimes(2);
    pane.hidden = true;
    await settle();
    expect(onChange).toHaveBeenCalledTimes(3);
    pane.className = "retained";
    await settle();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("does not resolve ancestor styles again on every query during a resize gesture", () => {
    const computed = vi.spyOn(window, "getComputedStyle");
    const end = beginResizeGesture();
    try {
      expect(editorSurfaceActive(editor)).toBe(true);
      const first = computed.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      editorSurfaceActive(editor);
      editorSurfaceActive(editor);
      expect(computed.mock.calls.length).toBe(first);
    } finally {
      end();
    }
    // Outside a gesture every query is fresh.
    editorSurfaceActive(editor);
    expect(computed.mock.calls.length).toBeGreaterThan(0);
  });

  it("drops the remembered answer when a visibility mutation arrives mid-gesture", async () => {
    const end = beginResizeGesture();
    try {
      expect(editorSurfaceActive(editor)).toBe(true);
      pane.style.display = "none";
      await settle();
      expect(editorSurfaceActive(editor)).toBe(false);
    } finally {
      end();
    }
  });
});
