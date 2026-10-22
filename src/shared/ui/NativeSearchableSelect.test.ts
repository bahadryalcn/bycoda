// @vitest-environment jsdom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeSearchableSelect, type NativeSearchableSelectProps } from "./NativeSearchableSelect";

let root: Root;
let container: HTMLDivElement;
const options = [
  { value: "", label: "Choose project" },
  { value: "alpha", label: "Alpha", description: "Primary workspace", keywords: "first" },
  { value: "beta", label: "Beta", disabled: true },
  { value: "gamma", label: "Gamma" },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
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

async function render(props: Partial<NativeSearchableSelectProps> = {}) {
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement("label", { htmlFor: "project" }, "Project"),
        createElement(NativeSearchableSelect, {
          id: "project",
          label: "Project",
          name: "project",
          options,
          required: true,
          defaultValue: "",
          ...props,
        }),
      ),
    ),
  );
  return {
    form: container.querySelector("form")!,
    select: container.querySelector("select")!,
    trigger: container.querySelector<HTMLButtonElement>("button")!,
  };
}

async function pick(trigger: HTMLButtonElement, value: string) {
  await act(async () => trigger.click());
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (node) => node.textContent?.includes(value),
  )!;
  await act(async () => option.click());
}

it("keeps native required validation, ref, FormData, change and uncontrolled reset", async () => {
  const ref = createRef<HTMLSelectElement>();
  const onChange = vi.fn((event) => expect(event.target).toBe(ref.current));
  const { form, select, trigger } = await render({ ref, onChange });
  expect(ref.current).toBe(select);
  await act(async () => expect(form.checkValidity()).toBe(false));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  await pick(trigger, "Alpha");
  expect(onChange).toHaveBeenCalledOnce();
  expect(select.value).toBe("alpha");
  expect(new FormData(form).get("project")).toBe("alpha");
  expect(form.checkValidity()).toBe(true);
  expect(trigger.textContent).toContain("Alpha");
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(select.value).toBe("");
  expect(trigger.getAttribute("aria-label")).toBe("Project: Choose project");
  expect(onChange).toHaveBeenCalledOnce();
});

it("forwards imperative focus and external label activation to the visible trigger", async () => {
  const { select, trigger } = await render();
  await act(async () => select.focus());
  expect(document.activeElement).toBe(trigger);
  trigger.blur();
  expect(select.labels?.[0]).toBe(container.querySelector("label"));
  // jsdom does not implement label default focus; exercise its native focus target.
  await act(async () => select.labels?.[0].control?.focus());
  expect(document.activeElement).toBe(trigger);
});

it("keeps controlled values authoritative after selection and form reset", async () => {
  const onChange = vi.fn();
  const { select, form, trigger } = await render({
    value: "alpha",
    defaultValue: undefined,
    onChange,
  });
  await pick(trigger, "Gamma");
  expect(onChange).toHaveBeenCalledOnce();
  expect(select.value).toBe("alpha");
  expect(trigger.textContent).toContain("Alpha");
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(select.value).toBe("alpha");
  expect(trigger.textContent).toContain("Alpha");
});

it("honors cancelled resets and native changes without synthesizing reset changes", async () => {
  const onChange = vi.fn();
  const { form, select, trigger } = await render({ defaultValue: "alpha", onChange });
  await act(async () => {
    select.value = "gamma";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(trigger.textContent).toContain("Gamma");
  form.addEventListener("reset", (event) => event.preventDefault());
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(select.value).toBe("gamma");
  expect(trigger.textContent).toContain("Gamma");
  expect(onChange).toHaveBeenCalledOnce();
});

it("retains option metadata, disabled choices and accessible form descriptions", async () => {
  const { select, trigger } = await render({
    "aria-labelledby": "project-label",
    "aria-describedby": "project-help",
  });
  expect(trigger.getAttribute("aria-labelledby")).toBe("project-label");
  expect(trigger.getAttribute("aria-describedby")).toBe("project-help");
  expect(trigger.getAttribute("aria-required")).toBe("true");
  expect(select.options[2].disabled).toBe(true);
  await act(async () => trigger.click());
  expect(document.body.textContent).toContain("Primary workspace");
  const beta = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
    (node) => node.textContent?.includes("Beta"),
  )!;
  expect(beta.disabled).toBe(true);
  await act(async () => beta.click());
  expect(select.value).toBe("");
});

it("preserves native disabled named payload semantics", async () => {
  const { select, form, trigger } = await render({ disabled: true, defaultValue: "alpha" });
  expect(select.disabled).toBe(true);
  expect(trigger.disabled).toBe(true);
  expect(new FormData(form).has("project")).toBe(false);
  expect(form.checkValidity()).toBe(true);
});

it("exposes native custom validation recovery text until corrected or reset", async () => {
  const { form, select, trigger } = await render({
    defaultValue: "alpha",
    "aria-describedby": "help",
  });
  select.setCustomValidity("Choose a verified project");
  await act(async () => expect(form.reportValidity()).toBe(false));
  const error = container.querySelector('[role="alert"]')!;
  expect(error.textContent).toBe("Choose a verified project");
  expect(trigger.getAttribute("aria-describedby")).toBe(`help ${error.id}`);
  expect(document.activeElement).toBe(trigger);
  await pick(trigger, "Gamma");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose a verified project");
  select.setCustomValidity("");
  await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(trigger.getAttribute("aria-describedby")).toBe("help");
});

it("inherits native fieldset disabled state for both owners", async () => {
  const { form, select, trigger } = await render({ defaultValue: "alpha" });
  const fieldset = document.createElement("fieldset");
  form.append(fieldset);
  fieldset.append(select.parentElement!);
  fieldset.disabled = true;
  expect(select.matches(":disabled")).toBe(true);
  expect(trigger.matches(":disabled")).toBe(true);
  await act(async () => trigger.click());
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(new FormData(form).has("project")).toBe(false);
  // Return the React-owned subtree before unmounting.
  form.append(select.parentElement!);
  fieldset.remove();
});

it("normalizes changed controlled values and removed options through the native owner", async () => {
  const { select, trigger } = await render({ value: "alpha", defaultValue: undefined });
  await render({ value: "gamma", defaultValue: undefined });
  expect(select.value).toBe("gamma");
  expect(trigger.getAttribute("aria-label")).toBe("Project: Gamma");
  await render({ value: "gamma", defaultValue: undefined, options: options.slice(0, 2) });
  expect(select.value).toBe("");
  expect(trigger.getAttribute("aria-label")).toBe("Project: Choose project");
});

it("reads reset values after the default action even when a controlled sibling rerenders", async () => {
  function Form() {
    const [sibling, setSibling] = useState("before");
    return createElement(
      "form",
      { onReset: () => setSibling("reset") },
      createElement("input", { value: sibling, readOnly: true }),
      createElement(NativeSearchableSelect, {
        label: "Project",
        name: "project",
        options,
        defaultValue: "",
      }),
    );
  }
  await act(async () => root.render(createElement(Form)));
  const form = container.querySelector("form")!;
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await pick(trigger, "Gamma");
  await act(async () => {
    form.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(container.querySelector("input")!.value).toBe("reset");
  expect(container.querySelector("select")!.value).toBe("");
  expect(trigger.getAttribute("aria-label")).toBe("Project: Choose project");
});

it("focuses only the first invalid form field and respects custom invalid cancellation", async () => {
  const { form, trigger, select } = await render();
  const input = document.createElement("input");
  input.required = true;
  form.prepend(input);
  input.focus();
  await act(async () => form.checkValidity());
  expect(document.activeElement).toBe(input);
  await render({ onInvalid: (event) => event.preventDefault() });
  trigger.blur();
  await act(async () => select.reportValidity());
  expect(document.activeElement).not.toBe(trigger);
});
