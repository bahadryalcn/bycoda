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

it("announces mutually exclusive choices as radios without changing the callback owner", async () => {
  const pick = vi.fn();
  await act(async () => root.render(createElement(DropdownMenu, {
    anchor, label: "Merge method", onPick: pick, onClose: vi.fn(),
    items: [
      { kind: "item", id: "merge", label: "Merge", checked: true, selectionRole: "radio" },
      { kind: "item", id: "squash", label: "Squash", checked: false, selectionRole: "radio" },
    ],
  })));
  const radios = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
  expect(radios).toHaveLength(2);
  expect(radios[0].getAttribute("aria-checked")).toBe("true");
  expect(radios[1].getAttribute("aria-checked")).toBe("false");
  await act(async () => radios[1].click());
  expect(pick).toHaveBeenCalledExactlyOnceWith("squash");
});
