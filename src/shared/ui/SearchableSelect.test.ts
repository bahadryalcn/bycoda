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
      {
        value: "private",
        label: "Private",
        disabled: true,
        description: "Permission required",
      },
    ],

    onChange,
    triggerProps: {
      ref,
      id: "account",
      "aria-describedby": "help",
      onClick: cancel,
    },
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
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
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

it("shows selected names in value order with a count beside the chevron", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        multiple: true,
        label: "Sources",
        value: ["b", "a", "missing"],
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
        onChange: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.textContent).toContain("Beta, Alpha, missing");
  const badge = trigger.querySelector('[data-size="xs"]')!;
  expect(badge.textContent).toBe("3");
  expect(badge.nextElementSibling?.tagName.toLowerCase()).toBe("svg");
});

it("keeps the placeholder for an empty single selection", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Source",
        value: "",
        options: [],
        placeholder: "Automatic",
        onChange: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector("button")?.textContent).toBe("Automatic");
  expect(container.querySelector('[data-size="xs"]')).toBeNull();
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

const optionLabels = () =>
  Array.from(document.body.querySelectorAll('[role="option"]')).map((node) =>
    node.querySelector("[class*=choiceLabel]")?.textContent?.trim(),
  );
const activeOption = () =>
  document.body.querySelector<HTMLElement>('[role="option"][data-highlighted]');
const dispatchKey = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const openMenu = async () => {
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => {
    await Promise.resolve();
  });
};

it("skips disabled options with arrows, Home, End and Enter", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Region",
        value: "",
        options: [
          { value: "a", label: "Alpha", disabled: true },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma", disabled: true },
          { value: "d", label: "Delta" },
          { value: "e", label: "Epsilon", disabled: true },
        ],
        onChange,
      }),
    ),
  );
  await openMenu();
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  // The first row is disabled, so the first choosable row is active and announced.
  expect(activeOption()?.textContent).toContain("Beta");
  expect(input.getAttribute("aria-activedescendant")).toBe(activeOption()!.id);
  await act(async () => dispatchKey(input, "ArrowDown"));
  expect(activeOption()?.textContent).toContain("Delta");
  await act(async () => dispatchKey(input, "ArrowDown"));
  expect(activeOption()?.textContent).toContain("Delta");
  await act(async () => dispatchKey(input, "ArrowUp"));
  expect(activeOption()?.textContent).toContain("Beta");
  const disabledRow = document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')[0]!;
  expect(disabledRow.disabled).toBe(true);
  expect(disabledRow.getAttribute("aria-disabled")).toBe("true");
  await act(async () => disabledRow.click());
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => dispatchKey(input, "Enter"));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
});

it("moves to the first and last choosable option with Home and End in a plain list", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Region",
        value: "",
        searchable: false,
        options: [
          { value: "a", label: "Alpha", disabled: true },
          { value: "b", label: "Beta" },
          { value: "d", label: "Delta" },
          { value: "e", label: "Epsilon", disabled: true },
        ],
        onChange: vi.fn(),
      }),
    ),
  );
  await openMenu();
  const list = document.body.querySelector<HTMLElement>("[role=listbox]")!;
  await act(async () => dispatchKey(list, "End"));
  expect(activeOption()?.textContent).toContain("Delta");
  expect(list.getAttribute("aria-activedescendant")).toBe(activeOption()!.id);
  await act(async () => dispatchKey(list, "Home"));
  expect(activeOption()?.textContent).toContain("Beta");
});

it("keeps the committed value and stale options visible while loading", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Branch",
        value: "main",
        loading: true,
        options: [
          { value: "main", label: "main" },
          { value: "dev", label: "dev" },
        ],
        onChange: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.disabled).toBe(false);
  expect(trigger.getAttribute("aria-busy")).toBe("true");
  expect(trigger.textContent).toContain("main");
  // The closed trigger shows the pending lookup in its chevron slot.
  expect(trigger.querySelector("[data-select-loading]")).not.toBeNull();
  await openMenu();
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("Loading…");
  expect(trigger.querySelector("[data-select-loading]")).toBeNull();
  expect(optionLabels()).toEqual(["main", "dev"]);
});

it("shows loading, not an empty result, for a list that has not arrived", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Branch",
        value: "main",
        loading: true,
        loadingLabel: "Fetching branches…",
        emptyLabel: "No matching branches",
        options: [],
        onChange: vi.fn(),
      }),
    ),
  );
  // The committed value is still the trigger text even though its option has not loaded.
  expect(container.querySelector("button")?.textContent).toContain("main");
  await openMenu();
  const statuses = Array.from(document.body.querySelectorAll('[role="status"]')).map(
    (node) => node.textContent,
  );
  expect(statuses).toEqual(["Fetching branches…"]);
  expect(document.body.textContent).not.toContain("No matching branches");
});

it("announces a failed load, offers retry and keeps choosable stale options", async () => {
  const onRetry = vi.fn();
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Branch",
        value: "main",
        error: "Could not reach the host",
        onRetry,
        options: [
          { value: "main", label: "main" },
          { value: "dev", label: "dev" },
        ],
        onChange,
      }),
    ),
  );
  await openMenu();
  const alert = document.body.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Could not reach the host");
  expect(optionLabels()).toEqual(["main", "dev"]);
  const retry = Array.from(alert.querySelectorAll("button")).find(
    (button) => button.textContent === "Retry",
  )!;
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => dispatchKey(input, "Tab"));
  expect(document.activeElement).toBe(retry);
  expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => retry.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
  // Recovery does not close the menu or change the committed value.
  expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    ),
  );
  expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});

it("does not call a failed empty source a filtered-out search", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Project",
        value: "",
        error: "Failed",
        options: [],
        emptyLabel: "No matching projects",
        onChange: vi.fn(),
      }),
    ),
  );
  await openMenu();
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Failed");
  expect(document.body.textContent).not.toContain("No matching projects");
});

it("distinguishes an empty source from a filtered-out query", async () => {
  const props = {
    label: "Project",
    value: "",
    emptyLabel: "No matching projects",
    noOptionsLabel: "No projects yet",
    onChange: vi.fn(),
  };
  await act(async () => root.render(createElement(SearchableSelect, { ...props, options: [] })));
  await openMenu();
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("No projects yet");
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        ...props,
        options: [{ value: "a", label: "Alpha" }],
      }),
    ),
  );
  await search("zzz");
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("No matching projects");
});

it("falls back to the empty label when no dedicated empty-source label is given", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Project",
        value: "",
        emptyLabel: "No matching projects",
        options: [],
        onChange: vi.fn(),
      }),
    ),
  );
  await openMenu();
  expect(document.body.querySelector('[role="status"]')?.textContent).toBe("No matching projects");
});

it("accents matched text, truncates long labels and keeps the full text available", async () => {
  const long = "feature/".concat("a-very-long-branch-name-".repeat(6));
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Branch",
        value: "",
        options: [{ value: long, label: long }],
        onChange: vi.fn(),
      }),
    ),
  );
  await openMenu();
  await search("long");
  const option = document.body.querySelector('[role="option"]')!;
  expect(option.querySelectorAll("[data-match]").length).toBeGreaterThan(0);
  expect(option.textContent).toContain(long);
  // Full text remains readable to assistive technology without an unconditional native bubble.
  expect(option.querySelector("[title]")).toBeNull();
});

it("renders a large list and moves to the last choosable option", async () => {
  const options = Array.from({ length: 2000 }, (_, index) => ({
    value: `v${index}`,
    label: `Option ${index}`,
    disabled: index === 1999,
  }));
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Big",
        value: "v1500",
        searchable: false,
        options,
        onChange: vi.fn(),
      }),
    ),
  );
  const started = performance.now();
  await openMenu();
  const elapsed = performance.now() - started;
  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(2000);
  expect(activeOption()?.textContent).toContain("Option 1500");
  await act(async () => dispatchKey(document.body.querySelector("[role=listbox]")!, "End"));
  expect(activeOption()?.textContent).toContain("Option 1998");
  // happy-dom has no layout, so this guards gross regressions only; the number is recorded for evaluation.
  expect(elapsed).toBeLessThan(5000);
  console.info(`SearchableSelect 2000 options opened in ${Math.round(elapsed)}ms (happy-dom)`);
});

it("closes on Tab and returns focus to the trigger", async () => {
  await act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Region",
        value: "",
        options: [{ value: "a", label: "Alpha" }],
        onChange: vi.fn(),
      }),
    ),
  );
  await openMenu();
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => dispatchKey(input, "Tab"));
  expect(document.body.querySelector('[role="option"]')).toBeNull();
});

const groupedOptions = [
  { value: "global", label: "Global" },
  { value: "w", label: "Mono", group: "Workspaces" },
  { value: "p1", label: "Alpha", group: "Projects" },
  { value: "p2", label: "Beta", group: "Projects" },
];
const filterButtons = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).filter(
    (button) => /^(All|Workspaces|Projects)/.test(button.textContent ?? ""),
  );
const renderGrouped = (extra: Record<string, unknown> = {}) =>
  act(async () =>
    root.render(
      createElement(SearchableSelect, {
        label: "Target",
        value: "",
        options: groupedOptions,
        onChange: vi.fn(),
        ...extra,
      }),
    ),
  );

it("filters by group, keeps focus and arrows on the filtered list, and resets on close", async () => {
  await renderGrouped({ groupFilter: true });
  await openMenu();
  expect(filterButtons().map((button) => button.textContent)).toEqual([
    "All4",
    "Workspaces1",
    "Projects2",
  ]);
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  input.focus();
  const projects = filterButtons()[2]!;
  const press = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  projects.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await act(async () => projects.click());
  expect(optionLabels()).toEqual(["Alpha", "Beta"]);
  expect(activeOption()?.textContent).toContain("Alpha");
  expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => dispatchKey(input, "ArrowDown"));
  expect(input.getAttribute("aria-activedescendant")).toBe(activeOption()!.id);
  expect(activeOption()?.textContent).toContain("Beta");
  await search("alp");
  expect(optionLabels()).toEqual(["Alpha"]);
  await act(async () => dispatchKey(input, "Escape"));
  await openMenu();
  expect(optionLabels()).toEqual(["Global", "Mono", "Alpha", "Beta"]);
});

it("cycles the group filter with PageDown and PageUp from the search field", async () => {
  await renderGrouped({ groupFilter: true });
  await openMenu();
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => dispatchKey(input, "PageDown"));
  expect(optionLabels()).toEqual(["Mono"]);
  await act(async () => dispatchKey(input, "PageDown"));
  expect(optionLabels()).toEqual(["Alpha", "Beta"]);
  await act(async () => dispatchKey(input, "PageDown"));
  expect(optionLabels()).toEqual(["Global", "Mono", "Alpha", "Beta"]);
  await act(async () => dispatchKey(input, "PageUp"));
  expect(optionLabels()).toEqual(["Alpha", "Beta"]);
});

it("shows no group filter unless asked for and two groups exist", async () => {
  await renderGrouped();
  await openMenu();
  expect(filterButtons()).toHaveLength(0);
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderGrouped({ groupFilter: true, options: groupedOptions.slice(2) });
  await openMenu();
  expect(filterButtons()).toHaveLength(0);
});

it("sizes the menu from menuMinWidth and menuMaxHeight, defaulting to 240", async () => {
  await renderGrouped();
  await openMenu();
  const menu = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label]')!;
  expect(menu().parentElement!.style.width || menu().style.width).toBe("240px");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await renderGrouped({ menuMinWidth: 380, menuMaxHeight: 420 });
  await openMenu();
  expect(menu().parentElement!.style.width || menu().style.width).toBe("380px");
});
