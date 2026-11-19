// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DateRangePicker } from "../DateRangePicker";
import { DateTimePicker } from "../DateTimePicker";

let container: HTMLDivElement;
let root: Root;
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

function trigger() {
  return container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
}

/** Dispatches a keydown on the target and returns whether its default action was left alone. */
function press(target: HTMLElement, key: string) {
  let notPrevented = true;
  act(() => {
    notPrevented = target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  return notPrevented;
}

function findButton(label: string) {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

it("does not clear a filled date and time when Backspace or Delete is pressed on the trigger", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(DateTimePicker, {
        label: "Deadline",
        value: "2028-02-20T18:30",
        onChange,
      }),
    ),
  );
  trigger().focus();
  expect(press(trigger(), "Backspace")).toBe(true);
  expect(press(trigger(), "Delete")).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("still opens the picker from the trigger with the arrow keys", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(DateTimePicker, {
        label: "Deadline",
        value: "2028-02-20T18:30",
        onChange,
      }),
    ),
  );
  press(trigger(), "ArrowDown");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps the footer Clear action as the deliberate way to empty a filled date and time", () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      createElement(DateTimePicker, {
        label: "Deadline",
        value: "2028-02-20T18:30",
        onChange,
      }),
    ),
  );
  act(() => trigger().click());
  const clear = findButton("Clear");
  expect(clear).not.toBeNull();
  act(() => clear!.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith("");
});

it("does not clear a filled period when Backspace or Delete is pressed on the trigger", () => {
  const onChange = vi.fn();
  const onClear = vi.fn();
  act(() =>
    root.render(
      createElement(DateRangePicker, {
        label: "Report period",
        value: { start: new Date(2028, 1, 13), end: new Date(2028, 1, 14) },
        onChange,
        onClear,
      }),
    ),
  );
  press(trigger(), "Backspace");
  press(trigger(), "Delete");
  expect(onClear).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
