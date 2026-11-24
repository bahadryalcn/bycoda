// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearComposerDraft, setComposerDraft } from "../../features/sessions/model/draftCache";
import { formatSessionTitle, HARNESS_TITLE } from "../../features/sessions/model/session";
import * as reactiveReads from "../../features/sessions/model/reactiveReads";
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

it("updates matching title text without resolving the retained row's model again", async () => {
  const resolve = vi.spyOn(reactiveReads, "useResolvedModelName");
  props.sessions = [session("alpha", 100)];
  render();
  const select = container.querySelector<HTMLButtonElement>('[data-session-select="alpha"]')!;
  const title = select.querySelector<HTMLElement>("[data-clamped]")!;
  const nativeTooltip = title.getAttribute("title");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Search sessions"]')!.click(),
  );
  const field = container.querySelector<HTMLInputElement>('input[placeholder="Search…"]')!;
  async function type(query: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, query);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await type("alp");
  expect(title.querySelector("[data-match]")?.textContent).toBe("alp");
  resolve.mockClear();
  await type("alpha");
  expect(title.querySelector("[data-match]")?.textContent).toBe("alpha");
  expect(title.textContent).toBe("Conversation alpha");
  expect(title.getAttribute("title")).toBe(nativeTooltip);
  expect(resolve).not.toHaveBeenCalled();
});

it("resolves only the current provider's model and keeps a handoff without a model on its provider label", async () => {
  const resolve = vi
    .spyOn(reactiveReads, "useResolvedModelName")
    .mockImplementation((harness, model) => (harness ? `${harness}/${model}` : undefined));
  const base = { ...session("alpha", 100), model: "saved-model" };
  props.sessions = [base];
  await act(async () => root.render(createElement(Sidebar, props)));
  const modelLabel = () =>
    container.querySelector("[data-session-row-model]")?.getAttribute("aria-label");
  expect(modelLabel()).toBe("codex/saved-model");
  const history = {
    providers: ["codex", "claude"] as ("codex" | "claude")[],
    activeHarness: "claude" as const,
  };
  props.sessions = [{ ...base, providerHistory: history }];
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(modelLabel()).toBe(HARNESS_TITLE.claude);
  resolve.mockClear();
  props.sessions = [{ ...base, providerHistory: { ...history, activeModel: "submitted-model" } }];
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(modelLabel()).toBe("claude/submitted-model");
  expect(resolve.mock.calls.every(([harness]) => harness === "claude")).toBe(true);
});

it("only watches scrolling during a pending or open row detail", () => {
  vi.useFakeTimers();
  props.sessions = [session("first", 100)];
  render();
  const watch = vi.spyOn(document, "addEventListener");
  props.sessions = [...props.sessions, session("second", 110)];
  render();
  const scrollWatches = () =>
    watch.mock.calls.filter(([name, , capture]) => name === "scroll" && capture === true);
  expect(scrollWatches()).toHaveLength(0);
  const row = container.querySelector<HTMLElement>('[data-session-card="second"]')!;
  const select = row.querySelector<HTMLButtonElement>("[data-session-select]")!;
  const scroller = container.querySelector<HTMLElement>(".sidebar-session-scroll")!;
  act(() => row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
  expect(scrollWatches()).toHaveLength(1);
  act(() => scroller.dispatchEvent(new Event("scroll")));
  act(() => vi.advanceTimersByTime(700));
  expect(select.hasAttribute("aria-describedby")).toBe(false);
  act(() => select.focus());
  expect(select.hasAttribute("aria-describedby")).toBe(true);
  act(() => scroller.dispatchEvent(new Event("scroll")));
  expect(select.hasAttribute("aria-describedby")).toBe(true);
  act(() => select.blur());
  expect(select.hasAttribute("aria-describedby")).toBe(false);
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
