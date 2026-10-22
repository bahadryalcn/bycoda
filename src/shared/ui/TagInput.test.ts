// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagInput } from "./TagInput";
import { setLanguagePreference } from "../i18n";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await setLanguagePreference("en");
  container.remove();
  vi.unstubAllGlobals();
});
it("announces tag selection and removal in the current app language", async () => {
  await setLanguagePreference("tr");
  await act(async () =>
    root.render(createElement(TagInput, { label: "Etiketler", defaultValue: ["alpha"] })),
  );
  const input = container.querySelector("input")!;
  expect(input.placeholder).toBe("Etiket ekle…");
  await key("Backspace");
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
    "alpha seçildi. Kaldırmak için Backspace tuşuna basın.",
  );
  await key("Backspace");
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("alpha");
  expect(container.querySelector('[aria-live="polite"]')?.textContent).not.toContain("Removed");
  expect(document.activeElement).toBe(input);
});
async function type(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
async function key(value: string, composing = false) {
  await act(async () =>
    container.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        isComposing: composing,
      }),
    ),
  );
}
it("preserves native ref/attributes and domain normalization, commits comma/blur, and caps tags", async () => {
  const ref = createRef<HTMLInputElement>();
  const changes = vi.fn();
  function Consumer() {
    const [tags, setTags] = useState<string[]>([]);
    return createElement(TagInput, {
      label: "Tags",
      value: tags,
      maxTags: 2,
      normalize: (items) => [
        ...new Set(items.map((s) => s.replace(/^#+/, "").trim().toLowerCase())),
      ],
      inputProps: { ref, name: "draft", autoComplete: "off" },
      onValueChange: (next) => {
        changes(next);
        setTags(next);
      },
    });
  }
  await act(async () => root.render(createElement(Consumer)));
  await type("#ONE,");
  expect(container.querySelector('[data-tag="one"]')).not.toBeNull();
  await type("one");
  await key("Enter");
  expect(changes).toHaveBeenCalledTimes(1);
  const input = await type("Two");
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(changes).toHaveBeenLastCalledWith(["one", "two"]);
  expect(ref.current).toBe(input);
  expect(input.readOnly).toBe(true);
  expect(input.name).toBe("draft");
});
it("retains composing input and preserves remove-on-backspace plus visible remove labels", async () => {
  const changed = vi.fn();
  function Consumer() {
    const [tags, setTags] = useState(["first"]);
    return createElement(TagInput, {
      label: "Tags",
      value: tags,
      onValueChange: (next) => {
        changed(next);
        setTags(next);
      },
      backspaceBehavior: "remove",
      removeLabel: (tag) => `Remove #${tag}`,
    });
  }
  await act(async () => root.render(createElement(Consumer)));
  await type("日本語");
  await key("Enter", true);
  expect(container.querySelectorAll("[data-tag]")).toHaveLength(1);
  await key("Enter");
  expect(container.querySelector('[data-tag="日本語"]')).not.toBeNull();
  await key("Backspace");
  expect(changed).toHaveBeenLastCalledWith(["first"]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Remove #first"]')!.click(),
  );
  expect(container.querySelector("input")!.value).toBe("");
  expect(changed).toHaveBeenLastCalledWith([]);
});
