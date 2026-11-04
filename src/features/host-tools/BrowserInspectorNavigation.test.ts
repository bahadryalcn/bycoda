// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserElementTarget } from "../../shared/lib/browserAnnotation";
import { BrowserInspectorNavigation } from "./BrowserInspectorNavigation";

let root: Root;
let container: HTMLDivElement;
const onTraverse = vi.fn();
const element: BrowserElementTarget = {
  tag: "button",
  nodeId: "scoped-node",
  parentNodeId: "scoped-parent",
  text: "Save",
  selector: "main > button",
  path: "html > body > main > section > div > button",
  ancestry: ["html", "body", "main", "section", "div"].map((tag) => ({ tag, selectorPart: tag })),
  computedStyle: {},
  bounds: { x: 0, y: 0, width: 30, height: 20 },
  center: { x: 15, y: 10 },
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onTraverse.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(target = element, disabled = false) {
  await act(async () =>
    root.render(
      createElement(BrowserInspectorNavigation, { element: target, disabled, onTraverse }),
    ),
  );
}

it("maps visible ancestry to nearest-first Host indices, even when deep ancestors are collapsed", async () => {
  await render();
  const crumbs = [
    ...container.querySelectorAll<HTMLButtonElement>(".browser-inspector-breadcrumbs button"),
  ];
  expect(crumbs.map((button) => button.textContent)).toEqual(["body", "main", "section", "div"]);
  await act(async () => crumbs[0].click());
  expect(onTraverse).toHaveBeenLastCalledWith("ancestor", 3);
  await act(async () => crumbs[3].click());
  expect(onTraverse).toHaveBeenLastCalledWith("ancestor", 0);
});

it("does not navigate a stale or unavailable selection", async () => {
  await render(element, true);
  const parent = container.querySelector<HTMLButtonElement>('[aria-label="Select parent"]')!;
  await act(async () => parent.click());
  expect(onTraverse).not.toHaveBeenCalled();
  await render({ ...element, nodeId: undefined });
  expect(container.querySelector("button")).toBeNull();
});

it("exposes named relative navigation without activating a page element", async () => {
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Select next sibling"]')!.click(),
  );
  expect(onTraverse).toHaveBeenCalledWith("nextSibling");
  await render({ ...element, parentNodeId: undefined });
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Select parent"]')!.disabled).toBe(
    true,
  );
});
