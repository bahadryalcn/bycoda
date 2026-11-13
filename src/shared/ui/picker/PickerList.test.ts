// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PickerPopover } from "./PickerPopover";
import { usePickerList, type PickerOption } from "./usePickerList";
import { PopoverSearchHeader } from "../PopoverSearchHeader";
import { InlineAction } from "../ActionHost";
import { PickerList, PickerListRoot } from "./PickerList";
import { Select } from "../Select";
import { SearchableSelect } from "../SearchableSelect";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

it("uses the same selected row anatomy in short, searchable and embedded lists", async () => {
  const options = [
    { value: "a", label: "Alpha", icon: createElement("span", { "data-choice-icon": "" }) },
  ];
  const onValueChange = vi.fn();
  await act(async () =>
    root.render(createElement(Select, { label: "Short", value: "a", options, onValueChange })),
  );
  await act(async () => container.querySelector("button")!.click());
  const short = document.querySelector('[role="option"]')!;
  const rowClass = short.className;
  const anatomy = short.innerHTML;
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Searchable",
        value: "a",
        options,
        onChange: onValueChange,
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const searchable = document.querySelector('[role="option"]')!;
  expect(searchable.className.split(" ").sort()).toEqual(rowClass.split(" ").sort());
  expect(searchable.querySelector("svg")?.outerHTML).toBe(short.querySelector("svg")?.outerHTML);
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Embedded",
        value: "a",
        options: options.map(({ label, ...option }) => ({ ...option, title: label })),
        onChange: onValueChange,
      }),
    ),
  );
  const embedded = container.querySelector('[role="option"]')!;
  expect(embedded.innerHTML).toBe(anatomy);
  expect(embedded.getAttribute("aria-selected")).toBe("true");
});

it("keeps rich descriptions accessible, skips disabled values and commits multiple choices", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Models",
        multiple: true,
        value: ["a"],
        onChange,
        options: [
          { value: "a", title: "Alpha" },
          { value: "b", title: "Beta", disabled: true, disabledReason: "Offline" },
          {
            value: "c",
            title: "Gamma",
            description: createElement("span", null, "Provider details"),
            meta: "Local",
          },
        ],
      }),
    ),
  );
  const list = container.querySelector('[role="listbox"]')!;
  const rows = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(rows[1].disabled).toBe(true);
  expect(document.getElementById(rows[1].getAttribute("aria-describedby")!)?.textContent).toContain(
    "Offline",
  );
  expect(document.getElementById(rows[2].getAttribute("aria-describedby")!)?.textContent).toBe(
    "Provider details",
  );
  await act(async () =>
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    ),
  );
  await act(async () =>
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(onChange).toHaveBeenCalledWith(["a", "c"], expect.objectContaining({ value: "c" }));
});

const key = async (element: Element, key: string, shiftKey = false) =>
  act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });
const choices = [
  { value: "a", title: "Alpha" },
  { value: "b", title: "Beta" },
];
it("handles keys on a focused option with an external search controller", async () => {
  const change = vi.fn();
  function Fixture() {
    const controller = usePickerList({ options: choices, value: "a", onChange: change });
    return createElement(PickerList, { label: "Choices", controller });
  }
  await act(async () => root.render(createElement(Fixture)));
  const alpha = container.querySelector<HTMLElement>('[role="option"]')!;
  await act(async () => alpha.focus());
  await key(alpha, "ArrowDown");
  await key(alpha, "Enter");
  expect(change).toHaveBeenCalledWith("b", expect.objectContaining({ value: "b" }));
});
it("retains active value and DOM identity across insertion, reorder and an empty async refresh", async () => {
  const render = (options: PickerOption[]) =>
    act(async () =>
      root.render(
        createElement(PickerList, { label: "Choices", options, value: "a", onChange: vi.fn() }),
      ),
    );
  await render(choices);
  const list = container.querySelector('[role="listbox"]')!;
  await key(list, "ArrowDown");
  const beta = container.querySelector("[data-active]")!;
  const id = beta.id;
  await render([choices[1], { value: "c", title: "Gamma" }, choices[0]]);
  expect(container.querySelector("[data-active]")).toBe(beta);
  expect(beta.id).toBe(id);
  await render([]);
  await render(choices);
  expect(container.querySelector("[data-active]")?.id).toBe(id);
});
it("controls active value without changing committed selection", async () => {
  const active = vi.fn(),
    change = vi.fn();
  const render = (activeValue: string | null) =>
    act(async () =>
      root.render(
        createElement(PickerList, {
          label: "Choices",
          options: choices,
          value: "a",
          onChange: change,
          activeValue,
          onActiveValueChange: active,
        }),
      ),
    );
  await render("b");
  expect(container.querySelector("[data-active]")?.textContent).toBe("Beta");
  await key(container.querySelector('[role="listbox"]')!, "ArrowUp");
  expect(active).toHaveBeenCalledWith("a");
  expect(change).not.toHaveBeenCalled();
  expect(container.querySelector("[data-active]")?.textContent).toBe("Beta");
  await render(null);
  expect(container.querySelector("[data-active]")).toBeNull();
});
it("keeps editor focus, forwards context keys, and restores editor focus after suspension", async () => {
  const inputRef = createRef<HTMLInputElement>(),
    context = vi.fn(),
    dismiss = vi.fn();
  function Fixture() {
    const [dismissible, setDismissible] = useState(true);
    const controller = usePickerList({
      options: [
        {
          ...choices[0],
          onContextMenu: (event) => {
            context(event.currentTarget);
            setDismissible(false);
          },
        },
      ],
      value: "a",
      onChange: vi.fn(),
      inputRef,
    });
    return createElement(PickerPopover, {
      open: true,
      anchor: container,
      label: "Picker",
      onDismiss: dismiss,
      dismissible,
      inputRef,
      header: createElement(PopoverSearchHeader, {
        ...controller.searchProps,
        label: "Search",
        value: "",
        onValueChange: () => undefined,
      }),
      footer: createElement(
        "button",
        { "data-resume": "", onClick: () => setDismissible(true) },
        "Resume",
      ),
      children: createElement(PickerList, { label: "Choices", controller }),
    });
  }
  await act(async () => root.render(createElement(Fixture)));
  expect(inputRef.current).not.toBeNull();
  await act(async () => inputRef.current!.focus());
  await key(inputRef.current!, "F10", true);
  expect(context).toHaveBeenCalledWith(document.querySelector('[role="option"]'));
  await key(inputRef.current!, "ContextMenu");
  expect(context).toHaveBeenCalledTimes(2);
  await act(async () =>
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  );
  await key(inputRef.current!, "Escape");
  expect(dismiss).not.toHaveBeenCalled();
  const resume = document.querySelector<HTMLButtonElement>("[data-resume]")!;
  await act(async () => {
    resume.focus();
    resume.click();
  });
  expect(document.activeElement).toBe(inputRef.current);
  await act(async () =>
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  );
  expect(dismiss).toHaveBeenCalledWith("outside");
});
it("renders separately focusable sibling actions without selecting or nesting buttons", async () => {
  const change = vi.fn(),
    pin = vi.fn();
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Choices",
        options: choices,
        value: "a",
        onChange: change,
        renderOptionActions: (option) =>
          createElement(InlineAction, { label: `Pin ${option.value}`, onClick: pin }, "Pin"),
      }),
    ),
  );
  const action = container.querySelector<HTMLButtonElement>('[aria-label="Pin a"]')!;
  expect(action.closest('[role="option"]')).toBeNull();
  expect(action.closest("[data-action-host]")).not.toBeNull();
  await act(async () => {
    action.focus();
    action.click();
  });
  expect(document.activeElement).toBe(action);
  expect(pin).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  await key(action, "ArrowDown");
  expect(container.querySelector("[data-active]")?.textContent).toBe("Alpha");
});
it("movement pointer mode ignores entry and repeated stationary coordinates after keyboard navigation", async () => {
  await act(async () =>
    root.render(
      createElement(PickerList, {
        label: "Choices",
        options: choices,
        value: "a",
        onChange: vi.fn(),
        pointerHighlight: "movement",
      }),
    ),
  );
  const rows = container.querySelectorAll('[role="option"]');
  await act(async () => rows[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(rows[0].hasAttribute("data-active")).toBe(true);
  const move = () =>
    act(async () =>
      rows[1].dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 20 }),
      ),
    );
  await move();
  expect(rows[1].hasAttribute("data-active")).toBe(true);
  await key(container.querySelector('[role="listbox"]')!, "ArrowUp");
  await move();
  expect(rows[0].hasAttribute("data-active")).toBe(true);
});

it("keeps the external editor and native list ref while a caller controls active IDs", async () => {
  const list = createRef<HTMLUListElement>(),
    onKeyDown = vi.fn();
  const draw = (active: string) =>
    createElement(
      "div",
      null,
      createElement("textarea", { defaultValue: "Unsent editor draft" }),
      createElement(
        PickerListRoot,
        {
          as: "ul",
          ref: list,
          label: "Custom paths",
          multiple: true,
          id: "path-list",
          "aria-activedescendant": active,
          onKeyDown,
        },
        createElement(
          "li",
          { id: "path-a", role: "option", "aria-selected": active === "path-a" },
          "Path A",
        ),
        createElement(
          "li",
          { id: "path-b", role: "option", "aria-selected": active === "path-b" },
          "Path B",
        ),
      ),
    );
  await act(async () => root.render(draw("path-a")));
  const node = list.current!,
    editor = container.querySelector("textarea")!;
  editor.value = "Exact unsent draft";
  editor.focus();
  await act(async () =>
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  expect(onKeyDown).toHaveBeenCalledOnce();
  expect(node.getAttribute("aria-activedescendant")).toBe("path-a");
  await act(async () => root.render(draw("path-b")));
  expect(list.current).toBe(node);
  expect(node.tagName).toBe("UL");
  expect(node.getAttribute("aria-multiselectable")).toBe("true");
  expect(node.getAttribute("aria-activedescendant")).toBe("path-b");
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Exact unsent draft");
});
