// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { TagInput } from "./TagInput";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
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

const described = (control: Element) =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map(
      (id) =>
        document.getElementById(id)?.firstElementChild?.textContent ??
        document.getElementById(id)?.textContent,
    );

it("describes a text field by its error first, then the helper, and merges caller ids", async () => {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement("p", { id: "caller-note" }, "Caller note"),
        createElement(TextField, {
          label: "Name",
          description: "Lowercase letters only",
          error: "Name is taken",
          "aria-describedby": "caller-note",
        }),
      ),
    ),
  );
  const input = container.querySelector("input")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(described(input)).toEqual(["Caller note", "Name is taken", "Lowercase letters only"]);
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Name is taken");
  // The error is rendered above the helper, directly under the control.
  const [errorId, hintId] = input.getAttribute("aria-describedby")!.split(" ").slice(1);
  const position = document
    .getElementById(errorId)!
    .compareDocumentPosition(document.getElementById(hintId)!);
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps read-only fields editable for selection but unchanged, and distinct from disabled", async () => {
  const input = createRef<HTMLInputElement>();
  const textarea = createRef<HTMLTextAreaElement>();
  await act(async () =>
    root.render(
      createElement(
        "form",
        null,
        createElement(TextField, {
          ref: input,
          label: "Token",
          name: "token",
          defaultValue: "abc",
          readOnly: true,
        }),
        createElement(TextareaField, {
          ref: textarea,
          label: "Notes",
          name: "notes",
          defaultValue: "xyz",
          readOnly: true,
        }),
      ),
    ),
  );
  expect(input.current!.readOnly).toBe(true);
  expect(input.current!.disabled).toBe(false);
  expect(textarea.current!.readOnly).toBe(true);
  // Read-only values still submit; disabled ones do not.
  const data = new FormData(container.querySelector("form")!);
  expect(data.get("token")).toBe("abc");
  expect(data.get("notes")).toBe("xyz");
});

it("orders textarea error before helper", async () => {
  await act(async () =>
    root.render(
      createElement(TextareaField, { label: "Notes", description: "Markdown", error: "Required" }),
    ),
  );
  const area = container.querySelector("textarea")!;
  expect(area.getAttribute("aria-invalid")).toBe("true");
  expect(described(area)).toEqual(["Required", "Markdown"]);
});

it("marks a tag input invalid with a local alert and keeps caller descriptions", async () => {
  await act(async () =>
    root.render(
      createElement(TagInput, {
        label: "Labels",
        error: "At least one label",
        description: "Press Enter to add",
        inputProps: { "aria-describedby": "outside" },
      }),
    ),
  );
  const input = container.querySelector("input")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")!.split(" ")[0]).toBe("outside");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("At least one label");
  expect(described(input).slice(1)).toEqual(["At least one label", "Press Enter to add"]);
});
