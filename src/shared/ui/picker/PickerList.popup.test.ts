// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PickerList } from "./PickerList";
import type { PickerOption } from "./usePickerList";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function optionsFor(expanded: boolean, onAction: () => void): PickerOption[] {
  return [
    { value: "current", title: "Current checkout" },
    {
      value: "existing",
      title: "Existing worktree…",
      onAction,
      popup: { listId: "flyout-worktrees", expanded },
    },
  ];
}

it("keeps an action row that opens a popup a plain option, not an invalid-ARIA trigger", async () => {
  const onAction = vi.fn();
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Workspace",
        value: "current",
        onChange: vi.fn(),
        options: optionsFor(false, onAction),
      }),
    ),
  );
  const row = container.querySelector<HTMLElement>("[data-picker-action]")!;
  // aria-haspopup/aria-expanded are not allowed on role="option"; the link is aria-controls only.
  expect(row.hasAttribute("aria-haspopup")).toBe(false);
  expect(row.hasAttribute("aria-expanded")).toBe(false);
  expect(row.hasAttribute("aria-controls")).toBe(false);
  expect(row.hasAttribute("aria-selected")).toBe(false);
  expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
});

it("links the trigger to its flyout list only while the flyout is expanded", async () => {
  const onAction = vi.fn();
  const render = (expanded: boolean) =>
    act(async () =>
      root.render(
        createElement(PickerList, {
          label: "Workspace",
          value: "current",
          onChange: vi.fn(),
          options: optionsFor(expanded, onAction),
        }),
      ),
    );
  await render(true);
  const row = container.querySelector<HTMLElement>("[data-picker-action]")!;
  expect(row.getAttribute("aria-controls")).toBe("flyout-worktrees");
  await render(false);
  const collapsed = container.querySelector<HTMLElement>("[data-picker-action]")!;
  expect(collapsed.hasAttribute("aria-controls")).toBe(false);
});

it("keeps the action row committing its action rather than changing the selection", async () => {
  const onAction = vi.fn();
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Workspace",
        value: "current",
        onChange,
        options: optionsFor(false, onAction),
      }),
    ),
  );
  await act(async () => container.querySelector<HTMLElement>("[data-picker-action]")!.click());
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});
