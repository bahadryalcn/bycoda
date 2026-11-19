// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuBar } from "./MenuBar";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

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

function keyOn(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function menuButton(menu: ParentNode, label: string): HTMLButtonElement {
  const item = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.startsWith(label),
  );
  expect(item).toBeDefined();
  return item!;
}

// Regression for #905: the idle count is a lazy reader. Rendering the menu bar or the tab strip
// must not scan sessions; only an open menu asks, and then it reflects the latest count.
describe("idle tab count is read only by open menus", () => {
  it("does not count while the application menu bar renders", () => {
    const countIdleTabs = vi.fn(() => 2);
    act(() =>
      root.render(
        createElement(MenuBar, {
          onNew: vi.fn(),
          onToggleSidebar: vi.fn(),
          onToggleSessionSidebar: vi.fn(),
          onCloseIdleTabs: vi.fn(),
          countIdleTabs,
        }),
      ),
    );
    expect(countIdleTabs).not.toHaveBeenCalled();
  });

  it("counts when the File menu opens and keeps its disabled state fresh", () => {
    const countIdleTabs = vi.fn(() => 0);
    act(() =>
      root.render(
        createElement(MenuBar, {
          onNew: vi.fn(),
          onToggleSidebar: vi.fn(),
          onToggleSessionSidebar: vi.fn(),
          onCloseIdleTabs: vi.fn(),
          countIdleTabs,
        }),
      ),
    );
    // The bar stays hidden until an Alt tap reveals it and focuses the first menu.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
    });
    expect(countIdleTabs).not.toHaveBeenCalled();
    const fileButton = container.querySelector<HTMLElement>('[data-menubar-key="file"]')!;
    keyOn(fileButton, "ArrowDown");

    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(countIdleTabs).toHaveBeenCalled();
    expect(menuButton(menu, "Close Idle Tabs").disabled).toBe(true);

    countIdleTabs.mockReturnValue(3);
    keyOn(menu, "ArrowDown");
    expect(menuButton(document.querySelector('[role="menu"]')!, "Close Idle Tabs").disabled).toBe(
      false,
    );
  });
});

function tab(id: string): Tab {
  return {
    id,
    project: "project",
    title: id,
    more: [],
    sessionCount: 1,
    harnesses: [],
    busyHarnesses: [],
    files: [],
  };
}

describe("idle tab count in the title tab context menu", () => {
  it("does not count while the title bar renders and counts only when the tab menu opens", () => {
    const countIdleTabs = vi.fn(() => 0);
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("a"), tab("b")],
          activeId: "a",
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onCloseIdleTabs: vi.fn(),
          onReorder: vi.fn(),
          countIdleTabs,
        }),
      ),
    );
    expect(countIdleTabs).not.toHaveBeenCalled();

    act(() => {
      container
        .querySelector(`[data-title-tab-id="a"] button`)!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(countIdleTabs).toHaveBeenCalled();
    expect(menuButton(menu, "Close Idle Tabs").disabled).toBe(true);

    countIdleTabs.mockReturnValue(1);
    keyOn(menu, "ArrowDown");
    expect(menuButton(document.querySelector('[role="menu"]')!, "Close Idle Tabs").disabled).toBe(
      false,
    );
  });
});
