// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PromptField } from "./PromptField";

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

it("sets per-side inset and indent on the editor box shared with the overlay", () => {
  const ref = createRef<HTMLTextAreaElement>();
  act(() =>
    root.render(
      createElement(PromptField, {
        label: "Prompt",
        ref,
        framed: false,
        inset: { blockStart: "1rem", inlineEnd: "2.25rem" },
        indent: "15px",
        overlay: "mirror",
        defaultValue: "",
      }),
    ),
  );
  const editor = container.querySelector<HTMLElement>("[data-text-size]")!;
  expect(editor.style.getPropertyValue("--prompt-pad-block-start")).toBe("1rem");
  expect(editor.style.getPropertyValue("--prompt-pad-inline-end")).toBe("2.25rem");
  expect(editor.style.getPropertyValue("--prompt-pad-inline-start")).toBe("");
  expect(editor.style.getPropertyValue("--prompt-indent")).toBe("15px");
  expect(editor.contains(container.querySelector("[aria-hidden]"))).toBe(true);
  expect(ref.current?.getAttribute("aria-label")).toBe("Prompt");
});

it("fills the parent and lets a standalone editor own its focus", () => {
  act(() =>
    root.render(
      createElement(PromptField, {
        label: "Note",
        framed: false,
        fill: true,
        focus: "input",
        autosize: false,
        textSize: "secondary",
      }),
    ),
  );
  const field = container.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(field.getAttribute("data-ui-focus")).toBe("input");
  expect(field.hasAttribute("data-fill")).toBe(true);
  expect(container.querySelector("[data-prompt-field]")?.hasAttribute("data-fill")).toBe(true);
  expect(container.querySelector("[data-text-size]")?.getAttribute("data-text-size")).toBe(
    "secondary",
  );
});
