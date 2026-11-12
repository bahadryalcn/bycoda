// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const groups = [
  {
    label: "Standard",
    options: [
      { value: "a", label: "Alpha" },
      { value: "blocked", label: "Blocked", disabled: true },
      { value: "b", label: "Beta" },
    ],
  },
  { label: "Extended", options: [{ value: "c", label: "Gamma", keywords: "last" }] },
];
const options = groups.flatMap((group) =>
  group.options.map((option) => ({ ...option, group: group.label })),
);
const key = (element: Element, key: string, composing = false) =>
  act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      }),
    ),
  );
it("keeps grouped keyboard navigation, disabled choices and native trigger ref/events", () => {
  const ref = createRef<HTMLButtonElement>(),
    change = vi.fn(),
    close = vi.fn(),
    mouse = vi.fn((e: React.MouseEvent) => e.preventDefault());
  act(() =>
    root.render(
      createElement(SearchableSelect, {
        variant: "pill",
        hideLabel: true,
        searchable: false,
        loopNavigation: true,
        label: "Mode",
        value: "a",
        options,
        onChange: change,
        onClose: close,
        triggerProps: { ref, onMouseDown: mouse },
      }),
    ),
  );
  const trigger = ref.current!;
  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.type).toBe("button");
  act(() =>
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })),
  );
  expect(mouse).toHaveBeenCalledOnce();
  act(() => trigger.click());
  expect(document.querySelectorAll('[role="group"]')).toHaveLength(2);
  const blocked = document.querySelector('[role="option"][aria-disabled="true"]')!;
  act(() => blocked.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(change).not.toHaveBeenCalled();
  const list = document.querySelector('[role="listbox"]')!;
  key(list, "ArrowDown");
  key(list, "Enter");
  expect(change).toHaveBeenCalledWith("b");
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(trigger);
});
it("searches grouped metadata and ignores composition selection keys", () => {
  const change = vi.fn();
  act(() =>
    root.render(
      createElement(SearchableSelect, {
        variant: "pill",
        hideLabel: true,
        loopNavigation: true,
        label: "Mode",
        value: "a",
        options,
        onChange: change,
        searchable: true,
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  act(() => trigger.click());
  const search = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  key(search, "Enter", true);
  expect(change).not.toHaveBeenCalled();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(search, "last");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(document.querySelector('[role="option"]')?.textContent).toContain("Gamma");
  key(search, "ArrowDown");
  key(search, "Enter");
  expect(change).toHaveBeenCalledWith("c");
});
it("keeps the existing no-search default and blocks a disabled picker", () => {
  act(() =>
    root.render(
      createElement(SearchableSelect, {
        variant: "pill",
        hideLabel: true,
        searchable: false,
        loopNavigation: true,
        label: "Mode",
        value: "a",
        options,
        onChange: vi.fn(),
        disabled: true,
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  expect(trigger.disabled).toBe(true);
  act(() => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("input")).toBeNull();
});

it("does not open a read-only select, keeps it focusable and forwards validation state to the trigger", () => {
  const change = vi.fn();
  act(() =>
    root.render(
      createElement(SearchableSelect, {
        variant: "pill",
        hideLabel: true,
        searchable: false,
        loopNavigation: true,
        label: "Mode",
        value: "a",
        options,
        onChange: change,
        readOnly: true,
        triggerProps: { "aria-invalid": true, "aria-describedby": "mode-error" },
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  expect(trigger.disabled).toBe(false);
  expect(trigger.getAttribute("aria-readonly")).toBe("true");
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(trigger.getAttribute("aria-describedby")).toBe("mode-error");
  act(() => trigger.click());
  key(trigger, "ArrowDown");
  key(trigger, "Enter");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(change).not.toHaveBeenCalled();
});
