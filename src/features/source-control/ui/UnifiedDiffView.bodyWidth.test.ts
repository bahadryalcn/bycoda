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

it.each(["workspace", "embedded PR"])(
  "installs text selection on rendered %s patches and leaves unvisited placeholders inert",
  async (surface) => {
    const visibility = new Map<Element, (entries: unknown[]) => void>();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private notifyIntersection: (entries: unknown[]) => void) {}
        observe(node: Element) {
          visibility.set(node, this.notifyIntersection);
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, this.dataset.diffFile === "far" ? 10000 : 0, 600, 600);
    });
    const diff = buildUnifiedFile("old", "new");
    await act(async () =>
      root.render(
        createElement(UnifiedDiffView, {
          files: ["near", "far"].map((path) => ({ ...diff, id: path, label: path, path })),
          ...(surface === "embedded PR"
            ? { fill: false, fileLayout: "cards" as const, initialExpansion: "first" as const }
            : {}),
        }),
      ),
    );
    const far = container.querySelector<HTMLElement>('[data-diff-file="far"]')!;
    if (surface === "embedded PR") {
      await act(async () =>
        far.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(),
      );
    }
    expect(
      container.querySelector('[data-diff-file="near"] [data-selectable-agent-response]'),
    ).not.toBeNull();
    expect(far.querySelector("[data-selectable-agent-response]")).toBeNull();
    await act(async () => visibility.get(far)?.([{ isIntersecting: true }]));
    const selection = far.querySelector("[data-selectable-agent-response]");
    expect(selection?.querySelector("[data-diff-body]")).not.toBeNull();
    await act(async () => visibility.get(far)?.([{ isIntersecting: false }]));
    expect(far.querySelector("[data-selectable-agent-response]")).toBe(selection);
    await act(async () => visibility.get(far)?.([{ isIntersecting: true }]));
    expect(far.querySelector("[data-selectable-agent-response]")).toBe(selection);
  },
);

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
