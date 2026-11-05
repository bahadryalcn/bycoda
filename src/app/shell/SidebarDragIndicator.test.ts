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

describe("session drag preview and gap", () => {
  function card(id: string) {
    return container.querySelector<HTMLElement>(`[data-session-card="${id}"]`)!;
  }
  const item = (id: string) => card(id).closest("li")!;
  function pointer(target: EventTarget, type: string, x: number, y: number) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, {
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
    });
    act(() => {
      target.dispatchEvent(event);
    });
  }
  // The list is measured from layout, which happy-dom does not have: give the scroller and the
  // dragged and target cards boxes (target card at y 100-140, dragged card 44px tall).
  function startDrag(overId: string) {
    const source = card("one");
    const over = card(overId);
    Object.assign(source, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    vi.spyOn(source, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 44));
    vi.spyOn(source.closest("li")!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 44),
    );
    vi.spyOn(over, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 40));
    vi.spyOn(
      container.querySelector<HTMLElement>(".sidebar-session-scroll")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 0, 300, 600));
    pointer(source, "pointerdown", 20, 10);
    pointer(window, "pointermove", 20, 120);
    return over;
  }

  it("lifts a copy of the card, opens a gap instead of a line or badge, and clears on Escape", async () => {
    await render();
    startDrag("two");
    expect(document.querySelectorAll(".pointer-drag-preview")).toHaveLength(1);
    expect(document.querySelector(".pointer-drag-preview [data-session-card]")).toBeNull();
    expect(document.querySelector(".pointer-drop-hint")).toBeNull();
    // Upper quarter of the target card: the gap opens above it and nothing is drawn on the card.
    pointer(window, "pointermove", 20, 104);
    expect(item("two").style.getPropertyValue("margin-block-start")).toBe("44px");
    expect(item("one").style.getPropertyValue("height")).toBe("0px");
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drag-preview-label")).toBeNull();
    // Lower quarter: the gap moves below it.
    pointer(window, "pointermove", 20, 136);
    expect(item("two").style.getPropertyValue("margin-block-start")).toBe("0px");
    expect(item("two").style.getPropertyValue("margin-block-end")).toBe("44px");
    // Over its own slot nothing opens.
    pointer(window, "pointermove", 20, 20);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector(".pointer-drag-preview")).toBeNull();
    expect(item("one").getAttribute("style") ?? "").not.toContain("height");
    expect(item("two").getAttribute("style") ?? "").not.toContain("margin");
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
  });

  it("contains the preview at list edges, follows resize, and clears an invalid target", async () => {
    await render();
    startDrag("two");
    const scroller = container.querySelector<HTMLElement>(".sidebar-session-scroll")!;
    const rect = vi.mocked(scroller.getBoundingClientRect);
    rect.mockReturnValue(new DOMRect(10, 20, 120, 100));
    pointer(window, "pointermove", 125, 119);
    const preview = document.querySelector<HTMLElement>("[data-drag-preview]")!;
    expect(preview.style.width).toBe("120px");
    expect(preview.style.transform).toBe("translate3d(10px, 76px, 0)");
    pointer(window, "pointermove", 1, 10);
    expect(preview.style.transform).toBe("translate3d(10px, 20px, 0)");
    expect(Number.parseFloat(item("two").style.getPropertyValue("margin-block-start")) || 0).toBe(
      0,
    );
    pointer(window, "pointerup", 1, 10);
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("closes the gap and frames the card as a group target after the dwell, saying it on the copy", async () => {
    vi.useFakeTimers();
    await render();
    const over = startDrag("two");
    // Just above the middle of the card: still a gap, now counting down to grouping.
    pointer(window, "pointermove", 20, 119);
    expect(item("two").style.getPropertyValue("margin-block-start")).toBe("44px");
    expect(document.querySelector('[data-session-dwell="waiting"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(over.getAttribute("data-drop-indicator")).toBe("group");
    expect(item("two").style.getPropertyValue("margin-block-start")).toBe("0px");
    expect(document.querySelector('[data-session-dwell="ready"]')).not.toBeNull();
    expect(document.querySelector(".pointer-drag-preview-label")?.textContent).toBe(
      "Release to group",
    );
    expect(container.textContent).not.toContain("Release to group");
    act(() => window.dispatchEvent(new Event("pointercancel")));
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
    expect(document.querySelector(".pointer-drag-preview")).toBeNull();
  });

  it("removes the copy and the gap when the session list unmounts mid-drag", async () => {
    await render();
    startDrag("two");
    pointer(window, "pointermove", 20, 104);
    expect(document.querySelector(".pointer-drag-preview")).not.toBeNull();
    act(() => root.unmount());
    expect(document.querySelector(".pointer-drag-preview")).toBeNull();
    expect(document.querySelector("[data-drop-indicator]")).toBeNull();
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
