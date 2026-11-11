// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../files/editor/syntaxTokens", () => ({
  highlightDiffFile: vi.fn(() => Promise.resolve(null)),
}));

import { buildUnifiedFile } from "../model/unifiedDiff";
import { UnifiedDiffView } from "./UnifiedDiffView";

let container: HTMLDivElement;
let root: Root;
let notify: Array<(entries: unknown[]) => void>;

beforeEach(() => {
  notify = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        notify.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("rewrites --unified-body-width only when the body width changed", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 600),
  );
  let width = 400;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
  const widthWrites = () =>
    writes.mock.calls.filter(([name]) => name === "--unified-body-width").length;
  const diff = buildUnifiedFile("alpha\nbeta\n", "alpha\nBETA\n");
  await act(async () =>
    root.render(
      createElement(UnifiedDiffView, {
        files: [
          {
            id: "w.ts",
            path: "w.ts",
            label: "w.ts",
            additions: diff.additions,
            deletions: diff.deletions,
            blocks: diff.blocks,
          },
        ],
      }),
    ),
  );
  const body = container.querySelector<HTMLElement>("[style*='--unified-body-width']");
  expect(body?.style.getPropertyValue("--unified-body-width")).toBe("400px");
  const afterMount = widthWrites();

  // A height-only resize reports the observer again with the same width.
  act(() => notify.forEach((callback) => callback([])));
  expect(widthWrites()).toBe(afterMount);

  width = 450;
  act(() => notify.forEach((callback) => callback([])));
  expect(widthWrites()).toBe(afterMount + 1);
  expect(body?.style.getPropertyValue("--unified-body-width")).toBe("450px");
});
