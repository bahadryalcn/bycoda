// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    project: "project",
    title: id,
    more: [],
    sessionCount: 1,
    harnesses: ["codex"],
    busyHarnesses: [],
    doneHarnesses: [],
    files: [],
    ...overrides,
  };
}

function render(tabs: Tab[]) {
  act(() =>
    root.render(
      createElement(TitleBar, {
        tabs,
        activeId: "active",
        cwd: "/project",
        onToggleSidebar: vi.fn(),
        onNew: vi.fn(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onReorder: vi.fn(),
      }),
    ),
  );
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

describe("title tab response status", () => {
  it("shows a teal completion check until the response is seen", () => {
    render([tab("done", { doneHarnesses: ["codex"] }), tab("active")]);

    const doneTab = container.querySelector('[data-title-tab-id="done"]')!;
    expect(doneTab.querySelector('[data-harness-status="done"]')).not.toBeNull();
    expect(doneTab.querySelector("svg")?.classList.contains("text-teal-400")).toBe(true);
    expect(doneTab.querySelector("button")?.getAttribute("aria-label")).toContain(
      "Response complete",
    );

    render([tab("done"), tab("active")]);
    expect(
      container.querySelector('[data-title-tab-id="done"] [data-harness-status="idle"]'),
    ).not.toBeNull();
  });

  it("keeps the loading indicator ahead of completion for the same provider", () => {
    render([
      tab("working", {
        busyHarnesses: ["codex"],
        doneHarnesses: ["codex"],
      }),
      tab("active"),
    ]);

    expect(
      container.querySelector('[data-title-tab-id="working"] [data-harness-status="busy"]'),
    ).not.toBeNull();
  });
});

it.each([true, false])(
  "offers a separate session sidebar toggle when the project rail is %s",
  (projectRailOpen) => {
    const onToggleSidebar = vi.fn();
    const onToggleSessionSidebar = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active")],
          activeId: "active",
          cwd: "/project",
          projectRailOpen,
          sessionSidebarOpen: false,
          onToggleSidebar,
          onToggleSessionSidebar,
          onNew: vi.fn(),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Toggle Session Sidebar"]',
    );
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    expect(onToggleSessionSidebar).toHaveBeenCalledOnce();
    expect(onToggleSidebar).not.toHaveBeenCalled();
  },
);

it.each([true, false])(
  "keeps search/new fallback only while session sidebar is closed (open: %s)",
  (sessionSidebarOpen) => {
    const onNew = vi.fn();
    const onGoToFile = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active")],
          activeId: "active",
          cwd: "/project",
          projectRailOpen: false,
          sessionSidebarOpen,
          onToggleSidebar: vi.fn(),
          onNew,
          onGoToFile,
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );
    const search = container.querySelector<HTMLButtonElement>('button[aria-label^="Go to File"]');
    const create = container.querySelector<HTMLButtonElement>('button[aria-label^="New session"]');
    if (sessionSidebarOpen) {
      expect(search).toBeNull();
      expect(create).toBeNull();
    } else {
      expect(search).not.toBeNull();
      expect(create).not.toBeNull();
      act(() => {
        search!.click();
        create!.click();
      });
      expect(onGoToFile).toHaveBeenCalledOnce();
      expect(onNew).toHaveBeenCalledOnce();
    }
  },
);
