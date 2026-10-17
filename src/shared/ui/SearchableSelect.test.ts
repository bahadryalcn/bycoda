// @vitest-environment happy-dom

import { act, createElement, createRef } from "react";

import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LAYER } from "../lib/layers";

import { SearchableSelect } from "./SearchableSelect";

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

  document.body

    .querySelectorAll("[data-dialog-popover]")

    .forEach((element) => element.parentElement?.remove());

  vi.unstubAllGlobals();
});

it("raises menus above a containing modal by default", async () => {
  await act(async () => {
    root.render(
      createElement(
        "div",
        { role: "dialog" },
        createElement(SearchableSelect, {
          label: "Agent",

          value: "codex",

          options: [
            { value: "codex", label: "Codex" },

            { value: "claude", label: "Claude" },
          ],

          onChange: vi.fn(),
        }),
      ),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;

  await act(async () => trigger.click());

  const menu = document.body.querySelector<HTMLElement>('[aria-label="Agent options"]');

  expect(menu).not.toBeNull();

  expect(menu!.parentElement!.style.zIndex).toBe(String(LAYER.dialogPopover));
});

it("does not scroll the page when a compact menu opens", async () => {
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

  await act(async () => {
    root.render(
      createElement(SearchableSelect, {
        label: "Timeout",

        value: "60",

        variant: "pill",

        searchable: false,

        options: [
          { value: "30", label: "30 sec" },

          { value: "60", label: "1 min" },

          { value: "120", label: "2 min" },

          { value: "300", label: "5 min" },
        ],

        onChange: vi.fn(),
      }),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;

  await act(async () => trigger.click());

  await act(async () => {
    await Promise.resolve();
  });

  expect(scrollIntoView).not.toHaveBeenCalled();

  const option = document.body.querySelector('[role="option"]');

  expect(option?.className).toContain("h-7");
});

async function search(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);

    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  return input;
}

it("preserves native trigger refs and descriptions, cancellation and disabled metadata", async () => {
  const ref = createRef<HTMLButtonElement>();

  const onChange = vi.fn();

  const cancel = vi.fn((event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault());

  const props = {
    label: "Account",
    value: "private",
    options: [
      { value: "private", label: "Private", disabled: true, description: "Permission required" },
    ],

    onChange,
    triggerProps: { ref, id: "account", "aria-describedby": "help", onClick: cancel },
  };

  await act(async () => root.render(createElement(SearchableSelect, props)));

  expect(ref.current?.id).toBe("account");

  expect(ref.current?.getAttribute("aria-describedby")).toBe("help");

  await act(async () => ref.current!.click());

  expect(document.body.querySelector('[role="listbox"]')).toBeNull();

  await act(async () =>
    root.render(createElement(SearchableSelect, { ...props, triggerProps: { ref } })),
  );

  await act(async () => ref.current!.click());

  const option = document.body.querySelector<HTMLButtonElement>('[role="option"]')!;

  expect(option.disabled).toBe(true);

  expect(option.getAttribute("aria-disabled")).toBe("true");

  expect(document.getElementById(option.getAttribute("aria-describedby")!)?.textContent).toBe(
    "Permission required",
  );

  const input = await search("Permission");

  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );

  expect(onChange).not.toHaveBeenCalled();
});

it("uses explicit Turkish case folding and option descriptions for search without choosing on IME Enter", async () => {
  const onChange = vi.fn();

  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Registry",
        value: "",
        options: [{ value: "isparta", label: "ISPARTA", description: "İlgili proje" }],

        searchLocale: "tr",
        onChange,
      }),
    ),
  );

  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());

  const input = await search("ısparta");

  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);

  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    ),
  );

  expect(onChange).not.toHaveBeenCalled();

  await search("ilgili");

  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);
});

it("counts unavailable selected values and clears them only through an explicit action", async () => {
  const onChange = vi.fn();

  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        multiple: true,
        label: "Registry",
        value: ["missing"],
        options: [],
        onChange,
      }),
    ),
  );

  expect(container.querySelector("button")?.textContent).toContain("missing");

  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());

  expect(onChange).not.toHaveBeenCalled();

  const clear = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Clear selection",
  )!;

  expect(clear).toBeTruthy();

  await act(async () => clear.click());

  expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
});
