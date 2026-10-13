// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Segmented, Select } from "./settingsControls";

vi.mock("../model/sounds", () => ({ playCue: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const options = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
];

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

async function key(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("settings keyboard controls", () => {
  it("refreshes on mouse or keyboard opening, without refreshing on close", async () => {
    const onOpen = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Model",
          value: "first",
          options,
          onChange: vi.fn(),
          onOpen,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    await act(async () => trigger.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    await act(async () => trigger.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    await key(trigger, "ArrowDown");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
  it("moves segmented selection and focus with arrow keys", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Segmented, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);
    await key(radios[0], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("second");
    expect(document.activeElement).toBe(radios[1]);
    await key(radios[1], "Home");
    expect(onChange).toHaveBeenLastCalledWith("first");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("closes a select on Tab without saving the highlighted option", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    await key(trigger, "ArrowDown");
    const menu = document.querySelector('[role="listbox"]')!;
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    await key(menu, "ArrowDown");
    await key(menu, "Tab");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("saves the highlighted option with Space and restores trigger focus", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Select, {
          label: "Layout",
          value: "first",
          options,
          onChange,
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    await act(async () => trigger.click());
    const menu = document.querySelector('[role="listbox"]')!;
    await key(menu, "End");
    await key(menu, " ");
    expect(onChange).toHaveBeenLastCalledWith("second");
    expect(document.activeElement).toBe(trigger);
  });
});
