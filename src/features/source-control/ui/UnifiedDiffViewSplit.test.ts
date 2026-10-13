// @vitest-environment happy-dom
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUnifiedFile } from "../model/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

const lines = (...text: string[]) => text.join("\n");

function model(
  original: string,
  current: string,
  extra: Partial<UnifiedDiffFileModel> = {},
): UnifiedDiffFileModel {
  const diff = buildUnifiedFile(original, current);
  return {
    id: "unstaged:a.txt",
    path: "a.txt",
    label: "a.txt",
    additions: diff.additions,
    deletions: diff.deletions,
    blocks: diff.blocks,
    ...extra,
  };
}

describe("UnifiedDiffView layouts", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", new Storage());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    file: UnifiedDiffFileModel,
    props: Partial<Parameters<typeof UnifiedDiffView>[0]> = {},
  ) {
    await act(async () => root.render(createElement(UnifiedDiffView, { files: [file], ...props })));
  }
  const toggle = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Side-by-side view"]')!;

  it("flips every diff through the shared toggle and preference", async () => {
    await render(model(lines("a", "b", "c"), lines("a", "B", "c")));
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("bycoda.diffLayout")).toBeNull();

    await act(async () => toggle().click());
    expect(localStorage.getItem("bycoda.diffLayout")).toBe("split");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");

    await act(async () => toggle().click());
    expect(localStorage.getItem("bycoda.diffLayout")).toBe("inline");
  });

  it("renders a replacement as paired before and after cells", async () => {
    localStorage.setItem("bycoda.diffLayout", "split");
    await render(model(lines("a", "xold", "yold", "b"), lines("a", "pnew", "b")));
    const [before, after] = Array.from(
      container.querySelectorAll(".overflow-x-auto.overscroll-x-none"),
    ).map((node) => node.textContent ?? "");
    // One scroller per column: removed lines on the left, added on the right,
    // context on both.
    expect(before).toContain("xold");
    expect(before).toContain("yold");
    expect(before).not.toContain("pnew");
    expect(after).toContain("pnew");
    expect(after).not.toContain("xold");
    for (const side of [before, after]) {
      expect(side).toContain("a");
      expect(side).toContain("b");
    }
  });

  it("keeps one scroller in the inline layout", async () => {
    await render(model(lines("a", "x", "b"), lines("a", "p", "b")));
    expect(container.querySelectorAll(".overflow-x-auto.overscroll-x-none")).toHaveLength(1);
  });

  it.each(["inline", "split"])(
    "scrolls %s diffs from code and gutter, preserving touchpad movement",
    async (layout) => {
      localStorage.setItem("bycoda.diffLayout", layout);
      await render(model("old", "new"));
      const scroller = container.querySelector<HTMLElement>(".unified-diff")!;
      Object.defineProperties(scroller, {
        scrollHeight: { configurable: true, value: 2000 },
        clientHeight: { configurable: true, value: 400 },
      });
      const columns = container.querySelectorAll<HTMLElement>(".overflow-x-auto.overscroll-x-none");
      for (const code of columns) {
        const wheel = new WheelEvent("wheel", {
          deltaY: 40,
          deltaX: 12,
          bubbles: true,
          cancelable: true,
        });
        code.dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(true);
        expect(code.scrollLeft).toBe(12);
      }
      expect(scroller.scrollTop).toBe(columns.length * 40);
      const gutter = columns[0].previousElementSibling!;
      gutter.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 3,
          deltaMode: 1,
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(scroller.scrollTop).toBeGreaterThan(columns.length * 40);

      const top = scroller.scrollTop;
      const zoom = new WheelEvent("wheel", {
        deltaY: 50,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      // happy-dom's WheelEvent does not initialize mouse modifier keys.
      Object.defineProperty(zoom, "ctrlKey", { value: true });
      columns[0].dispatchEvent(zoom);
      expect(zoom.defaultPrevented).toBe(false);
      expect(scroller.scrollTop).toBe(top);
    },
  );

  it("still stages a hunk from a split row", async () => {
    localStorage.setItem("bycoda.diffLayout", "split");
    const onStageHunk = vi.fn();
    await render(
      model(lines("a", "x", "y", "b"), lines("a", "p", "b"), {
        canStageHunk: true,
      }),
      { onStageHunk },
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Stage hunk"]',
    );
    // One per changed row: x|p and y|-.
    expect(buttons).toHaveLength(2);
    await act(async () => buttons[0].click());
    expect(onStageHunk).toHaveBeenCalledTimes(1);
    expect(onStageHunk.mock.calls[0][0]).toBe("unstaged:a.txt");
    expect(typeof onStageHunk.mock.calls[0][1]).toBe("number");
  });

  it("keeps file actions and placeholders in the split layout", async () => {
    localStorage.setItem("bycoda.diffLayout", "split");
    const onStageFile = vi.fn();
    const onDiscardFile = vi.fn();
    await render(model("", "", { binary: true, canStage: true, canDiscard: true }), {
      onStageFile,
      onDiscardFile,
    });
    expect(container.textContent).toContain("Binary file changed");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Stage file"]')!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Discard file"]')!.click(),
    );
    expect(onStageFile).toHaveBeenCalledWith("unstaged:a.txt");
    expect(onDiscardFile).toHaveBeenCalledWith("unstaged:a.txt");
  });

  it("draws a fold bar once, across both columns", async () => {
    localStorage.setItem("bycoda.diffLayout", "split");
    const original = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    await render(model(original, original.replace("l0", "first")));
    expect(container.querySelectorAll('button[aria-label^="Expand unmodified"]')).toHaveLength(2); // up and down, from the single bar
    expect(container.textContent).toContain("unmodified");
  });
});
