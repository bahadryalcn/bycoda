// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

it("keeps point/anchor context actions, disabled gate and submenu keyboard ownership through the shared adapter", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div"),
    anchor = document.createElement("button");
  document.body.append(anchor, host);
  const root = createRoot(host),
    pick = vi.fn(),
    close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ContextMenu, {
          anchor,
          ariaLabel: "File commands",
          onPick: pick,
          onClose: close,
          items: [
            { kind: "item", id: "disabled", label: "Disabled", disabled: true },
            {
              kind: "item",
              id: "group",
              label: "More",
              submenu: [{ kind: "item", id: "inspect", label: "Inspect" }],
            },
          ],
        }),
      ),
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="File commands"]')!;
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(pick).not.toHaveBeenCalled();
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    const more = document.querySelector<HTMLButtonElement>('button[data-menu-index="1"]')!;
    expect(more.getAttribute("data-button-selected")).toBe("true");
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(pick).toHaveBeenCalledExactlyOnceWith("inspect");
    const submenu = document.querySelector<HTMLElement>('[role="menu"][aria-label="More"]')!;
    await act(async () =>
      submenu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(menu);
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    await act(async () =>
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(ContextMenu, {
          x: 40,
          y: 60,
          ariaLabel: "Point commands",
          onPick: pick,
          onClose: close,
          items: [{ kind: "item", id: "open", label: "Open" }],
        }),
      ),
    );
    expect(document.querySelector('[role="menu"][aria-label="Point commands"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  }
});

it("searches a long submenu while preserving text editing, keyboard picks and Escape recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pick = vi.fn();
  const close = vi.fn();
  const key = async (target: HTMLElement, value: string) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  };
  const type = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () =>
      root.render(
        createElement(ContextMenu, {
          x: 40,
          y: 60,
          ariaLabel: "Session commands",
          onPick: pick,
          onClose: close,
          items: [
            {
              kind: "item",
              id: "add",
              label: "Add to",
              submenuSearch: { placeholder: "Search folders", emptyLabel: "No folders found" },
              submenu: Array.from({ length: 50 }, (_, index) => ({
                kind: "item" as const,
                id: `folder-${index}`,
                label: `Project group ${index}`,
                checked: index === 49,
              })),
            },
          ],
        }),
      ),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Session commands"]',
    )!;
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    await key(menu, "ArrowRight");
    const submenu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Add to"]')!;
    const input = submenu.querySelector<HTMLInputElement>('input[aria-label="Search folders"]')!;
    expect(submenu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(50);
    expect(document.activeElement).toBe(input);

    for (const value of [" ", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect((await key(input, value)).defaultPrevented).toBe(false);
      expect(submenu.isConnected).toBe(true);
    }
    await type(input, "project group 49");
    const result = submenu.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
    expect(submenu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(1);
    expect(result.textContent).toBe("Project group 49");
    expect(result.getAttribute("aria-checked")).toBe("true");
    await key(input, "ArrowDown");
    await key(input, "Enter");
    expect(pick).toHaveBeenCalledExactlyOnceWith("folder-49");

    await type(input, "unknown folder");
    expect(submenu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(0);
    expect(submenu.querySelector('[role="status"]')?.textContent).toBe("No folders found");
    await key(input, "ArrowDown");
    await key(input, "Enter");
    expect(pick).toHaveBeenCalledTimes(1);
    await key(input, "Escape");
    expect(submenu.isConnected).toBe(false);
    expect(document.activeElement).toBe(menu);
    expect(close).not.toHaveBeenCalled();
    await key(menu, "ArrowRight");
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Search folders"]')?.value,
    ).toBe("");
    expect(document.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(50);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
