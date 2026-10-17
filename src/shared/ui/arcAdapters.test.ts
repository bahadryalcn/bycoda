// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { SecondaryButton } from "./SecondaryButton";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";

let container: HTMLDivElement;
let root: Root;

it("keeps an outer input label and native ref without nesting another label", async () => {
  const ref = createRef<HTMLInputElement>();
  await act(async () =>
    root.render(
      createElement(
        "label",
        null,
        "Model ID",
        createElement(TextField, {
          ref,
          label: "",
          hideLabel: true,
          name: "model",
          required: true,
          defaultValue: "custom-model",
          list: "model-options",
          "aria-describedby": "model-help",
        }),
      ),
    ),
  );
  expect(container.querySelectorAll("label")).toHaveLength(1);
  expect(ref.current!.getAttribute("aria-label")).toBeNull();
  expect(ref.current!.getAttribute("list")).toBe("model-options");
  expect(ref.current!.getAttribute("aria-describedby")).toBe("model-help");
  expect(ref.current!.value).toBe("custom-model");
  expect(ref.current!.required).toBe(true);
});

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

it("keeps structural content, refs, form values, tab state and native events intact", async () => {
  const ref = createRef<HTMLButtonElement>();
  const doubleClick = vi.fn();
  const dragStart = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        Button,
        {
          ref,
          variant: "tab",
          role: "tab",
          "aria-selected": true,
          tabIndex: -1,
          name: "file",
          value: "readme",
          draggable: true,
          onDoubleClick: doubleClick,
          onDragStart: dragStart,
          shape: "pill",
        },
        createElement("div", { "data-content": "" }, "README"),
      ),
    ),
  );
  const button = ref.current!;
  expect(button.firstElementChild).toBe(button.querySelector("[data-content]"));
  expect(button.getAttribute("aria-selected")).toBe("true");
  expect(button.hasAttribute("aria-pressed")).toBe(false);
  expect(button.tabIndex).toBe(-1);
  expect(button.name).toBe("file");
  expect(button.value).toBe("readme");
  await act(async () => {
    button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    button.dispatchEvent(new Event("dragstart", { bubbles: true }));
  });
  expect(doubleClick).toHaveBeenCalledOnce();
  expect(dragStart).toHaveBeenCalledOnce();
});

it.each(["auto", "none"] as const)(
  "blocks aria-disabled activation and popup handlers with %s rendering without trapping navigation",
  async (motion) => {
    const click = vi.fn();
    const parentClick = vi.fn();
    const pointerDown = vi.fn();
    const keyDown = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          "div",
          { onClick: parentClick },
          createElement(
            Button,
            {
              motion,
              "aria-disabled": "true",
              "aria-haspopup": "menu",
              onClick: click,
              onPointerDown: pointerDown,
              onKeyDown: keyDown,
            },
            "Filters",
          ),
        ),
      ),
    );
    const button = container.querySelector("button")!;
    button.focus();
    await act(async () => {
      button.click();
      button.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
      );
    });
    expect(click).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(pointerDown).not.toHaveBeenCalled();
    expect(keyDown).toHaveBeenCalledOnce();
    expect(keyDown.mock.calls[0][0].key).toBe("Tab");
    expect(document.activeElement).toBe(button);
  },
);

it("keeps native loading focusable, prevents submission and exposes a busy name", async () => {
  const submit = vi.fn((event) => event.preventDefault());
  const click = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "form",
        { onSubmit: submit },
        createElement(
          Button,
          {
            type: "submit",
            motion: "none",
            loading: true,
            loadingLabel: "Saving note",
            onClick: click,
          },
          "Save",
        ),
      ),
    ),
  );
  const button = container.querySelector("button")!;
  button.focus();
  await act(async () => {
    button.click();
    button.click();
  });
  expect(submit).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe("Saving note");
  expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
});

it("uses an explicit name and tooltip for icon buttons while preserving caller ARIA", async () => {
  await act(async () =>
    root.render(
      createElement(Button, {
        iconOnly: true,
        label: "Refresh logs",
        tooltip: "Refresh from host",
        size: "sm",
        variant: "ghost",
        selected: true,
        "aria-pressed": true,
        startIcon: createElement("svg", { "data-icon": "" }),
      }),
    ),
  );
  const button = container.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe("Refresh logs");
  expect(button.title).toBe("Refresh from host");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.querySelector("[data-icon]")!.parentElement!.getAttribute("aria-hidden")).toBe(
    "true",
  );
});

it("extends SecondaryButton without changing its danger, ref or submit contract", async () => {
  const ref = createRef<HTMLButtonElement>();
  await act(async () =>
    root.render(
      createElement(
        SecondaryButton,
        {
          ref,
          danger: true,
          iconOnly: true,
          label: "Delete note",
          shape: "pill",
          type: "submit",
        },
        createElement("svg"),
      ),
    ),
  );
  expect(ref.current!.type).toBe("submit");
  expect(ref.current!.getAttribute("aria-label")).toBe("Delete note");
  expect(ref.current!.getAttribute("data-button-variant")).toBe("danger");
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
  expect(container.querySelector("label")).toBeNull();
  expect(input.getAttribute("aria-label")).toBe("Project name");
  expect(input.required).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toContain(
    "Choose a different name",
  );
  expect(new FormData(container.querySelector("form")!).get("project")).toBe("bycoda");
});
