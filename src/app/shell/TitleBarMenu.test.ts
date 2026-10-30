// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

function tab(id: string, sessionCount = 1): Tab {
  return {
    id,
    project: "project",
    title: id,
    more: [],
    sessionCount,
    harnesses: [],
    busyHarnesses: [],
    files: sessionCount ? [] : ["file.ts"],
  };
}

function openMenu(tabId: string): HTMLElement {
  act(() => {
    container
      .querySelector(`[data-title-tab-id="${tabId}"] button`)!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

function menuItem(menu: HTMLElement, label: string): HTMLButtonElement {
  const item = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.startsWith(label),
  );
  expect(item).toBeDefined();
  return item!;
}

function pick(menu: HTMLElement, label: string) {
  act(() => menuItem(menu, label).click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("title tab context menu", () => {
  it("keeps a preview session by menu, double click or keyboard without pinning history", () => {
    const onKeepSession = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [{ ...tab("preview"), previewSessionId: "session-one" }],
          activeId: "preview",
          cwd: "/project",
          onKeepSession,
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-title-tab-id="preview"] button',
    )!;
    expect(button.querySelector(".italic")).not.toBeNull();
    pick(openMenu("preview"), "Keep open");
    act(() => button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onKeepSession).toHaveBeenCalledTimes(3);
    expect(onKeepSession).toHaveBeenLastCalledWith("session-one");
  });

  it("returns only the chosen detached tab to the main window", () => {
    const onReturnTabToMain = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active"), tab("other")],
          activeId: "active",
          cwd: "/project",
          detached: true,
          onReturnTabToMain,
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );
    pick(openMenu("other"), "Return to main window");
    expect(onReturnTabToMain).toHaveBeenCalledExactlyOnceWith("other");
  });

  it("offers restore in the layout menu while a pane fills the workspace", () => {
    const onToggleMaximize = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active")],
          activeId: "active",
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
          layout: {
            current: null,
            canArrange: true,
            onArrange: vi.fn(),
            onSplit: vi.fn(),
            maximized: true,
            onToggleMaximize,
          },
        }),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("[data-layout-control] button")!.click());
    pick(document.querySelector<HTMLElement>('[role="menu"]')!, "Restore panel layout");
    expect(onToggleMaximize).toHaveBeenCalledOnce();
  });
  it("archives and deletes the right-clicked conversation tab", () => {
    const onArchiveTab = vi.fn();
    const onDeleteTab = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active"), tab("other", 2)],
          activeId: "active",
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onArchiveTab,
          onDeleteTab,
          onReorder: vi.fn(),
        }),
      ),
    );

    const archiveMenu = openMenu("other");
    expect(menuItem(archiveMenu, "Archive").textContent).toContain(
      "All 2 conversations in this tab",
    );
    expect(menuItem(archiveMenu, "Archive").textContent).not.toContain("Permanently");
    pick(archiveMenu, "Archive");
    expect(onArchiveTab).toHaveBeenCalledExactlyOnceWith("other");
    expect(onDeleteTab).not.toHaveBeenCalled();

    const deleteMenu = openMenu("other");
    expect(menuItem(deleteMenu, "Delete").textContent).toContain(
      "Permanently delete all 2 conversations in this tab",
    );
    pick(deleteMenu, "Delete");
    expect(onDeleteTab).toHaveBeenCalledExactlyOnceWith("other");
  });

  it("keeps archive and delete off file-only tabs", () => {
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("conversation"), tab("file", 0)],
          activeId: "conversation",
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onArchiveTab: vi.fn(),
          onDeleteTab: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );

    const labels = Array.from(
      openMenu("file").querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      (item) => item.textContent,
    );
    expect(labels).not.toContain("Archive");
    expect(labels).not.toContain("Delete");
    expect(labels.some((label) => label?.startsWith("Close Tab"))).toBe(true);
  });

  describe("moving a tab without dragging", () => {
    function renderThree(onReorder = vi.fn()) {
      act(() =>
        root.render(
          createElement(TitleBar, {
            tabs: [tab("a"), tab("b"), tab("c")],
            activeId: "a",
            cwd: "/project",
            onToggleSidebar: vi.fn(),
            onNew: vi.fn(),
            onSelect: vi.fn(),
            onClose: vi.fn(),
            onCloseMany: vi.fn(),
            onReorder,
          }),
        ),
      );
      return onReorder;
    }

    it("offers Move Left / Move Right, disabled at the ends of the strip", () => {
      const onReorder = renderThree();
      const first = openMenu("a");
      expect(menuItem(first, "Move Left").disabled).toBe(true);
      expect(menuItem(first, "Move Right").disabled).toBe(false);
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      const last = openMenu("c");
      expect(menuItem(last, "Move Left").disabled).toBe(false);
      expect(menuItem(last, "Move Right").disabled).toBe(true);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("moves the tab and announces it from the menu", () => {
      const onReorder = renderThree();
      pick(openMenu("b"), "Move Right");
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(["a", "c", "b"], "b");
      expect(document.querySelector("[data-drag-announcer]")?.textContent).toContain("b");
      expect(document.querySelector("[data-drag-announcer]")?.textContent).toContain("3 of 3");
      pick(openMenu("b"), "Move Left");
      expect(onReorder).toHaveBeenLastCalledWith(["b", "a", "c"], "b");
    });

    it("moves the focused tab with Alt+Arrow and leaves plain arrows alone", () => {
      const onReorder = renderThree();
      const button = container.querySelector<HTMLButtonElement>('[data-title-tab-id="b"] button')!;
      act(() =>
        button.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
        ),
      );
      expect(onReorder).not.toHaveBeenCalled();
      const alt = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => button.dispatchEvent(alt));
      expect(alt.defaultPrevented).toBe(true);
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(["b", "a", "c"], "b");
    });

    it("keeps the first tab in place at the edge and says so", () => {
      const onReorder = renderThree();
      const button = container.querySelector<HTMLButtonElement>('[data-title-tab-id="a"] button')!;
      act(() =>
        button.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowLeft",
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onReorder).not.toHaveBeenCalled();
      expect(document.querySelector("[data-drag-announcer]")?.textContent).toContain(
        "stays at position 1 of 3",
      );
    });
  });
});
