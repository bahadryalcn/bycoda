// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurfaceTabs } from "./SurfaceTabs";
import { TitleBar, type Tab } from "../../../app/shell/TitleBar";

vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

function mockLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
}

function workspaceTab(id: string): Tab {
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

function flushPaint() {
  act(() => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  localStorage.setItem("bycoda.tabAnimationsEnabled", "1");
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--motion-tab-close-duration", "180ms");
  document.documentElement.style.setProperty("--motion-ease-out", "cubic-bezier(0.22, 1, 0.36, 1)");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 140, 32),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("style");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function closeTab(kind: "workspace" | "file", id: string, ids: string[], pointer = false) {
  function Tabs() {
    const [current, setCurrent] = useState(ids);
    const close = (tabId: string) =>
      setCurrent((entries) => entries.filter((entry) => entry !== tabId));
    return kind === "workspace"
      ? createElement(TitleBar, {
          tabs: current.map(workspaceTab),
          activeId: current.includes("first") ? "first" : current[0],
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: close,
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        })
      : createElement(SurfaceTabs, {
          files: current.map((tabId) => ({
            id: tabId,
            path: tabId,
            cwd: "/project",
          })),
          activeFileId: current.includes("first") ? "first" : current[0],
          dirtyFileIds: new Set<string>(),
          fileErrorCounts: new Map<string, number>(),
          onSelectFile: vi.fn(),
          onCloseFile: close,
          onCloseOtherFiles: vi.fn(),
          onReorder: vi.fn(),
        });
  }

  act(() => root.render(createElement(Tabs)));
  const closeButton = container.querySelector(`[aria-label="Close ${id}"]`)!;
  act(() => {
    if (pointer) {
      closeButton.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    }
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe.each(["workspace", "file"] as const)("%s tab close motion", (kind) => {
  it("collapses the closed tab's width before removing it", () => {
    closeTab(kind, "second", ["first", "second", "third"]);
    const ghost = container.querySelector<HTMLElement>("[data-closing-tab]");
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost!.style.getPropertyValue("--tab-slot-width")).toBe("140px");
    expect(ghost!.hasAttribute("data-collapsed")).toBe(false);
    expect(container.querySelector('[aria-label="Close first"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Close third"]')).not.toBeNull();

    flushPaint();
    expect(ghost!.hasAttribute("data-collapsed")).toBe(true);

    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector("[data-closing-tab]")).toBeNull();
    expect(
      Array.from(container.querySelectorAll('button[aria-label^="Close "]'), (button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Close first", "Close third"]);
  });

  it("collapses the last tab in place", () => {
    closeTab(kind, "third", ["first", "second", "third"]);
    const ghost = container.querySelector<HTMLElement>("[data-closing-tab]");
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost!.style.getPropertyValue("--tab-slot-width")).toBe("140px");
    flushPaint();
    expect(ghost!.hasAttribute("data-collapsed")).toBe(true);
    act(() => vi.advanceTimersByTime(180));
    expect(
      Array.from(container.querySelectorAll('button[aria-label^="Close "]'), (button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Close first", "Close second"]);
  });

  it("still collapses when the tab's last width was not measured", () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 0, 0));
    closeTab(kind, "second", ["first", "second", "third"]);
    const ghost = container.querySelector<HTMLElement>("[data-closing-tab]");
    expect(ghost).toBeInstanceOf(HTMLElement);
    expect(ghost!.style.getPropertyValue("--tab-slot-width")).toBe("14rem");
    flushPaint();
    expect(ghost!.hasAttribute("data-collapsed")).toBe(true);
  });

  it("skips the collapse when the user prefers reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: String(query).includes("prefers-reduced-motion"),
      media: String(query),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    closeTab(kind, "second", ["first", "second", "third"]);
    expect(container.querySelector("[data-closing-tab]")).toBeNull();
    expect(container.querySelector('[aria-label="Close second"]')).toBeNull();
  });

  it("skips the collapse when tab animations are disabled", () => {
    localStorage.setItem("bycoda.tabAnimationsEnabled", "0");
    closeTab(kind, "second", ["first", "second", "third"]);
    expect(container.querySelector("[data-closing-tab]")).toBeNull();
    expect(container.querySelector('[aria-label="Close second"]')).toBeNull();
  });

  it("does not stage a second resize after an X-button close", () => {
    closeTab(kind, "second", ["first", "second", "third"], true);

    expect(container.querySelector("[data-tab-close-mode]")).toBeNull();
    const liveSlots = Array.from(container.querySelectorAll<HTMLElement>("[data-tab-slot-id]"));
    expect(liveSlots.map((slot) => slot.dataset.tabSlotId)).toEqual(["first", "third"]);
    expect(liveSlots.every((slot) => slot.style.width === "")).toBe(true);
    expect(liveSlots.every((slot) => slot.style.flexShrink === "")).toBe(true);
    flushPaint();
    expect(container.querySelector("[data-closing-tab]")?.hasAttribute("data-collapsed")).toBe(
      true,
    );
  });
});

function addThird(kind: "workspace" | "file") {
  let add = () => {};
  function Tabs() {
    const [ids, setIds] = useState(["first", "second"]);
    add = () => setIds(["first", "second", "third"]);
    return kind === "workspace"
      ? createElement(TitleBar, {
          tabs: ids.map(workspaceTab),
          activeId: ids[ids.length - 1],
          cwd: "/project",
          onToggleSidebar: vi.fn(),
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        })
      : createElement(SurfaceTabs, {
          files: ids.map((id) => ({ id, path: id, cwd: "/project" })),
          activeFileId: ids[ids.length - 1],
          dirtyFileIds: new Set<string>(),
          fileErrorCounts: new Map<string, number>(),
          onSelectFile: vi.fn(),
          onCloseFile: vi.fn(),
          onCloseOtherFiles: vi.fn(),
          onReorder: vi.fn(),
        });
  }

  act(() => root.render(createElement(Tabs)));
  expect(container.querySelector("[data-opening-tab]")).toBeNull();
  act(() => add());
}

describe.each(["workspace", "file"] as const)("%s tab open motion", (kind) => {
  it("expands a new tab from zero width", () => {
    addThird(kind);
    const incoming = container.querySelector<HTMLElement>("[data-opening-tab]");
    expect(incoming).toBeInstanceOf(HTMLElement);
    expect(incoming!.hasAttribute("data-collapsed")).toBe(true);
    expect(container.querySelector('[aria-label="Close third"]')).not.toBeNull();

    flushPaint();
    expect(incoming!.hasAttribute("data-collapsed")).toBe(false);

    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector("[data-opening-tab]")).toBeNull();
    expect(
      Array.from(container.querySelectorAll('button[aria-label^="Close "]'), (button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Close first", "Close second", "Close third"]);
  });

  it("skips the expand when the user prefers reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: String(query).includes("prefers-reduced-motion"),
      media: String(query),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    addThird(kind);
    expect(container.querySelector("[data-opening-tab]")).toBeNull();
    expect(container.querySelector('[aria-label="Close third"]')).not.toBeNull();
  });

  it("skips the expand when tab animations are disabled", () => {
    localStorage.setItem("bycoda.tabAnimationsEnabled", "0");
    addThird(kind);
    expect(container.querySelector("[data-opening-tab]")).toBeNull();
    expect(container.querySelector('[aria-label="Close third"]')).not.toBeNull();
  });
});

describe.each(["workspace", "file"] as const)("%s stable tab measurements", (kind) => {
  it("keeps observers and layout reads stable during status renders, then closes at latest measured width", () => {
    let created = 0;
    let disconnected = 0;
    let measurements = 0;
    let width = 140;
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          created++;
          callbacks.push(() => callback([], this as unknown as ResizeObserver));
        }
        observe() {}
        unobserve() {}
        disconnect() {
          disconnected++;
        }
      },
    );
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-tab-slot-id")) measurements++;
      return new DOMRect(0, 0, width, 32);
    });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    let stream!: () => void;
    let select!: () => void;
    let close!: () => void;
    function Tabs() {
      const [version, setVersion] = useState(0);
      const [ids, setIds] = useState(["first", "second"]);
      const [active, setActive] = useState("first");
      stream = () => setVersion((value) => value + 1);
      select = () => setActive("second");
      close = () => setIds(["first"]);
      const activeId = ids.includes(active) ? active : ids[0];
      return kind === "workspace"
        ? createElement(TitleBar, {
            tabs: ids.map((id) => ({
              ...workspaceTab(id),
              title: `${id} ${version}`,
              busyHarnesses: version % 2 ? ["codex" as const] : [],
            })),
            activeId,
            cwd: "/project",
            onToggleSidebar: vi.fn(),
            onNew: vi.fn(),
            onSelect: vi.fn(),
            onClose: vi.fn(),
            onCloseMany: vi.fn(),
            onReorder: vi.fn(),
          })
        : createElement(SurfaceTabs, {
            files: ids.map((id) => ({ id, path: id, cwd: "/project" })),
            activeFileId: activeId,
            dirtyFileIds: new Set(version % 2 ? ["first"] : []),
            fileErrorCounts: new Map(),
            onSelectFile: vi.fn(),
            onCloseFile: vi.fn(),
            onCloseOtherFiles: vi.fn(),
            onReorder: vi.fn(),
          });
    }
    act(() => root.render(createElement(Tabs)));
    const initial = { created, disconnected, measurements };
    for (let index = 0; index < 10; index++) act(() => stream());
    act(() => select());
    expect({ created, disconnected, measurements }).toEqual(initial);
    expect(initial.measurements).toBe(2);
    width = 188;
    act(() => callbacks.forEach((callback) => callback()));
    act(() => close());
    expect(
      container
        .querySelector<HTMLElement>("[data-closing-tab]")!
        .style.getPropertyValue("--tab-slot-width"),
    ).toBe("188px");
  });
});
