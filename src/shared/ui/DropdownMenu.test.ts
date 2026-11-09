// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu";
import { NativePopupHost } from "./NativePopupHost";

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
const items: DropdownMenuItem[] = [
  { kind: "item", id: "archive", label: "Archive", disabled: true },
  { kind: "sep" },
  { kind: "item", id: "copy", label: "Copy" },
  { kind: "item", id: "duplicate", label: "Duplicate" },
  { kind: "item", id: "delete", label: "Delete", danger: true },
  { kind: "item", id: "pin", label: "Pin", checked: false, description: "Keep this note visible" },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(container, anchor);
  root = createRoot(container);
  anchor.focus();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchor.remove();
  vi.unstubAllGlobals();
});
async function key(value: string, init?: KeyboardEventInit) {
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init }),
    ),
  );
}
function focused() {
  return document.activeElement?.getAttribute("aria-label");
}
it("navigates enabled rows with wrap, Home/End and cyclic typeahead without activating them", async () => {
  const pick = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Note actions",
        items,
        onPick: pick,
        onClose: vi.fn(),
      }),
    ),
  );
  expect(focused()).toBe("Copy");
  await key("ArrowUp");
  expect(focused()).toBe("Pin");
  await key("Home");
  expect(focused()).toBe("Copy");
  await key("End");
  expect(focused()).toBe("Pin");
  await key("d");
  expect(focused()).toBe("Duplicate");
  await key("d");
  expect(focused()).toBe("Delete");
  await key("ArrowDown");
  expect(focused()).toBe("Pin");
  expect(pick).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked")).toBe(
    "false",
  );
});
it("blocks disabled and duplicate picks, restores trigger before the domain callback takes focus", async () => {
  const close = vi.fn();
  const dialogAction = document.createElement("button");
  document.body.append(dialogAction);
  const pick = vi.fn(() => {
    expect(document.activeElement).toBe(anchor);
    dialogAction.focus();
  });
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Actions",
        items,
        onPick: pick,
        onClose: close,
      }),
    ),
  );
  await act(async () =>
    (document.querySelector('[aria-label="Archive"]') as HTMLButtonElement).click(),
  );
  expect(close).not.toHaveBeenCalled();
  const copy = document.querySelector('[aria-label="Copy"]') as HTMLButtonElement;
  await act(async () => {
    copy.click();
    copy.click();
  });
  expect(close).toHaveBeenCalledOnce();
  expect(pick).toHaveBeenCalledExactlyOnceWith("copy");
  expect(document.activeElement).toBe(dialogAction);
  dialogAction.remove();
});
it("lets the shared overlay handle Escape and returns focus", async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Actions",
        items,
        onPick: vi.fn(),
        onClose: close,
      }),
    ),
  );
  await key("Escape");
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchor);
});
it("routes into the existing native popup host and ignores composing typeahead", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    root.render(
      createElement(
        NativePopupHost.Provider,
        { value: host },
        createElement(DropdownMenu, {
          anchor,
          label: "Native actions",
          items,
          onPick: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    ),
  );
  expect(host.querySelector('[role="menu"]')).not.toBeNull();
  expect(focused()).toBe("Copy");
  await key("d", { isComposing: true });
  expect(focused()).toBe("Copy");
  await act(async () => root.render(null));
  host.remove();
});
it("keeps an empty or fully disabled menu keyboard safe", async () => {
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Unavailable actions",
        items: [items[0]],
        onPick: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
  const menu = document.querySelector('[role="menu"]') as HTMLElement;
  menu.focus();
  await key("ArrowDown");
  await key("End");
  expect(document.activeElement).toBe(menu);
});

it("keeps the menu open for checkbox rows so several can be toggled", async () => {
  const pick = vi.fn();
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Subagents",
        onPick: pick,
        onClose: close,
        items: [
          { kind: "item", id: "a", label: "A", checked: false, selectionRole: "checkbox" },
          { kind: "item", id: "b", label: "B", checked: false, selectionRole: "checkbox" },
        ],
      }),
    ),
  );
  const rows = document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]');
  await act(async () => rows[0].click());
  await act(async () => rows[1].click());
  expect(pick.mock.calls).toEqual([["a"], ["b"]]);
  expect(close).not.toHaveBeenCalled();
});

it("announces mutually exclusive choices as radios without changing the callback owner", async () => {
  const pick = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Merge method",
        onPick: pick,
        onClose: vi.fn(),
        items: [
          { kind: "item", id: "merge", label: "Merge", checked: true, selectionRole: "radio" },
          { kind: "item", id: "squash", label: "Squash", checked: false, selectionRole: "radio" },
        ],
      }),
    ),
  );
  const radios = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
  expect(radios).toHaveLength(2);
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  expect(radios[1].getAttribute("aria-checked")).toBe("false");
  await act(async () => radios[1].click());
  expect(pick).toHaveBeenCalledExactlyOnceWith("squash");
});

it("navigates across named groups, skips disabled actions and keeps selection with the owner", async () => {
  const pick = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Composer actions",
        onPick: pick,
        onClose: vi.fn(),
        "data-composer-plus": true,
        items: [
          {
            kind: "group",
            id: "add",
            label: "Add to message",
            items: [
              {
                kind: "item",
                id: "upload",
                label: "Upload file",
                disabled: true,
                description: "Attachments are unavailable",
              },
              { kind: "item", id: "skills", label: "Skills" },
            ],
          },
          { kind: "group", id: "empty", label: "Unavailable group", items: [] },
          {
            kind: "group",
            id: "mode",
            label: "Mode",
            items: [
              {
                kind: "item",
                id: "plan",
                label: "Plan mode",
                checked: true,
                description: "Review a plan before building",
              },
              {
                kind: "item",
                id: "orchestrator",
                label: "Orchestrator",
                badge: "v1",
                checked: false,
              },
            ],
          },
        ],
      }),
    ),
  );
  expect(document.querySelectorAll('[role="group"]')).toHaveLength(2);
  expect(document.querySelector("[data-composer-plus]")).not.toBeNull();
  expect(focused()).toBe("Skills");
  await key("ArrowDown");
  expect(focused()).toBe("Plan mode");
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
  await key("End");
  expect(focused()).toBe("Orchestrator");
  expect(document.activeElement?.textContent).toContain("v1");
  await key("ArrowDown");
  expect(focused()).toBe("Skills");
  await key("p");
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(pick).toHaveBeenCalledExactlyOnceWith("plan");
  expect(document.activeElement).toBe(anchor);
});

it("reserves one leading icon slot so labels align, and keeps shortcut/check in the trailing slot", async () => {
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Slots",
        onPick: vi.fn(),
        onClose: vi.fn(),
        items: [
          { kind: "item", id: "a", label: "With icon", icon: createElement("svg"), shortcut: "F2" },
          { kind: "item", id: "b", label: "No icon", checked: true },
          { kind: "item", id: "c", label: "Described", description: "Quiet detail" },
        ],
      }),
    ),
  );
  const rows = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.querySelectorAll('[class*="_icon_"]')).toHaveLength(1);
  expect(rows[0].querySelector('[class*="_shortcut_"]')?.textContent).toBe("F2");
  expect(rows[1].querySelector('[class*="_trailing_"] svg')).not.toBeNull();
  expect(rows[2].getAttribute("data-described")).toBe("true");
  expect(rows[2].getAttribute("aria-description")).toBe("Quiet detail");
});

it("scrolls keyboard-focused rows into view but never scrolls on pointer hover", async () => {
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    await act(async () =>
      root.render(
        createElement(DropdownMenu, {
          anchor,
          label: "Actions",
          items,
          onPick: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    await key("ArrowDown");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    scroll.mockClear();
    await act(async () =>
      document
        .querySelector('[aria-label="Duplicate"]')!
        .dispatchEvent(new PointerEvent("pointermove", { bubbles: true })),
    );
    expect(focused()).toBe("Duplicate");
    expect(scroll).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});
it("keeps the menu open for rows and menus that opt out of closeOnSelect", async () => {
  const close = vi.fn();
  const pick = vi.fn();
  const rows: DropdownMenuItem[] = [
    { kind: "item", id: "a", label: "Alpha", checked: true, selectionRole: "radio" },
    { kind: "item", id: "b", label: "Beta", checked: false, selectionRole: "radio" },
    { kind: "item", id: "c", label: "Gamma", closeOnSelect: true },
  ];
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Filters",
        items: rows,
        closeOnSelect: false,
        onPick: pick,
        onClose: close,
      }),
    ),
  );
  const click = (label: string) =>
    act(async () =>
      (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click(),
    );
  await click("Alpha");
  await click("Beta");
  expect(pick.mock.calls).toEqual([["a"], ["b"]]);
  expect(close).not.toHaveBeenCalled();
  await click("Gamma");
  expect(close).toHaveBeenCalledOnce();
});

const branchItems: DropdownMenuItem[] = [
  { kind: "item", id: "plain", label: "Plain" },
  {
    kind: "item",
    id: "models",
    label: "Models",
    submenu: [
      { kind: "item", id: "fast", label: "Fast" },
      {
        kind: "item",
        id: "deep",
        label: "Deep",
        submenu: [{ kind: "item", id: "deep-max", label: "Max" }],
      },
    ],
  },
  { kind: "item", id: "last", label: "Last" },
];
async function renderMenu(extra: Record<string, unknown>) {
  const pick = vi.fn();
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(DropdownMenu, {
        anchor,
        label: "Branches",
        items: branchItems,
        onPick: pick,
        onClose: close,
        ...extra,
      }),
    ),
  );
  return { pick, close };
}
it("opens a flyout with ArrowRight, closes it with ArrowLeft and returns focus to the parent row", async () => {
  await renderMenu({});
  await key("ArrowDown");
  expect(focused()).toBe("Models");
  await key("ArrowRight");
  expect(document.querySelector('[aria-label="Models"][role="menu"]')).not.toBeNull();
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expect(focused()).toBe("Fast");
  await key("ArrowRight");
  expect(focused()).toBe("Fast");
  await key("ArrowDown");
  await key("ArrowRight");
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expect(focused()).toBe("Max");
  await key("ArrowLeft");
  expect(focused()).toBe("Deep");
  await key("ArrowLeft");
  expect(focused()).toBe("Models");
  expect(document.querySelector('[role="menu"][aria-label="Models"]')).toBeNull();
});
it("picks a flyout leaf, reports its id and closes the whole menu", async () => {
  const { pick, close } = await renderMenu({});
  await act(async () =>
    document.querySelector<HTMLElement>('[aria-label="Models"][role^="menuitem"]')!.click(),
  );
  const leaf = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Fast"]')!;
  await act(async () => leaf.click());
  expect(pick).toHaveBeenCalledWith("fast");
  expect(close).toHaveBeenCalledTimes(1);
});
it("opens a flyout on hover and closes it when the pointer moves to a plain row", async () => {
  vi.useFakeTimers();
  try {
    await renderMenu({});
    const models = document.querySelector<HTMLElement>('[aria-label="Models"][role^="menuitem"]')!;
    await act(async () => {
      models.dispatchEvent(new Event("pointermove", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"][aria-label="Models"]')).not.toBeNull();
    const last = document.querySelector<HTMLElement>('[aria-label="Last"]')!;
    await act(async () => {
      last.dispatchEvent(new Event("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    expect(document.querySelector('[role="menu"][aria-label="Models"]')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps focus in the search field while arrows move the highlighted row, and Enter picks it", async () => {
  const onChange = vi.fn();
  const { pick } = await renderMenu({
    search: { value: "", onChange, label: "Filter" },
  });
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Filter"]')!;
  await act(async () => field.focus());
  const highlightedLabel = () =>
    document.querySelector('[data-highlighted="true"]')?.getAttribute("aria-label");
  expect(highlightedLabel()).toBe("Plain");
  await key("ArrowDown");
  expect(document.activeElement).toBe(field);
  expect(highlightedLabel()).toBe("Models");
  expect(field.getAttribute("aria-activedescendant")).toBe(
    document.querySelector('[data-highlighted="true"]')!.id,
  );
  await key("ArrowDown");
  await key("Enter");
  expect(pick).toHaveBeenCalledWith("last");
});
it("opens the highlighted branch from the search field with ArrowRight at the end of the text", async () => {
  await renderMenu({ search: { value: "", onChange: vi.fn(), label: "Filter" } });
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Filter"]')!;
  await act(async () => field.focus());
  await key("ArrowDown");
  await key("ArrowRight");
  expect(document.querySelector('[role="menu"][aria-label="Models"]')).not.toBeNull();
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  expect(focused()).toBe("Fast");
  await key("ArrowLeft");
  expect(document.activeElement).toBe(field);
});
it("leaves typing inside content items alone and reports nothing for its keys", async () => {
  const { pick } = await renderMenu({
    items: [
      { kind: "content", id: "name", node: createElement("input", { "aria-label": "Name" }) },
      { kind: "item", id: "pin", label: "Pin" },
    ],
  });
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  await act(async () => field.focus());
  const event = new KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true });
  await act(async () => field.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  await key("ArrowDown");
  expect(focused()).toBe("Pin");
  expect(pick).not.toHaveBeenCalled();
});
