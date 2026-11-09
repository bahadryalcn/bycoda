// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmptyHint, type EmptyHintProps } from "./EmptyHint";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(props: EmptyHintProps) {
  act(() => root.render(createElement(EmptyHint, props)));
}

function buttons(): HTMLButtonElement[] {
  return [...element.querySelectorAll("button")];
}

it("shows one sentence and no button when no action is given", () => {
  render({ message: "No people yet." });
  expect(element.textContent).toContain("No people yet.");
  expect(buttons()).toHaveLength(0);
});

it("shows one primary action and an optional Fill with AI button", () => {
  const onAction = vi.fn();
  const onAi = vi.fn();
  render({
    message: "No people yet.",
    action: { label: "Import people", onClick: onAction },
    fillWithAi: { onClick: onAi },
  });
  expect(buttons().map((b) => b.textContent?.trim())).toEqual(["Import people", "Fill with AI"]);
  act(() => buttons()[0]?.click());
  act(() => buttons()[1]?.click());
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAi).toHaveBeenCalledTimes(1);
});

it("disables an action and shows its reason next to it", () => {
  const onAi = vi.fn();
  render({
    message: "No people yet.",
    fillWithAi: { onClick: onAi, disabled: true, disabledReason: "Connect an account first." },
  });
  const fill = buttons()[0];
  expect(fill?.disabled).toBe(true);
  expect(element.textContent).toContain("Connect an account first.");
  act(() => fill?.click());
  expect(onAi).not.toHaveBeenCalled();
});
