// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelSetting } from "../model/models";
import { ModelSettingPicker } from "./ModelSettingPicker";

let container: HTMLDivElement;
let root: Root;
const onChoose = vi.fn();
const onClose = vi.fn();
const setting: ModelSetting = {
  id: "effort",
  label: "Effort",
  kind: "select",
  value: "low",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function render(disabled = false) {
  act(() =>
    root.render(
      createElement(ModelSettingPicker, {
        setting,
        values: {},
        disabled,
        onChoose,
        onClose,
      }),
    ),
  );
}

it("links search to shared option rows and commits keyboard navigation", () => {
  render();
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const list = container.querySelector('[role="listbox"]')!;
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe("Low");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent).toBe(
    "High",
  );
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onChoose).toHaveBeenCalledWith("high");
  expect(onClose).toHaveBeenCalledOnce();
});

it("cannot commit disabled settings", () => {
  render(true);
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].every(
      (row) => row.disabled,
    ),
  ).toBe(true);
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onChoose).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("ignores IME Enter instead of choosing a model while composing", () => {
  render();
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    ),
  );
  expect(onChoose).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
