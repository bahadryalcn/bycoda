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
