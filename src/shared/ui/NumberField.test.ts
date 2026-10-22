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
