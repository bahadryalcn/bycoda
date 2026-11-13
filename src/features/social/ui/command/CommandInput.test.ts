// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandInput, type CommandInputProps } from "./CommandInput";

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

function render(props: Partial<CommandInputProps> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  act(() =>
    root.render(
      createElement(CommandInput, { text: "", busy: false, onChange, onSubmit, ...props }),
    ),
  );
  return { onChange, onSubmit };
}

const plan = () =>
  [...element.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Plan");

function submitForm() {
  act(() => {
    element
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("disables Plan with its reason as the description while the box is empty or only whitespace", () => {
  for (const text of ["", "   \n "]) {
    const { onSubmit } = render({ text });
    expect(plan()?.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(plan()!.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Type what AI should do.",
    );
    act(() => plan()?.click());
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  }
});

it("enables Plan once there is text and submits it once", () => {
  const { onSubmit } = render({ text: "Reply to pricing questions" });
  expect(plan()?.getAttribute("aria-disabled")).toBeNull();
  expect(plan()?.getAttribute("aria-describedby")).toBeNull();
  act(() => plan()?.click());
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("does not submit again while a plan is being made", () => {
  const { onSubmit } = render({ text: "Reply to pricing questions", busy: true });
  expect(plan()?.getAttribute("aria-busy")).toBe("true");
  act(() => plan()?.click());
  submitForm();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("reports typing to the screen and caps the sentence at 2000 characters", () => {
  const { onChange } = render();
  const area = element.querySelector("textarea")!;
  expect(area.maxLength).toBe(2000);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      area,
      "Hello",
    );
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("Hello");
});
