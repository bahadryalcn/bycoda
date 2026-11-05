// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { resetRetainedState } from "../../shared/hooks/useRetainedState";
import { saveSessionFolders } from "../../features/sessions/model/sessionFolders";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => [],
}));
vi.mock("../../features/source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: undefined, refresh: async () => false }),
}));
vi.mock("../../features/source-control/hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/files/ui/FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRetainedState();
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
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
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

async function render() {
  await act(async () => root.render(createElement(Sidebar, { ...props })));
}

// TanStack Virtual's default `isScrollingResetDelay`: rows mounted while it reports
// scrolling are measured only once this debounce ends.
const VIRTUAL_SCROLL_SETTLE_MS = 150;

/** Delivers the scroll event a browser sends after a scrollTop write and lets the
 * virtualizer finish measuring (and anchor-correcting) the rows it mounted. */
async function settleScroll(viewport: HTMLElement) {
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  await act(async () => vi.advanceTimersByTime(VIRTUAL_SCROLL_SETTLE_MS));
  // An anchor correction writes scrollTop; report that position too, as a browser would.
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  await act(async () => vi.advanceTimersByTime(VIRTUAL_SCROLL_SETTLE_MS));
}

function rowCount() {
  const lists = container.querySelectorAll("[data-session-list]");
  return lists.item(lists.length - 1)?.children.length ?? 0;
}

function projectList() {
  const lists = container.querySelectorAll("[data-session-list]");
  return lists.item(lists.length - 1);
}

it("keeps the loaded collection bounded after the sidebar closes and reopens", async () => {
  await render();
  expect(rowCount()).toBeLessThan(500);
  expect(rowCount()).toBeGreaterThan(0);
  props.open = false;
  await render();
  props.open = true;
  await render();
  expect(rowCount()).toBeLessThan(500);
});

it("mounts a bounded collection when the sidebar is initially closed", async () => {
  props.open = false;
  await render();
  props.open = true;
  await render();
  expect(rowCount()).toBeLessThan(500);
  expect(rowCount()).toBeGreaterThan(0);
});

it("retains an older active conversation in the virtual window", async () => {
  props.activeSessionId = props.sessions[250].id;
  await render();
  expect(rowCount()).toBeLessThan(500);
  expect(projectList()?.textContent).toContain("Conversation 250");
});

it("scrolls the shared viewport to later virtual rows", async () => {
  await render();
  const viewport = container.querySelector<HTMLElement>("[data-session-list-panel]")!;
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 280 });
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 40_000 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 320, 280);
  viewport.scrollTop = 20_000;
  await act(async () => viewport.dispatchEvent(new Event("scroll")));
  const indices = Array.from(
    projectList()?.querySelectorAll<HTMLElement>("[data-index]") ?? [],
  ).map((row) => Number(row.dataset.index));
  expect(indices.some((index) => index > 64)).toBe(true);
  expect(rowCount()).toBeLessThan(100);
  await act(async () => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight - 1;
    viewport.dispatchEvent(new Event("scroll"));
  });
  const endIndices = Array.from(
    projectList()?.querySelectorAll<HTMLElement>("[data-index]") ?? [],
  ).map((row) => Number(row.dataset.index));
  expect(Math.max(...endIndices)).toBeGreaterThan(450);
});

it("bounds an expanded folder containing hundreds of sessions", async () => {
  saveSessionFolders(props.cwd, [
    {
      id: "large-folder",
      name: "Large folder",
      sessionIds: props.sessions.map((session) => session.id),
      collapsed: false,
    },
  ]);
  await render();
  expect(projectList()?.querySelector('[data-session-folder="large-folder"]')).not.toBeNull();
  expect(projectList()?.textContent).toContain("Large folder");
  expect(rowCount()).toBeLessThan(100);
});

it("keeps select-all state while the large session window stays bounded", async () => {
  await render();
  const select = container.querySelector<HTMLButtonElement>('[aria-label="Select conversations"]')!;
  await act(async () => select.click());
  const selectAll = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Select all",
  )!;
  await act(async () => selectAll.click());
  expect(container.textContent).toContain("500 selected");
  expect(rowCount()).toBeLessThan(100);
});

it("restores scroll within a list scope and resets it for another project", async () => {
  // happy-dom has no ResizeObserver callbacks and fires no scroll event for scrollTop
  // writes, so the virtualizer's scroll-end debounce must run on a controlled clock.
  // With real timers it lands before or after the project switch at random.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await render();
  const viewport = container.querySelector<HTMLElement>("[data-session-list-panel]")!;
  viewport.scrollTop = 1_200;
  await settleScroll(viewport);
  const left = viewport.scrollTop;
  expect(left).toBeGreaterThanOrEqual(1_200);
  const originalSessions = props.sessions;
  props.cwd = "/workspace/other";
  props.sessions = originalSessions.map((session) => ({ ...session, cwd: props.cwd }));
  await render();
  expect(viewport.scrollTop).toBe(0);
  await settleScroll(viewport);
  expect(viewport.scrollTop).toBe(0);
  props.cwd = "/workspace/project";
  props.sessions = originalSessions;
  await render();
  expect(viewport.scrollTop).toBe(left);
  await settleScroll(viewport);
  expect(viewport.scrollTop).toBe(left);
});
