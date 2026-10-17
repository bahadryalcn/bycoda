// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RadioGroup, type RadioGroupProps } from "./RadioGroup";

let root: Root, container: HTMLDivElement;
const options = [
  { value: "a", label: "Alpha", description: "First choice" },
  { value: "b", label: "Beta", disabled: true, disabledReason: "Unavailable account" },
  { value: "c", label: "Gamma", description: "Third choice" },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(props: Partial<RadioGroupProps> = {}) {
  await act(async () =>
    root.render(
      createElement(
        "form",
        { id: "choices" },
        createElement(RadioGroup, {
          label: "Mode",
          options,
          name: "mode",
          required: true,
          ...props,
        }),
      ),
    ),
  );
  return {
    form: container.querySelector("form")!,
    inputs: Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')),
  };
}

it("keeps native required validation, named FormData, input ref and real events", async () => {
  const ref = createRef<HTMLInputElement>();
  const onChange = vi.fn((event) => expect(event.currentTarget.value).toBe("c"));
  const onValueChange = vi.fn();
  const { form, inputs } = await render({ ref, onChange, onValueChange });
  expect(ref.current).toBe(inputs[0]);
  expect(form.checkValidity()).toBe(false);
  await act(async () => inputs[2].click());
  expect(onChange).toHaveBeenCalledOnce();
  expect(onValueChange).toHaveBeenCalledWith("c");
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).get("mode")).toBe("c");
  expect(ref.current).toBe(inputs[2]);
  ref.current!.focus();
  expect(document.activeElement).toBe(inputs[2]);
});

it("restores uncontrolled defaults on form reset without firing change", async () => {
  const onChange = vi.fn();
  const { form, inputs } = await render({ defaultValue: "a", onChange });
  await act(async () => inputs[2].click());
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(inputs.map((input) => input.checked)).toEqual([true, false, false]);
  expect(new FormData(form).get("mode")).toBe("a");
  expect(onChange).toHaveBeenCalledOnce();
});

it("honors cancelled resets and keeps controlled values authoritative", async () => {
  const onChange = vi.fn();
  const { form, inputs } = await render({ value: "a", onChange });
  await act(async () => inputs[2].click());
  expect(onChange).toHaveBeenCalledOnce();
  expect(inputs[0].checked).toBe(true);
  expect(inputs[2].checked).toBe(false);
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(inputs[0].checked).toBe(true);
});

it("honors cancelled uncontrolled resets", async () => {
  const { form, inputs } = await render({ defaultValue: "a" });
  await act(async () => inputs[2].click());
  form.addEventListener("reset", (event) => event.preventDefault(), { once: true });
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(inputs[2].checked).toBe(true);
});

it("retains disabled descriptions, label activation, disabled group and external form ownership", async () => {
  const { form, inputs } = await render({ defaultValue: "a", form: "choices" });
  expect(inputs[1].disabled).toBe(true);
  expect(document.getElementById(inputs[1].getAttribute("aria-describedby")!)?.textContent).toBe(
    "Unavailable account",
  );
  expect(inputs[0].form).toBe(form);
  await act(async () => inputs[2].closest("label")!.click());
  expect(new FormData(form).get("mode")).toBe("c");
  await render({ disabled: true, defaultValue: "a" });
  expect(inputs.every((input) => input.disabled)).toBe(true);
  expect(new FormData(form).has("mode")).toBe(false);
});

it("submits and resets through an associated form outside the group subtree", async () => {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement("form", { id: "external" }),
        createElement(RadioGroup, {
          label: "External mode",
          options,
          name: "mode",
          form: "external",
          defaultValue: "a",
          required: true,
        }),
      ),
    ),
  );
  const form = container.querySelector("form")!;
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  await act(async () => inputs[2].click());
  expect(new FormData(form).get("mode")).toBe("c");
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(new FormData(form).get("mode")).toBe("a");
});
