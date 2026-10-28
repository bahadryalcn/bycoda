// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleEditorFindKey } from "../editor/editorSearch";
import { FilePreviewSearch, findPreviewTextMatches } from "./FilePreviewSearch";
import { saveKeybindingOverride } from "../../settings/model/settings";
import { evaluatePreviewSearch } from "./previewSearchEvaluation";
import { Worker as NodeWorker } from "node:worker_threads";

// Execute the same evaluator in a real isolated thread under happy-dom.
class SearchWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  private worker = new NodeWorker(
    `const { parentPort } = require('node:worker_threads'); const evaluate = ${evaluatePreviewSearch.toString()}; parentPort.on('message', data => parentPort.postMessage(evaluate(...data)));`,
    { eval: true },
  );
  constructor() {
    this.worker.on("message", (data) => this.onmessage?.({ data }));
    this.worker.on("error", () => this.onerror?.());
  }
  postMessage(data: unknown) {
    this.worker.postMessage(data);
  }
  terminate() {
    void this.worker.terminate();
  }
}

const options = {
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

describe("findPreviewTextMatches", () => {
  beforeEach(() => vi.stubGlobal("Worker", SearchWorker));
  afterEach(() => vi.unstubAllGlobals());
  it("finds literal text case-insensitively", async () => {
    expect((await findPreviewTextMatches("Alpha beta ALPHA", "alpha", options)).matches).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
  });

  it("supports whole-word and regular-expression searches", async () => {
    expect(
      (
        await findPreviewTextMatches("cat scatter cat", "cat", {
          ...options,
          wholeWord: true,
        })
      ).matches,
    ).toEqual([
      { from: 0, to: 3 },
      { from: 12, to: 15 },
    ]);
    expect(
      (
        await findPreviewTextMatches("item-12 item-aa", "item-\\d+", {
          ...options,
          regexp: true,
        })
      ).matches,
    ).toEqual([{ from: 0, to: 7 }]);
  });

  it("reports an invalid regular expression", async () => {
    expect(await findPreviewTextMatches("text", "[", { ...options, regexp: true })).toMatchObject({
      matches: [],
      invalid: true,
    });
  });
  it("terminates a pathological regex while the UI thread stays responsive", async () => {
    let responsive = false;
    const task = findPreviewTextMatches("a".repeat(30) + "!", "(a+)+$", {
      ...options,
      regexp: true,
    });
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        responsive = true;
        resolve();
      }, 10),
    );
    expect(responsive).toBe(true);
    expect(await task).toMatchObject({ matches: [], timedOut: true });
  });
});

describe("FilePreviewSearch", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["Markdown önizlemesi", "Aperçu Markdown"])("returns find focus to the document named %s", async (label) => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
    const flushFocus = () => act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    });
    const preview = createElement("div", { className: "markdown-preview", tabIndex: 0, "aria-label": label }, "Alpha");
    const renderPreview = (active: boolean) => act(async () => root.render(
      createElement(FilePreviewSearch, { active, contentVersion: "Alpha" }, preview),
    ));
    await renderPreview(true);
    await act(async () => {
      handleEditorFindKey(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
    });
    flushFocus();
    expect(document.activeElement?.tagName).toBe("INPUT");
    await act(async () => {
      handleEditorFindKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    flushFocus();
    expect(document.activeElement).toBe(container.querySelector(".markdown-preview"));

    // A pane switch before the scheduled focus return must retire that frame.
    await act(async () => {
      handleEditorFindKey(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
    });
    flushFocus();
    await act(async () => {
      handleEditorFindKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await renderPreview(false);
    const focus = vi.spyOn(container.querySelector<HTMLElement>(".markdown-preview")!, "focus");
    flushFocus();
    expect(focus).not.toHaveBeenCalled();
  });

  it("opens from a custom find shortcut instead of the default", async () => {
    saveKeybindingOverride("Editor: Find", { shortcut: "Control+Shift+KeyM" });
    await act(async () =>
      root.render(
        createElement(
          FilePreviewSearch,
          { active: true, contentVersion: "Alpha" },
          createElement(
            "div",
            { className: "markdown-preview", "aria-label": "Markdown preview" },
            createElement("p", null, "Alpha"),
          ),
        ),
      ),
    );

    const custom = new KeyboardEvent("keydown", {
      code: "KeyM",
      key: "M",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    await act(async () => {
      expect(handleEditorFindKey(custom)).toBe(true);
    });
    expect(custom.defaultPrevented).toBe(true);
    expect(container.querySelector("[data-file-preview-search-open]")).not.toBeNull();

    await act(async () => {
      handleEditorFindKey(
        new KeyboardEvent("keydown", {
          code: "Escape",
          key: "Escape",
          cancelable: true,
        }),
      );
    });
    await act(async () => {
      handleEditorFindKey(
        new KeyboardEvent("keydown", {
          code: "KeyF",
          key: "f",
          ctrlKey: true,
          cancelable: true,
        }),
      );
    });
    expect(container.querySelector("[data-file-preview-search-open]")).toBeNull();
  });

  it("opens from the find shortcut and navigates rendered matches", async () => {
    await act(async () =>
      root.render(
        createElement(
          FilePreviewSearch,
          { active: true, contentVersion: "Alpha beta alpha" },
          createElement(
            "div",
            { className: "markdown-preview", "aria-label": "Markdown preview" },
            createElement("p", null, "Alpha ", createElement("strong", null, "beta")),
            createElement("p", null, "alpha"),
          ),
        ),
      ),
    );

    const shortcut = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      cancelable: true,
    });
    await act(async () => {
      expect(handleEditorFindKey(shortcut)).toBe(true);
    });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(container.querySelector("[data-file-preview-search-open]")).not.toBeNull();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Find"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Alpha beta",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("1 of 1");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "alpha",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("1 of 2");

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.textContent).toContain("2 of 2");
    expect(input.closest("[data-ui-focus-group]")?.getAttribute("data-search-appearance")).toBe(
      "field",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "missing",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No results");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const clear = container.querySelector<HTMLButtonElement>("[data-search-clear]")!;
    await act(async () => clear.click());
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(document.activeElement).toBe(input);

    await act(async () => {
      expect(
        handleEditorFindKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })),
      ).toBe(true);
    });
    expect(container.querySelector('[role="search"]')).toBeNull();
    expect(container.querySelector("[data-file-preview-search-open]")).toBeNull();
  });
});
