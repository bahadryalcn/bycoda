// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Select, NativeSelect } from "./Select";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
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
