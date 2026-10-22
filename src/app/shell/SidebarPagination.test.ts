// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { LIST_PAGE_SIZE } from "../../shared/lib/listWindow";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;
const observers = new Set<{ target: Element; callback: IntersectionObserverCallback }>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  observers.clear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      subscription?: { target: Element; callback: IntersectionObserverCallback };
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.subscription = { target, callback: this.callback };
        observers.add(this.subscription);
      }
      disconnect() {
        if (this.subscription) observers.delete(this.subscription);
      }
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    cwd: "/workspace/project",
    open: true,
    sessions: Array.from({ length: 500 }, (_, index) => ({
      id: `session-${index}`,
      cwd: "/workspace/project",
      harness: "codex" as const,
      executionMode: "supervised" as const,
      title: `Conversation ${index}`,
      createdAt: 1,
      updatedAt: 1,
    })),
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function render() {
  await act(async () => root.render(createElement(Sidebar, { ...props })));
}

function rowCount() {
  return container.querySelector("[data-session-list]")?.children.length ?? 0;
}

async function reachBottom() {
  const subscription = [...observers].find(({ target }) => container.contains(target));
  expect(subscription, "the mounted list must have an active load-more observer").toBeDefined();
  await act(async () =>
    subscription!.callback(
      [{ isIntersecting: true, target: subscription!.target } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}

it("keeps loading all 500 conversations after the sidebar closes and reopens", async () => {
  await render();
  expect(rowCount()).toBe(LIST_PAGE_SIZE + 1);
  props.open = false;
  await render();
  props.open = true;
  await render();
  await reachBottom();
  expect(rowCount()).toBe(LIST_PAGE_SIZE * 2 + 1);
  while (rowCount() < 500) await reachBottom();
  expect(rowCount()).toBe(500);
});

it("attaches pagination when the sidebar is initially closed", async () => {
  props.open = false;
  await render();
  props.open = true;
  await render();
  await reachBottom();
  expect(rowCount()).toBe(LIST_PAGE_SIZE * 2 + 1);
});

it("loads beyond an older active conversation included in the initial window", async () => {
  props.activeSessionId = props.sessions[250].id;
  await render();
  const initialCount = rowCount();
  expect(initialCount).toBeGreaterThan(LIST_PAGE_SIZE + 1);
  await reachBottom();
  expect(rowCount()).toBe(initialCount + LIST_PAGE_SIZE);
});
