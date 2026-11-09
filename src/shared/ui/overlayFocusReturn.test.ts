// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Popover } from "./Popover";

let container: HTMLDivElement;
let root: Root;

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
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const press = async (target: Element, key: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
};

type Props = {
  /** The row picked in the menu removes the trigger together with the menu. */
  removeTrigger?: boolean;
};

function MenuToDialog({ removeTrigger = false }: Props) {
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [gone, setGone] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return createElement(
    "section",
    { id: "scope" },
    createElement("button", { id: "before" }, "Before"),
    gone
      ? null
      : createElement(
          "button",
          {
            id: "trigger",
            onClick: (event: { currentTarget: HTMLElement }) => {
              setAnchor(event.currentTarget);
              setMenu(true);
            },
          },
          "Trigger",
        ),
    menu
      ? createElement(
          Popover,
          { anchor, role: "menu", tabIndex: -1, onDismiss: () => setMenu(false) },
          createElement(
            "button",
            {
              id: "item",
              role: "menuitem",
              onClick: () => {
                setMenu(false);
                if (removeTrigger) setGone(true);
                else setDialog(true);
              },
            },
            "Item",
          ),
        )
      : null,
    dialog
      ? createElement(
          Modal,
          { title: "Dialog", onClose: () => setDialog(false) },
          createElement("p", null, "Body"),
        )
      : null,
  );
}

async function openMenu() {
  const trigger = document.getElementById("trigger")!;
  trigger.focus();
  await act(async () => trigger.click());
  document.getElementById("item")!.focus();
  expect(document.activeElement?.id).toBe("item");
}

it("returns to the original trigger after a menu item opens a dialog that later closes", async () => {
  await act(async () => root.render(createElement(MenuToDialog)));
  await openMenu();
  await act(async () => document.getElementById("item")!.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await press(document.activeElement!, "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // The menu row the dialog was opened from is gone; the menu's own opener is the target.
  expect(document.activeElement?.id).toBe("trigger");
});

it("moves to a control in the same container when the opener is removed with the menu", async () => {
  await act(async () => root.render(createElement(MenuToDialog, { removeTrigger: true })));
  await openMenu();
  await act(async () => document.getElementById("item")!.click());
  await act(async () => {
    await Promise.resolve();
  });
  expect(document.getElementById("trigger")).toBeNull();
  expect(document.activeElement?.id).toBe("before");
});

it("returns a nested popover to the parent row, not to the underlying dialog", async () => {
  function Nested() {
    const [sub, setSub] = useState(false);
    const [host, setHost] = useState<HTMLElement | null>(null);
    return createElement(
      Modal,
      { title: "Dialog", onClose: vi.fn() },
      createElement("button", { id: "row", ref: setHost, onClick: () => setSub(true) }, "Row"),
      sub
        ? createElement(
            Popover,
            { anchor: host, role: "menu", tabIndex: -1, onDismiss: () => setSub(false) },
            createElement("button", { id: "child" }, "Child"),
          )
        : null,
    );
  }
  await act(async () => root.render(createElement(Nested)));
  const row = document.getElementById("row")!;
  row.focus();
  await act(async () => row.click());
  document.getElementById("child")!.focus();
  await press(document.activeElement!, "Escape");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(row);
});

it("never blurs a field the user already moved to (no forced IME commit)", async () => {
  const trigger = document.createElement("button");
  const field = document.createElement("input");
  const blur = vi.fn();
  field.addEventListener("blur", blur);
  document.body.append(trigger, field);
  trigger.focus();
  await act(async () =>
    root.render(createElement(Popover, { anchor: trigger, onDismiss: vi.fn() }, "Content")),
  );
  field.focus();
  await act(async () => root.render(null));
  expect(blur).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field);
});

it("restores focus without scrolling", async () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  await act(async () => root.render(createElement(MenuToDialog)));
  await openMenu();
  focus.mockClear();
  await press(document.activeElement!, "Escape");
  expect(document.activeElement?.id).toBe("trigger");
  expect(focus).toHaveBeenCalled();
  for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
});
