// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearComposerDraft, setComposerDraft } from "../../features/sessions/model/draftCache";
import { formatSessionTitle } from "../../features/sessions/model/session";
import { loadSessionFolders } from "../../features/sessions/model/sessionFolders";
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

function session(id: string, updatedAt: number) {
  return {
    id,
    cwd: CWD,
    harness: "codex" as const,
    model: "",
    runtimeMode: "supervised" as const,
    title: formatSessionTitle("codex", `Conversation ${id}`),
    createdAt: updatedAt,
    updatedAt,
  };
}

const render = () => act(() => root.render(createElement(Sidebar, props)));
const order = () =>
  [...container.querySelectorAll<HTMLElement>("[data-session-card]")].map(
    (card) => card.dataset.sessionCard,
  );

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
    sessions: [],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "other",
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
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("moves rows as their status changes and reports the same keyboard order", () => {
  props.sessions = [
    session("history", 100),
    session("done", 110),
    session("working", 80),
    { ...session("failed", 70), issue: "failed" },
    session("input", 60),
  ];
  props.busySessionIds = new Set(["working"]);
  props.approvalSessionIds = new Set(["input"]);
  props.unseenFinishedIds = new Set(["done"]);
  props.onSessionNavigationOrder = vi.fn();
  render();
  expect(order()).toEqual(["input", "failed", "done", "working", "history"]);
  expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(order());
  props.approvalSessionIds = new Set(["history"]);
  props.unseenFinishedIds = new Set(["done", "input"]);
  render();
  expect(order()).toEqual(["history", "failed", "done", "input", "working"]);
  expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(order());
});

it("keeps a completed row in place while it is open, then returns it to recency", () => {
  props.sessions = [session("history", 100), session("done", 200), session("older-done", 50)];
  props.unseenFinishedIds = new Set(["done", "older-done"]);
  props.onSessionNavigationOrder = vi.fn();
  render();
  expect(order()).toEqual(["done", "older-done", "history"]);
  props = { ...props, activeSessionId: "done", unseenFinishedIds: new Set(["older-done"]) };
  render();
  expect(order()).toEqual(["done", "older-done", "history"]);
  expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith(order());
  props = { ...props, activeSessionId: "history" };
  render();
  expect(order()).toEqual(["older-done", "done", "history"]);
});

it("keeps an unsent draft lifted when opened", () => {
  props.sessions = [session("newest", 300), session("middle", 200), session("typed", 100)];
  render();
  act(() => setComposerDraft("typed", "half a thought"));
  expect(order()).toEqual(["typed", "newest", "middle"]);
  props = { ...props, activeSessionId: "typed" };
  render();
  expect(order()).toEqual(["typed", "newest", "middle"]);
  act(() => clearComposerDraft("typed"));
});

it("keeps unpinned rows in recency order when one is dropped between them", () => {
  vi.useFakeTimers();
  // An order saved by an earlier drag no longer freezes the list.
  localStorage.setItem("bycoda.sessionOrder", JSON.stringify({ [CWD]: { loose: ["c", "a"] } }));
  props.sessions = [session("a", 3000), session("b", 2000), session("c", 1000)];
  render();
  expect(order()).toEqual(["a", "b", "c"]);
  const card = (id: string) => container.querySelector<HTMLElement>(`[data-session-card="${id}"]`)!;
  const from = card("c");
  from.setPointerCapture = vi.fn();
  from.releasePointerCapture = vi.fn();
  card("a").getBoundingClientRect = () => new DOMRect(0, 100, 200, 40);
  const scroller = container.querySelector<HTMLElement>(".sidebar-session-scroll")!;
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 300, 600);
  const emit = (target: EventTarget, type: string, y: number) =>
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 50, clientY: y }),
      );
    });
  emit(from, "pointerdown", 300);
  emit(window, "pointermove", 104);
  emit(window, "pointerup", 104);
  expect(order()).toEqual(["a", "b", "c"]);
  expect(loadSessionFolders(CWD)).toEqual([]);
});
