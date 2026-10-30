// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionTitle } from "../../features/sessions/model/session";
import { Sidebar } from "./Sidebar";

vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
  useProjectsDiffStats: vi.fn(() => []),
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: undefined, refresh: async () => false }),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));
vi.mock("../../platform/tauri/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

const CWD = "/workspace/project";

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

function session(id: string) {
  return {
    id,
    cwd: CWD,
    harness: "codex" as const,
    model: "",
    runtimeMode: "supervised" as const,
    title: formatSessionTitle("codex", `Conversation ${id}`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const render = () => act(async () => root.render(createElement(Sidebar, props)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  props = {
    cwd: CWD,
    open: true,
    sessions: [session("one"), session("two"), session("three")],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "one",
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => window.dispatchEvent(new Event("blur")));
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tabLabels = () =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) =>
    tab.getAttribute("aria-label"),
  );

function key(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("sidebar view tabs without dragging", () => {
  it("moves a tab with Alt+Arrow and announces the new place", async () => {
    await render();
    const [first] = tabLabels();
    expect(first).toMatch(/^Sessions/);
    const button = container.querySelector<HTMLElement>('[role="tab"]')!;
    const plain = key(button, { key: "ArrowRight" });
    expect(plain.defaultPrevented).toBe(false);
    expect(tabLabels()[0]).toBe(first);
    const moved = key(button, { key: "ArrowRight", altKey: true });
    expect(moved.defaultPrevented).toBe(true);
    expect(tabLabels()[1]).toBe(first);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Moved Sessions to position 2 of 3",
    );
  });

  it("offers Move Left / Move Right in the tab menu, disabled at the ends", async () => {
    await render();
    const openMenu = (index: number) => {
      act(() => {
        container
          .querySelectorAll('[role="tab"]')
          [index].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      return document.querySelector<HTMLElement>('[role="menu"]')!;
    };
    const item = (menu: HTMLElement, label: string) =>
      [...menu.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === label,
      )!;
    const firstMenu = openMenu(0);
    expect(item(firstMenu, "Move Left").disabled).toBe(true);
    expect(item(firstMenu, "Move Right").disabled).toBe(false);
    const original = tabLabels();
    act(() => item(firstMenu, "Move Right").click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(tabLabels()).toEqual([original[1], original[0], original[2]]);
    const lastMenu = openMenu(2);
    expect(item(lastMenu, "Move Left").disabled).toBe(false);
    expect(item(lastMenu, "Move Right").disabled).toBe(true);
  });
});

describe("session drag drop indicator", () => {
  function card(id: string) {
    return container.querySelector<HTMLElement>(`[data-session-card="${id}"]`)!;
  }
  function pointer(target: EventTarget, type: string, x: number, y: number) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y, screenX: x, screenY: y });
    act(() => {
      target.dispatchEvent(event);
    });
  }
  function startDrag(overId: string) {
    const source = card("one");
    const over = card(overId);
    Object.assign(source, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    vi.spyOn(over, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 40));
    vi.spyOn(document, "elementFromPoint").mockReturnValue(over);
    pointer(source, "pointerdown", 20, 10);
    pointer(window, "pointermove", 20, 120);
    return over;
  }

  it("marks the card edge it would land on, names the dragged session once, and clears on Escape", async () => {
    await render();
    // Upper quarter of the target card: an insertion line before it.
    const over = startDrag("two");
    pointer(window, "pointermove", 20, 104);
    expect(over.getAttribute("data-drop-indicator")).toBe("before");
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
    const badge = document.querySelector(".pointer-drop-hint");
    expect(badge?.querySelector(".pointer-drop-hint-subject")?.textContent).toBe(
      "Conversation one",
    );
    pointer(window, "pointermove", 20, 136);
    expect(over.getAttribute("data-drop-indicator")).toBe("after");
    // Nothing is drawn on the row itself besides the shared mark.
    expect(over.querySelector("[data-session-drop-line]")).toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
  });

  it("frames the card as a group target after the dwell and says it once, in the badge", async () => {
    vi.useFakeTimers();
    await render();
    const over = startDrag("two");
    // Just above the middle of the card: still a line, now counting down to grouping.
    pointer(window, "pointermove", 20, 119);
    expect(over.getAttribute("data-drop-indicator")).toBe("before");
    expect(document.querySelector('[data-session-dwell="waiting"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(over.getAttribute("data-drop-indicator")).toBe("group");
    expect(document.querySelector('[data-session-dwell="ready"]')).not.toBeNull();
    const text = document.querySelector(".pointer-drop-hint")?.textContent ?? "";
    expect(text.match(/Release to group/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("Release to group");
    pointer(window, "pointercancel", 20, 120);
    act(() => window.dispatchEvent(new Event("pointercancel")));
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
  });

  it("clears the mark when the session list unmounts mid-drag", async () => {
    await render();
    startDrag("two");
    pointer(window, "pointermove", 20, 104);
    expect(document.querySelector("[data-drop-indicator]")).not.toBeNull();
    act(() => root.unmount());
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
    root = createRoot(container);
  });
});

describe("session folder drag indicator", () => {
  const folderRow = (id: string) =>
    container.querySelector<HTMLElement>(`[data-session-folder="${id}"] [data-folder-row]`)!;
  const folder = (id: string) =>
    container.querySelector<HTMLElement>(`[data-session-folder="${id}"]`)!;
  async function renderWithFolders() {
    localStorage.setItem(
      "bycoda.sessionFolders",
      JSON.stringify({
        [CWD]: [
          { id: "work", name: "Work", sessionIds: ["one"], collapsed: false },
          { id: "later", name: "Later", sessionIds: ["two"], collapsed: false },
        ],
      }),
    );
    await render();
  }
  function emit(target: EventTarget, type: string, y: number) {
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 2, clientX: 40, clientY: y }),
      );
    });
  }
  function dragFolder(id: string, over: Element, y: number) {
    const handle = folderRow(id);
    Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    vi.spyOn(over, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 40));
    vi.spyOn(document, "elementFromPoint").mockReturnValue(over);
    emit(handle, "pointerdown", 300);
    emit(window, "pointermove", y);
    return handle;
  }

  it("draws the landing mark through the shared indicator, names the folder once, and clears on Escape", async () => {
    await renderWithFolders();
    const over = folderRow("work");
    dragFolder("later", over, 120);
    expect(over.getAttribute("data-drop-indicator")).toBe("inside");
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
    expect(document.querySelectorAll(".pointer-drop-hint")).toHaveLength(1);
    const badge = document.querySelector(".pointer-drop-hint");
    expect(badge?.querySelector(".pointer-drop-hint-subject")?.textContent).toBe("Later");
    expect(badge?.textContent).toBe("LaterRelease to add to the folder");
    expect(document.querySelector("[data-folder-drop]")).toBeNull();
    // The top edge of a folder header places the dragged folder before it, as a line on the folder.
    emit(window, "pointermove", 102);
    expect(folder("work").getAttribute("data-drop-indicator")).toBe("before");
    expect(over.getAttribute("data-drop-indicator")).toBeNull();
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
    expect(document.querySelector("[data-folder-dragging]")).toBeNull();
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
  });

  it("marks a folder it cannot move into itself as blocked", async () => {
    await renderWithFolders();
    const over = folderRow("work");
    dragFolder("work", over, 120);
    expect(over.getAttribute("data-drop-indicator")).toBe("blocked");
    expect(document.querySelector(".pointer-drop-hint")?.textContent).toBe("WorkCannot drop here");
    act(() => window.dispatchEvent(new Event("blur")));
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
  });

  it("clears the folder mark when the sidebar unmounts mid-drag", async () => {
    await renderWithFolders();
    dragFolder("later", folderRow("work"), 120);
    expect(document.querySelector("[data-drop-indicator]")).not.toBeNull();
    act(() => root.unmount());
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
    root = createRoot(container);
  });

  it("keeps a folder in rename mode a drop target with the same row marker", async () => {
    await renderWithFolders();
    act(() => {
      folderRow("work").dispatchEvent(
        new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }),
      );
    });
    const renaming = folderRow("work");
    expect(renaming.querySelector("input")).not.toBeNull();
    dragFolder("later", renaming, 120);
    expect(renaming.getAttribute("data-drop-indicator")).toBe("inside");
  });
});
