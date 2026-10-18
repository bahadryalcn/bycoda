// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Select } from "./Select";

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const menu = () => document.querySelector<HTMLElement>('[role="listbox"]');
const key = (target: Element, value: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
  );
async function render(disabled = false) {
  await act(async () =>
    root.render(
      createElement(Select, {
        label: "Choice",
        value: "a",
        options,
        disabled,
        onValueChange: change,
      }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  change.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

it.each(["light", "dark"])(
  "closes an open %s menu on disable and discards stale pointer/keyboard selection",
  async (theme) => {
    document.documentElement.dataset.theme = theme;
    await render();
    await act(async () => trigger().click());
    const staleMenu = menu()!;
    const staleOption = staleMenu.querySelectorAll<HTMLButtonElement>('[role="option"]')[1];
    expect(staleOption).toBeDefined();
    await render(true);
    expect(menu()).toBeNull();
    expect(trigger().disabled).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().hasAttribute("aria-controls")).toBe(false);
    await act(async () => {
      staleOption.click();
      key(staleMenu, "Enter");
    });
    expect(change).not.toHaveBeenCalled();
    await render(false);
    expect(menu()).toBeNull();
    await act(async () => {
      trigger().focus();
      key(trigger(), "ArrowDown");
    });
    await act(async () => {
      key(menu()!, "ArrowDown");
    });
    await act(async () => {
      key(menu()!, "Enter");
    });
    expect(change).toHaveBeenCalledExactlyOnceWith("b");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  },
);

it.each(["pointer", "keyboard"])(
  "rejects %s activation when the native form control becomes disabled",
  async (mode) => {
    await render();
    await act(async () => trigger().click());
    trigger().disabled = true;
    await act(async () => {
      if (mode === "pointer")
        menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click();
      else {
        key(menu()!, "ArrowDown");
      }
    });
    expect(change).not.toHaveBeenCalled();
  },
);
