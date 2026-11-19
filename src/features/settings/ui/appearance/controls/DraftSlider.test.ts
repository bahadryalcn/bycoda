// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftSlider } from "./DraftSlider";

// The settings Slider forwards the shared staged contract: onChange previews, onValueCommit stores.
vi.mock("../../../../../shared/ui/settings", () => ({
  Slider: ({
    label,
    value,
    display,
    onChange,
    onValueCommit,
  }: {
    label: string;
    value: number;
    display: string;
    onChange: (value: number) => void;
    onValueCommit?: (value: number) => void;
  }) =>
    createElement(
      "div",
      { "aria-label": label, "data-value": value, "data-display": display },
      createElement("button", { "data-act": "drag", onClick: () => onChange(40) }, "drag"),
      createElement("button", { "data-act": "drag-more", onClick: () => onChange(60) }, "more"),
      createElement("button", { "data-act": "release", onClick: () => onValueCommit?.(60) }, "go"),
    ),
}));

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

function render(props: { value: number; apply?: (value: number) => void; commit: () => void }) {
  act(() =>
    root.render(
      createElement(DraftSlider, {
        label: "Amount",
        format: (next: number) => `${next}%`,
        min: 0,
        max: 100,
        ...props,
      }),
    ),
  );
}
const slider = () => container.querySelector<HTMLElement>('[aria-label="Amount"]')!;
const press = (name: string) =>
  act(() => container.querySelector<HTMLButtonElement>(`[data-act="${name}"]`)!.click());

it("previews in memory while dragging and commits once on release", () => {
  const commit = vi.fn();
  render({ value: 20, commit });
  press("drag");
  press("drag-more");
  expect(slider().getAttribute("data-value")).toBe("60");
  expect(slider().getAttribute("data-display")).toBe("60%");
  expect(commit).not.toHaveBeenCalled();
  press("release");
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith(60);
  // The draft is gone: the stored value shows again until the owner writes the new one.
  expect(slider().getAttribute("data-value")).toBe("20");
});

it("runs apply for every step but never commits it", () => {
  const apply = vi.fn();
  const commit = vi.fn();
  render({ value: 20, apply, commit });
  press("drag");
  press("drag-more");
  expect(apply.mock.calls).toEqual([[40], [60]]);
  expect(commit).not.toHaveBeenCalled();
});

it("keeps the preview in memory when no apply is given", () => {
  const commit = vi.fn();
  expect(() => {
    render({ value: 20, commit });
    press("drag");
  }).not.toThrow();
  expect(slider().getAttribute("data-value")).toBe("40");
  expect(commit).not.toHaveBeenCalled();
});

it("drops a stale draft when the stored value changes underneath it", () => {
  const commit = vi.fn();
  render({ value: 20, commit });
  press("drag");
  expect(slider().getAttribute("data-value")).toBe("40");
  // A reset, another window or a theme change writes a new stored value mid-drag.
  render({ value: 75, commit });
  expect(slider().getAttribute("data-value")).toBe("75");
  expect(slider().getAttribute("data-display")).toBe("75%");
  expect(commit).not.toHaveBeenCalled();
});

it("writes nothing when the control unmounts mid-drag", () => {
  const apply = vi.fn();
  const commit = vi.fn();
  render({ value: 20, apply, commit });
  press("drag");
  act(() => root.render(null));
  expect(commit).not.toHaveBeenCalled();
});
