// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { InlineEdit } from "./InlineEdit";
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
async function render(value: string, onSave = vi.fn()) {
  await act(async () =>
    root.render(createElement(InlineEdit, { value, label: "Note title", onSave })),
  );
  return onSave;
}
async function edit(text = "Local draft") {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Note title:"]')!.click(),
  );
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
async function escape(input: HTMLInputElement, isComposing = false) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", isComposing, bubbles: true }),
    ),
  );
}
it("updates an idle title when the saved value changes externally", async () => {
  await render("Original");
  await render("External update");
  expect(
    container.querySelector('button[aria-label="Note title: External update"]'),
  ).not.toBeNull();
});
it("shows the latest external title after cancelling a local edit", async () => {
  const save = await render("Original");
  const input = await edit();
  await render("External update", save);
  await escape(input);
  expect(save).not.toHaveBeenCalled();
  expect(
    container.querySelector('button[aria-label="Note title: External update"]'),
  ).not.toBeNull();
});
it("keeps the editor open when Escape belongs to active IME composition", async () => {
  const save = await render("Original");
  const input = await edit("入力中");
  await escape(input, true);
  expect(save).not.toHaveBeenCalled();
  expect(container.querySelector("input")?.value).toBe("入力中");
});
it("cancels a normal non-composing Escape without saving", async () => {
  const save = await render("Original");
  const input = await edit();
  await escape(input);
  expect(container.querySelector("input")).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it.each([false, true])(
  "retains an external update while a save settles (rejected=%s)",
  async (rejected) => {
    let resolve!: () => void;
    let reject!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((yes, no) => {
          resolve = yes;
          reject = () => no(new Error("Failed"));
        }),
    );
    await render("Original", save);
    const input = await edit();
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    await render("External update", save);
    await act(async () => {
      if (rejected) reject();
      else resolve();
    });
    expect(
      container.querySelector('button[aria-label="Note title: External update"]'),
    ).not.toBeNull();
  },
);

it("keeps composing Escape with key code 229 available to the IME", async () => {
  await render("Original");
  const input = await edit("Composition draft");
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true }),
    ),
  );
  expect(container.querySelector("input")?.value).toBe("Composition draft");
});

it("reconciles a submitted draft already equal to the latest saved value", async () => {
  const save = await render("Original");
  const input = await edit("External update");
  await render("External update", save);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(save).not.toHaveBeenCalled();
  expect(
    container.querySelector('button[aria-label="Note title: External update"]'),
  ).not.toBeNull();
});
