// @vitest-environment happy-dom
import type { MergeView } from "@codemirror/merge";
import { afterEach, describe, expect, it } from "vitest";
import { editorThemeFor } from "./editorChrome";
import {
  createSplitDiff,
  setSplitOriginal,
  splitLineStats,
  splitNavigablePositions,
} from "./editorSplitDiff";

describe("split diff", () => {
  let split: MergeView | null = null;
  afterEach(() => {
    split?.destroy();
    split = null;
  });

  function create(original: string, doc: string) {
    split = createSplitDiff({
      parent: document.body,
      original,
      doc,
      extensions: [editorThemeFor("dark")],
      originalExtensions: [editorThemeFor("dark")],
    });
    return split;
  }

  it("starts one hunk at each changed region of the right pane", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const edited = lines.map((line, i) => (i === 3 ? "changed" : i === 20 ? "also changed" : line));
    const view = create(lines.join("\n"), edited.join("\n"));
    expect(splitNavigablePositions(view)).toEqual([
      edited.slice(0, 3).join("\n").length + 1,
      edited.slice(0, 20).join("\n").length + 1,
    ]);
    expect(splitLineStats(view)).toEqual({ additions: 2, deletions: 2 });
  });

  it("counts a removed block as deletions only", () => {
    const view = create("a\nb\nc\nd", "a\nd");
    expect(splitLineStats(view)).toEqual({ additions: 0, deletions: 2 });
    expect(splitNavigablePositions(view)).toHaveLength(1);
  });

  it("treats an empty before as an all-added file", () => {
    const view = create("", "x\ny\n");
    expect(splitLineStats(view)).toEqual({ additions: 2, deletions: 0 });
    expect(splitNavigablePositions(view)).toEqual([0]);
  });

  it("has no hunks when both sides match", () => {
    const view = create("same\ntext", "same\ntext");
    expect(splitNavigablePositions(view)).toEqual([]);
  });

  it("lets vertical gestures over either code pane reach the shared scroller", () => {
    const view = create("before", "after");
    for (const pane of [view.a, view.b]) {
      expect(getComputedStyle(pane.scrollDOM).overscrollBehaviorY).toBe("auto");
    }
    expect(view.dom.style.overscrollBehavior).toBe("none");
  });

  it("routes wheel and diagonal touchpad deltas from both panes to the shared viewport", () => {
    const view = create("before", "after");
    Object.defineProperties(view.dom, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 400 },
    });
    for (const pane of [view.a, view.b]) {
      for (const target of [pane.contentDOM, pane.contentDOM.firstElementChild!]) {
        const top = view.dom.scrollTop;
        const wheel = new WheelEvent("wheel", {
          deltaY: 50,
          deltaX: 12,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(true);
        expect(view.dom.scrollTop).toBe(top + 50);
      }
      expect(pane.scrollDOM.scrollLeft).toBe(24);
      const zoom = new WheelEvent("wheel", {
        deltaY: 50,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(zoom, "ctrlKey", { value: true });
      const top = view.dom.scrollTop;
      pane.contentDOM.dispatchEvent(zoom);
      expect(zoom.defaultPrevented).toBe(false);
      expect(view.dom.scrollTop).toBe(top);
    }
    view.a.contentDOM.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1,
        deltaMode: 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.dom.scrollTop).toBe(600);
    view.b.contentDOM.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -1000,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.dom.scrollTop).toBe(0);
  });

  it("re-diffs when the before text changes and reports whether it did", () => {
    const view = create("a\nb\nc", "a\nB\nc");
    expect(splitNavigablePositions(view)).toHaveLength(1);
    expect(setSplitOriginal(view, "a\nb\nc")).toBe(false);
    expect(setSplitOriginal(view, "a\nB\nc")).toBe(true);
    expect(view.a.state.doc.toString()).toBe("a\nB\nc");
    expect(splitNavigablePositions(view)).toEqual([]);
  });
});
