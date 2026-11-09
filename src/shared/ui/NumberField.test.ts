// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";

let root: Root;
let container: HTMLDivElement;
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

it("preserves native uncontrolled number ref, constraints, named values and reset", async () => {
  const ref = createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(NumberField, {
          ref,
          label: "Token capacity",
          name: "capacity",
          required: true,
          min: 1,
          max: 100,
          step: 2,
          defaultValue: "3",
        }),
      ),
    ),
  );
  const input = ref.current!;
  const form = container.querySelector("form")!;
  expect(input.type).toBe("number");
  expect(input.value).toBe("3");
  expect(new FormData(form).get("capacity")).toBe("3");
  input.value = "4";
  expect(input.validity.stepMismatch).toBe(true);
  input.value = "101";
  expect(input.validity.rangeOverflow).toBe(true);
  input.value = "";
  expect(input.validity.valueMissing).toBe(true);
  form.reset();
  expect(input.value).toBe("3");
});

it("does not coerce empty native drafts or clamp out-of-range input events", async () => {
  const drafts: string[] = [];
  await act(async () =>
    root.render(
      createElement(NumberField, {
        label: "Allocation",
        min: 0.01,
        max: 100,
        step: "any",
        defaultValue: "1",
        onChange: (event) => drafts.push(event.target.value),
      }),
    ),
  );
  const input = container.querySelector("input")!;
  for (const value of ["", "101.25", "-1"]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(drafts).toEqual(["", "101.25", "-1"]);
  expect(input.value).toBe("-1");
  expect(input.validity.rangeUnderflow).toBe(true);
});

const setNativeValue = (input: HTMLInputElement, value: string) =>
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
const steppers = () => ({
  decrease: container.querySelector<HTMLButtonElement>('button[aria-label="Decrease value"]')!,
  increase: container.querySelector<HTMLButtonElement>('button[aria-label="Increase value"]')!,
});

it("steps with the native step base, keeps focus in the field and reports through onChange", async () => {
  const drafts: string[] = [];
  await act(async () =>
    root.render(
      createElement(NumberField, {
        label: "Capacity",
        min: 0,
        max: 10,
        step: 5,
        defaultValue: "5",
        onChange: (event) => drafts.push(event.target.value),
      }),
    ),
  );
  const input = container.querySelector("input")!;
  await act(async () => steppers().increase.click());
  expect(input.value).toBe("10");
  expect(drafts).toEqual(["10"]);
  // At the maximum the increase action is unavailable and the draft stays raw.
  expect(steppers().increase.disabled).toBe(true);
  await act(async () => steppers().decrease.click());
  await act(async () => steppers().decrease.click());
  expect(input.value).toBe("0");
  expect(steppers().decrease.disabled).toBe(true);
  expect(drafts).toEqual(["10", "5", "0"]);
});

it("steps step=any fields by one inside min and max and never throws", async () => {
  await act(async () =>
    root.render(
      createElement(NumberField, {
        label: "Allocation",
        min: 0.5,
        max: 2,
        step: "any",
        defaultValue: "1.25",
      }),
    ),
  );
  const input = container.querySelector("input")!;
  await act(async () => steppers().increase.click());
  expect(input.value).toBe("2");
  await act(async () => steppers().decrease.click());
  await act(async () => steppers().decrease.click());
  expect(input.value).toBe("0.5");
});

it("keeps empty drafts empty until a stepper is used, then starts from the native base", async () => {
  await act(async () =>
    root.render(createElement(NumberField, { label: "Count", min: 3, defaultValue: "" })),
  );
  const input = container.querySelector("input")!;
  expect(input.value).toBe("");
  await act(async () => steppers().increase.click());
  expect(input.value).toBe("3");
});

it("disables both steppers for disabled and read-only fields and can omit them", async () => {
  await act(async () =>
    root.render(createElement(NumberField, { label: "Locked", readOnly: true, defaultValue: "4" })),
  );
  expect(steppers().increase.disabled).toBe(true);
  expect(steppers().decrease.disabled).toBe(true);
  await act(async () =>
    root.render(createElement(NumberField, { label: "Off", disabled: true, defaultValue: "4" })),
  );
  expect(steppers().increase.disabled).toBe(true);
  await act(async () =>
    root.render(createElement(NumberField, { label: "Native", steppers: false })),
  );
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

it("never submits the surrounding form from a stepper and keeps typed drafts untouched", async () => {
  const submitted = vi.fn((event: Event) => event.preventDefault());
  await act(async () =>
    root.render(
      createElement(
        "form",
        { onSubmit: submitted },
        createElement(NumberField, { label: "Amount", name: "amount", defaultValue: "1" }),
      ),
    ),
  );
  const input = container.querySelector("input")!;
  await act(async () => {
    setNativeValue(input, "7");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => steppers().increase.click());
  expect(input.value).toBe("8");
  expect(submitted).not.toHaveBeenCalled();
});
