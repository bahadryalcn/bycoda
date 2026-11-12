// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteTagsEditor } from "./NoteTagsEditor";

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

it("assigns library and ready tags without losing custom draft input", async () => {
  const changed = vi.fn();
  function Consumer() {
    const [tags, setTags] = useState(["existing"]);
    return createElement(NoteTagsEditor, {
      tags,
      availableTags: ["shared"],
      onChange(next) {
        changed(next);
        setTags(next);
      },
    });
  }
  await act(async () => root.render(createElement(Consumer)));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Add note tag"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "custom draft",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(),
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (node) => node.textContent === "#shared",
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  expect(changed).toHaveBeenLastCalledWith(["existing", "shared"]);
  expect(container.querySelector('input[aria-label="Add note tag"]')).toBe(input);
  expect(input.value).toBe("custom draft");
  const ready = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (node) => node.textContent === "To do",
  )!;
  await act(async () => ready.click());
  expect(changed).toHaveBeenLastCalledWith(["existing", "shared", "todo"]);
});

it("disables ready-tag assignment at the note tag limit", async () => {
  await act(async () =>
    root.render(
      createElement(NoteTagsEditor, {
        tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
        onChange: vi.fn(),
      }),
    ),
  );
  expect(
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.disabled,
  ).toBe(true);
});
