// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Select, NativeSelect } from "./Select";
import { Checkbox, CheckboxMark } from "./Checkbox";
import { Switch } from "./Switch";
import { SegmentedControl } from "./SegmentedControl";
import { Slider } from "./Slider";

it("opts into wrapping virtual choice navigation without changing clamped defaults", async () => {
  const change = vi.fn();
  const options = [
    { value: "one", label: "One" },
    { value: "two", label: "Two" },
  ];
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Provider",
        value: "one",
        options,
        loopNavigation: true,
        onValueChange: change,
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
  await act(async () =>
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })),
  );
  expect(
    document.getElementById(list.getAttribute("aria-activedescendant")!)?.textContent,
  ).toContain("Two");
  await act(async () =>
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(change).toHaveBeenCalledExactlyOnceWith("two");
  await act(async () =>
    root.render(
      createElement(Select, { label: "Provider", value: "one", options, onValueChange: change }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const clamped = document.querySelector<HTMLElement>('[role="listbox"]')!;
  await act(async () =>
    clamped.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })),
  );
  expect(
    document.getElementById(clamped.getAttribute("aria-activedescendant")!)?.textContent,
  ).toContain("One");
});

let container: HTMLDivElement;
let root: Root;

it("keeps a decorative selection mark inside its existing action without a nested control", async () => {
  const select = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "button",
        { onClick: select },
        createElement(CheckboxMark, { checked: true, size: "sm" }),
        "Select session",
      ),
    ),
  );
  const mark = container.querySelector<HTMLElement>("[data-checkbox-mark]")!;
  expect(mark.getAttribute("aria-hidden")).toBe("true");
  expect(mark.hasAttribute("data-checked")).toBe(true);
  expect(container.querySelector("input,[role=checkbox]")).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  await act(async () => container.querySelector("button")!.click());
  expect(select).toHaveBeenCalledOnce();
});

it("keeps padded choice rows interactive without padding the checkbox input", async () => {
  const checked = vi.fn();
  const switched = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Checkbox, {
          label: "Folder",
          padding: { inline: "md", block: "sm" },
          onChange: checked,
        }),
        createElement(Switch, {
          label: "Import",
          padding: { inline: "md", block: "sm" },
          onCheckedChange: switched,
        }),
      ),
    ),
  );
  const label = container.querySelector<HTMLLabelElement>("label")!;
  const input = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  const toggle = container.querySelector<HTMLButtonElement>("button[role=switch]")!;
  expect(label.style.paddingBlock).toBe("var(--space-2)");
  expect(toggle.style.paddingBlock).toBe("var(--space-2)");
  expect(input.style.paddingBlock).toBe("");
  expect(input.hasAttribute("padding")).toBe(false);
  await act(async () => label.click());
  await act(async () => toggle.click());
  expect(input.checked).toBe(true);
  expect(checked).toHaveBeenCalledOnce();
  expect(switched).toHaveBeenCalledExactlyOnceWith(true);
});

it("preserves native uncontrolled form values, validation, reset and mixed checkbox refs", async () => {
  const select = createRef<HTMLSelectElement>();
  const checkbox = createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(
          NativeSelect,
          { ref: select, name: "mode", defaultValue: "", required: true },
          createElement("option", { value: "" }, "Choose"),
          createElement("option", { value: "safe" }, "Safe"),
        ),
        createElement(Checkbox, {
          ref: checkbox,
          name: "approved",
          value: "yes",
          defaultChecked: true,
          indeterminate: true,
        }),
      ),
    ),
  );
  const form = container.querySelector("form")!;
  expect(form.checkValidity()).toBe(false);
  select.current!.value = "safe";
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("mode")).toBe("safe");
  expect(new FormData(form).get("approved")).toBe("yes");
  expect(checkbox.current!.indeterminate).toBe(true);
  form.reset();
  expect(select.current!.value).toBe("");
  expect(checkbox.current!.checked).toBe(true);
});
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
it("keeps Select trigger ref, native descriptions and cancellable opening handlers", async () => {
  const ref = createRef<HTMLButtonElement>();
  const onOpen = vi.fn();
  const onClick = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault());
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Mode",
        value: "a",
        options: [{ value: "a", label: "Alpha" }],
        onValueChange: vi.fn(),
        ref,
        id: "mode",
        "aria-describedby": "help",
        name: "mode",
        onOpen,
        onClick,
      }),
    ),
  );
  expect(ref.current?.id).toBe("mode");
  expect(ref.current?.name).toBe("mode");
  expect(ref.current?.type).toBe("button");
  expect(ref.current?.getAttribute("aria-describedby")).toBe("help");
  await act(async () => ref.current!.click());
  expect(onClick).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});
it("keeps Switch ref, form metadata and native pointer callbacks", async () => {
  const ref = createRef<HTMLButtonElement>();
  const pointer = vi.fn();
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(Switch, {
          ref,
          name: "enabled",
          value: "yes",
          "aria-label": "Enabled",
          "aria-describedby": "help",
          checked: false,
          onCheckedChange: change,
          onPointerDown: pointer,
        }),
      ),
    ),
  );
  expect(container.querySelector<HTMLInputElement>('input[name="enabled"]')?.value).toBe("yes");
  expect(ref.current?.value).toBe("yes");
  expect(ref.current?.getAttribute("aria-describedby")).toBe("help");
  await act(async () => {
    ref.current!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    ref.current!.click();
  });
  expect(pointer).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledExactlyOnceWith(true);
});
it("keeps Slider live change separate from commit and submits its controlled value", async () => {
  const change = vi.fn();
  const commit = vi.fn();
  await act(async () =>
    root.render(
      createElement(Slider, {
        label: "Volume",
        name: "volume",
        value: 5,
        min: 0,
        max: 10,
        step: 1,
        onValueChange: change,
        onValueCommit: commit,
      }),
    ),
  );
  const thumb = container.querySelector('[role="slider"]')!;
  await act(async () =>
    thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(change).toHaveBeenCalledExactlyOnceWith(6);
  expect(commit).toHaveBeenCalledExactlyOnceWith(6);
  expect(container.querySelector<HTMLInputElement>('input[name="volume"]')?.value).toBe("5");
});

it("keeps Checkbox a native, labelled, form-participating membership input", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(
          "label",
          null,
          createElement(Checkbox, { name: "terms", value: "yes", onChange: change }),
          createElement("span", null, "Accept terms"),
        ),
      ),
    ),
  );
  const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(input.className).toContain("bycoda-arc-checkbox");
  // Activating the label text toggles the input: the text is part of the hit area.
  await act(async () => container.querySelector("span")!.click());
  expect(input.checked).toBe(true);
  expect(change).toHaveBeenCalledOnce();
  expect(new FormData(container.querySelector("form")!).get("terms")).toBe("yes");
  await act(async () =>
    root.render(createElement(Checkbox, { indeterminate: true, disabled: true })),
  );
  const mixed = container.querySelector<HTMLInputElement>("input")!;
  expect(mixed.indeterminate).toBe(true);
  expect(mixed.getAttribute("aria-checked")).toBe("mixed");
  expect(mixed.disabled).toBe(true);
});

it("renders Checkbox label and description as one native label that toggles from its text", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(Checkbox, {
        label: "Accept terms",
        description: "Required",
        className: "placement",
        onChange: change,
      }),
    ),
  );
  const label = container.querySelector("label")!;
  const input = label.querySelector<HTMLInputElement>("input")!;
  expect(label.className).toContain("placement");
  expect(input.className).not.toContain("placement");
  expect(input.getAttribute("aria-describedby")).toBe(label.querySelector("span span + span")!.id);
  await act(async () =>
    label.querySelector("span span")!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(input.checked).toBe(true);
  await act(async () => root.render(createElement(Checkbox, { label: "Off", disabled: true })));
  expect(container.querySelector("label")!.hasAttribute("data-disabled")).toBe(true);
  await act(async () => root.render(createElement(Checkbox, { className: "bare" })));
  expect(container.querySelector("label")).toBeNull();
  expect(container.querySelector("input")!.className).toContain("bare");
});

it("renders Switch label, description and start position inside the button", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(Switch, {
        label: "Sync",
        description: "Keeps devices equal",
        labelPosition: "start",
        onCheckedChange: change,
      }),
    ),
  );
  const button = container.querySelector<HTMLButtonElement>("button")!;
  expect(button.dataset.labelPosition).toBe("start");
  expect(button.getAttribute("aria-label")).toBe("Sync");
  expect(button.firstElementChild!.textContent).toBe("SyncKeeps devices equal");
  expect(button.getAttribute("aria-describedby")).toBeTruthy();
  await act(async () =>
    button.querySelector("span span")!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(change).toHaveBeenCalledWith(true);
});

it("skips disabled segments with arrow keys and keeps a reachable tab stop", async () => {
  const change = vi.fn();
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", disabled: true },
    { value: "c", label: "Gamma with a long localized label" },
  ];
  await act(async () =>
    root.render(
      createElement(SegmentedControl, {
        options,
        value: "a",
        onValueChange: change,
        label: "View",
      }),
    ),
  );
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-value]"));
  expect(buttons[1].disabled).toBe(true);
  await act(async () => {
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(change).toHaveBeenLastCalledWith("c");
  await act(async () => {
    buttons[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  });
  expect(change).toHaveBeenLastCalledWith("a");
  await act(async () => {
    buttons[1].click();
  });
  expect(change).toHaveBeenCalledTimes(2);
  // A disabled selection must not strand keyboard users without a tab stop.
  await act(async () =>
    root.render(
      createElement(SegmentedControl, {
        options,
        value: "b",
        onValueChange: change,
        label: "View",
      }),
    ),
  );
  const stops = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[data-value]"),
  ).filter((button) => button.tabIndex === 0);
  expect(stops.map((button) => button.dataset.value)).toEqual(["a"]);
});
