// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Segmented, Select, Slider, Toggle } from "./settingsControls";
import { playCue } from "../model/sounds";

vi.mock("../model/sounds", () => ({ playCue: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
const options = [
  { value: "first", label: "First" },
  { value: "second", label: "Second" },
];

beforeEach(() => {
  vi.clearAllMocks();
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
  it("keeps controlled switch state, one sound cue and disabled behavior", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(createElement(Toggle, { label: "Enable sounds", on: false, onChange })),
    );
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(playCue).toHaveBeenCalledExactlyOnceWith("switch");
    await act(async () =>
      root.render(
        createElement(Toggle, { label: "Enable sounds", on: true, onChange, disabled: true }),
      ),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(playCue).toHaveBeenCalledTimes(1);
  });

  it("keeps slider step, limits and the settings display value", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(Slider, {
          label: "Opacity",
          value: 5,
          display: "50%",
          min: 0,
          max: 10,
          step: 1,
          onChange,
        }),
      ),
    );
    const thumb = container.querySelector<HTMLElement>('[role="slider"]')!;
    expect(thumb.getAttribute("aria-valuenow")).toBe("5");
    expect(thumb.getAttribute("aria-valuetext")).toBe("50%");
    await key(thumb, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith(6);
    await key(thumb, "End");
    expect(onChange).toHaveBeenLastCalledWith(10);
    await key(thumb, "Home");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("retains settings search ids and radio semantics for segmented values", async () => {
    await act(async () =>
      root.render(
        createElement(Segmented, {
          label: "Layout",
          value: "first",
          options,
          onChange: vi.fn(),
          optionIdPrefix: "setting-layout",
        }),
      ),
    );
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
      "Layout",
    );
    expect(container.querySelector("#setting-layout-first")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(container.querySelector('[role="radio"][aria-pressed]')).toBeNull();
  });

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
