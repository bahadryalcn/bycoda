// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExpandingButtonGroup } from "./ExpandingButtonGroup";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
  vi.unstubAllGlobals();
});
const icon = createElement("svg");
const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;

async function moveTo(id: string, x = 40) {
  const target = button(id);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ left: 0, right: 200 } as DOMRect);
  document.elementFromPoint = vi.fn(() => target);
  await act(async () => {
    const event = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: 12 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    target.dispatchEvent(event);
  });
}

async function renderHoverActions() {
  vi.useFakeTimers();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Actions",
        items: ["copy", "chat", "link"].map((id) => ({ id, label: id, icon })),
      }),
    ),
  );
}

it("can rest as icons while preserving hover, keyboard and click access", async () => {
  vi.useFakeTimers();
  const open = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Notes",
        defaultExpanded: null,
        items: [
          { id: "notes", label: "Notes", ariaLabel: "Open notes panel", icon, onSelect: open },
        ],
      }),
    ),
  );
  expect(button("notes").dataset.expanded).toBeUndefined();
  expect(button("notes").tabIndex).toBe(0);
  expect(button("notes").getAttribute("aria-label")).toBe("Open notes panel");
  await moveTo("notes");
  await act(async () => vi.advanceTimersByTime(250));
  expect(button("notes").dataset.expanded).toBeDefined();
  await act(async () => button("notes").click());
  expect(open).toHaveBeenCalledOnce();
});

it("ignores passing hover, waits for aim, and tolerates a brief pointer exit", async () => {
  await renderHoverActions();
  await moveTo("chat");
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("copy").dataset.expanded).toBeDefined();
  await moveTo("link", 50);
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("copy").dataset.expanded).toBeDefined();
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("link").dataset.expanded).toBeDefined();
  await act(async () => {
    const event = new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    button("link").dispatchEvent(event);
  });
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("link").dataset.expanded).toBeDefined();
  await moveTo("link", 60);
  await act(async () => vi.advanceTimersByTime(400));
  expect(button("link").dataset.expanded).toBeDefined();
});

it("does not expand a target that moved away or override keyboard focus with pending hover", async () => {
  await renderHoverActions();
  await moveTo("chat");
  document.elementFromPoint = vi.fn(() => button("copy"));
  await act(async () => vi.advanceTimersByTime(250));
  expect(button("copy").dataset.expanded).toBeDefined();
  await moveTo("chat", 50);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  await act(async () => button("link").focus());
  await act(async () => vi.advanceTimersByTime(250));
  expect(button("link").dataset.expanded).toBeDefined();
});
it("keeps the current destination while another label expands and supports context menus", async () => {
  const openMenu = vi.fn();
  const openInbox = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Workspace tools",
        defaultExpanded: "notes",
        items: [
          {
            id: "inbox",
            label: "Inbox",
            ariaLabel: "Inbox, new items",
            icon,
            active: false,
            onSelect: openInbox,
            onOpenContextMenu: openMenu,
          },
          { id: "notes", label: "Notes", icon, active: true },
        ],
      }),
    ),
  );
  await act(async () => button("inbox").focus());
  expect(button("notes").getAttribute("aria-current")).toBe("page");
  expect(button("inbox").hasAttribute("aria-current")).toBe(false);
  expect(button("inbox").getAttribute("aria-label")).toBe("Inbox, new items");
  await act(async () => {
    button("inbox").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }),
    );
    button("inbox").dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F10", shiftKey: true }),
    );
  });
  expect(openMenu).toHaveBeenNthCalledWith(1, 12, 24);
  expect(openMenu).toHaveBeenCalledTimes(2);
  expect(openInbox).not.toHaveBeenCalled();
});
async function tap(id: string) {
  await act(async () => {
    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    button(id).dispatchEvent(event);
    button(id).click();
  });
}

it("awaits real success, blocks duplicate and concurrent activation, and clears confirmation on time", async () => {
  vi.useFakeTimers();
  let resolve!: (result: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  const copy = vi.fn(() => pending);
  const link = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Note actions",
        confirmDuration: 100,
        items: [
          { id: "copy", label: "Copy", doneLabel: "Copied", icon, onSelect: copy },
          { id: "link", label: "Link", icon, onSelect: link },
        ],
      }),
    ),
  );
  await act(async () => {
    button("copy").click();
    button("copy").click();
    button("link").click();
  });
  expect(copy).toHaveBeenCalledOnce();
  expect(link).not.toHaveBeenCalled();
  expect(button("copy").getAttribute("aria-busy")).toBe("true");
  expect(button("copy").dataset.state).toBe("idle");
  await act(async () => resolve(true));
  expect(button("copy").dataset.state).toBe("done");
  await act(async () => vi.advanceTimersByTime(100));
  expect(button("copy").dataset.state).toBe("idle");
});

it.each(["false", "rejection"])(
  "does not fabricate success after %s and allows retry",
  async (failure) => {
    const select = vi.fn(async () => {
      if (failure === "rejection") throw new Error("offline");
      return false;
    });
    await act(async () =>
      root.render(
        createElement(ExpandingButtonGroup, {
          label: "Actions",
          items: [{ id: "copy", label: "Copy", doneLabel: "Copied", icon, onSelect: select }],
        }),
      ),
    );
    await act(async () => button("copy").click());
    expect(button("copy").dataset.state).toBe("idle");
    expect(button("copy").getAttribute("aria-busy")).toBeNull();
    await act(async () => button("copy").click());
    expect(select).toHaveBeenCalledTimes(2);
  },
);

it("reveals a collapsed command on first touch and exposes disabled commands through keyboard navigation", async () => {
  const select = vi.fn();
  const disabled = vi.fn();
  await act(async () =>
    root.render(
      createElement(ExpandingButtonGroup, {
        label: "Actions",
        items: [
          { id: "copy", label: "Copy", icon },
          { id: "chat", label: "Add to chat", icon, onSelect: select },
          { id: "disabled", label: "Unavailable", icon, disabled: true, onSelect: disabled },
        ],
      }),
    ),
  );
  await tap("chat");
  expect(button("chat").dataset.expanded).toBeDefined();
  expect(select).not.toHaveBeenCalled();
  await tap("chat");
  expect(select).toHaveBeenCalledOnce();
  await act(async () => {
    button("chat").focus();
    button("chat").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(button("disabled"));
  await act(async () => button("disabled").click());
  expect(disabled).not.toHaveBeenCalled();
});
