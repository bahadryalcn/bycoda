// @vitest-environment happy-dom

import { act, createElement, useState } from "react";

import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SocialMultiSelect, type SocialSelectOption } from "./SocialMultiSelect";

import { SocialBusyContext, Composer } from "./socialShared";

let container: HTMLDivElement, root: Root;

const changed = vi.fn();

const options: SocialSelectOption[] = [
  { value: "local", label: "monocode", description: "G:/Projects/monocode" },

  { value: "remote", label: "monocode", description: "/worktrees/monocode" },

  {
    value: "blocked",

    label: "Private account",

    description: "Draft permission required",

    disabled: true,
  },
];

function Picker({ busy = false, initial = ["local"] }: { busy?: boolean; initial?: string[] }) {
  const [selected, setSelected] = useState(initial);

  return createElement(
    SocialBusyContext.Provider,
    { value: busy },
    createElement(SocialMultiSelect, {
      label: "Related projects",

      options,

      selected,

      searchPlaceholder: "Proje ara",

      onChange: (values) => {
        changed(values);

        setSelected(values);
      },
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  changed.mockReset();

  container = document.createElement("div");

  document.body.append(container);

  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());

  container.remove();

  vi.unstubAllGlobals();
});

async function mount(props: Parameters<typeof Picker>[0] = {}) {
  await act(async () => root.render(createElement(Picker, props)));
}

async function click(selector: string) {
  const element = document.body.querySelector<HTMLButtonElement>(selector)!;

  expect(element).toBeTruthy();

  await act(async () => element.click());
}

async function search(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);

    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  return input;
}

it("searches folder paths to distinguish duplicate project names and keeps multiple selections", async () => {
  await mount();

  await click('[aria-label="Related projects"]');

  expect(
    document.body.querySelector('[role="listbox"]')?.getAttribute("aria-multiselectable"),
  ).toBe("true");

  await search("worktrees");

  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1);

  await click('[role="option"]');

  expect(changed).toHaveBeenLastCalledWith(["local", "remote"]);

  expect(document.body.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe(
    "true",
  );

  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
});

it("toggles an option from the keyboard without submitting its enclosing form and restores focus on Escape", async () => {
  const submit = vi.fn();

  await act(async () =>
    root.render(
      createElement("form", { onSubmit: submit }, createElement(Picker, { initial: [] })),
    ),
  );

  await click('[aria-label="Related projects"]');

  const input = await search("worktrees");

  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );

  expect(changed).toHaveBeenLastCalledWith(["remote"]);

  expect(submit).not.toHaveBeenCalled();

  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  expect(document.activeElement).toBe(container.querySelector('[aria-label="Related projects"]'));
});

it("keeps unavailable selected IDs visible and removable instead of silently dropping them", async () => {
  await mount({ initial: ["missing"] });

  expect(container.textContent).toContain("Unavailable selection");

  await click('[aria-label="Remove Unavailable selection"]');

  expect(changed).toHaveBeenLastCalledWith([]);
});

it("blocks unauthorized options and closes an open picker while a host operation is running", async () => {
  await mount();

  await click('[aria-label="Related projects"]');

  await search("Private");

  const option = document.body.querySelector<HTMLButtonElement>('[role="option"]')!;

  expect(option.disabled).toBe(true);

  await act(async () => option.click());

  expect(changed).not.toHaveBeenCalled();

  await mount({ busy: true });

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Related projects"]')!.disabled,
  ).toBe(true);
});

it("shows a useful empty search and clears selection only on an explicit action", async () => {
  await mount();

  await click('[aria-label="Related projects"]');

  await search("does-not-exist");

  expect(document.body.querySelector('[role="status"]')?.textContent).toContain("No options match");

  expect(changed).not.toHaveBeenCalled();

  const clear = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Clear",
  )!;

  await act(async () => clear.click());

  expect(changed).toHaveBeenLastCalledWith([]);
});

it("keeps an unfinished form when its creation dialog is closed and reopened", async () => {
  await act(async () =>
    root.render(
      createElement(Composer, {
        title: "Add contact",

        children: createElement(
          "form",
          {},
          createElement("input", { defaultValue: "Unfinished contact" }),
        ),
      }),
    ),
  );

  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Add contact",
  )!;

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => trigger.click());

  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

  await click('[role="dialog"] [aria-label="Close"]');

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  await act(async () => trigger.click());

  expect(document.body.querySelector("input")?.value).toBe("Unfinished contact");
});

it("keeps composition Enter from selecting and restores focus with Done", async () => {
  await mount({ initial: [] });

  await click('[aria-label="Related projects"]');

  const input = await search("worktrees");

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

  expect(changed).not.toHaveBeenCalled();

  const done = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Done",
  )!;

  await act(async () => done.click());

  expect(document.body.querySelector('[role="dialog"]')).toBeNull();

  expect(document.activeElement).toBe(container.querySelector('[aria-label="Related projects"]'));
});
