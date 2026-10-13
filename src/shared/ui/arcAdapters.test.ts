// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";

let container: HTMLDivElement;
let root: Root;

it("preserves textarea ref, native validation and an existing outer label", async () => {
  const ref = createRef<HTMLTextAreaElement>();
  await act(async () =>
    root.render(
      createElement(
        "label",
        null,
        "Draft",
        createElement(TextareaField, {
          ref,
          label: "Draft",
          hideLabel: true,
          required: true,
          rows: 3,
          name: "draft",
        }),
      ),
    ),
  );
  expect(container.querySelectorAll("label")).toHaveLength(1);
  expect(ref.current!.required).toBe(true);
  expect(ref.current!.rows).toBe(3);
  expect(ref.current!.checkValidity()).toBe(false);
  ref.current!.value = "Retain content";
  expect(ref.current!.checkValidity()).toBe(true);
  ref.current!.focus();
  expect(document.activeElement).toBe(ref.current);
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("defaults to a non-submit button and preserves explicit form submission", async () => {
  const submit = vi.fn((event: Event) => event.preventDefault());
  await act(async () =>
    root.render(createElement("form", { onSubmit: submit }, createElement(Button, null, "Save"))),
  );
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(submit).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      createElement(
        "form",
        { onSubmit: submit },
        createElement(Button, { type: "submit" }, "Save"),
      ),
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(submit).toHaveBeenCalledTimes(1);
});

it("keeps a loading button focusable and prevents duplicate actions", async () => {
  const click = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  await act(async () =>
    root.render(createElement(Button, { ref, loading: true, onClick: click }, "Save")),
  );
  ref.current!.focus();
  await act(async () => {
    ref.current!.click();
    ref.current!.click();
  });
  expect(click).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(ref.current);
  expect(ref.current!.disabled).toBe(false);
  expect(ref.current!.getAttribute("aria-busy")).toBe("true");
});

it("preserves native drag handlers through the adapter", async () => {
  const drag = vi.fn();
  await act(async () =>
    root.render(createElement(Button, { draggable: true, onDrag: drag }, "Move")),
  );
  await act(async () =>
    container.querySelector("button")!.dispatchEvent(new Event("drag", { bubbles: true })),
  );
  expect(drag).toHaveBeenCalledTimes(1);
});

it("keeps hidden field labels, refs, validation descriptions and native form values", async () => {
  const ref = createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(TextField, {
          ref,
          label: "Project name",
          hideLabel: true,
          name: "project",
          defaultValue: "bycoda",
          required: true,
          error: "Choose a different name",
        }),
      ),
    ),
  );
  const input = ref.current!;
  expect(container.querySelector("label")!.htmlFor).toBe(input.id);
  expect(input.required).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toContain(
    "Choose a different name",
  );
  expect(new FormData(container.querySelector("form")!).get("project")).toBe("bycoda");
});
