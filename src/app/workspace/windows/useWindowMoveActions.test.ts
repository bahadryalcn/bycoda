// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { newSession } from "../../../features/sessions/model/session";
import {
  leaf,
  newTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  subscribeWindowTransferNotice,
} from "../../model/windowTransferNotice";
import type { PendingWindowMoves } from "../../model/windowTransferPopout";
import { useWindowMoveActions, type WindowMoveActionDeps } from "./useWindowMoveActions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let deps: WindowMoveActionDeps;
let actions: ReturnType<typeof useWindowMoveActions>;
let published: string[];
let unsubscribe: () => void;

function file(id: string): FilePaneTab {
  return { id, path: `/repo/${id}`, cwd: "/repo" };
}

function render(overrides: Partial<WindowMoveActionDeps> = {}) {
  deps = {
    pendingWindowMoves: {},
    tabs: [],
    sessions: [],
    setPendingWindowMoves: vi.fn(),
    onMoveTabsToNewWindow: vi.fn(async () => "transferred"),
    onCloseFile: vi.fn(),
    isMovingPane: vi.fn(() => false),
    tabsRef: { current: [] },
    dirtyFilesRef: { current: new Set() },
    projectCwdRef: { current: "/repo" },
    openingFileWindowIds: { current: new Set() },
    movingTabIds: { current: new Set() },
    movingSessionIds: { current: new Set() },
    setMovingWindows: vi.fn(),
    ...overrides,
  };
  function Harness() {
    actions = useWindowMoveActions(deps);
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.mocked(invoke).mockReset();
  vi.mocked(message).mockClear();
  dismissWindowTransferNotice();
  published = [];
  unsubscribe = subscribeWindowTransferNotice(() => {
    const notice = getWindowTransferNotice();
    if (notice) published.push(notice.message);
  });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  unsubscribe();
  act(() => root.unmount());
  document.querySelector("[data-drag-announcer]")?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("queued window moves", () => {
  it("moves a queued tab once its response has finished and drops it from the queue", () => {
    const idleSession = { ...newSession("codex", "/repo"), id: "idle", busy: false };
    const busySession = { ...newSession("codex", "/repo"), id: "busy", busy: true };
    const idleTab: WorkspaceTab = { ...newTab(idleSession.id), id: "idle-tab" };
    const busyTab: WorkspaceTab = { ...newTab(busySession.id), id: "busy-tab" };
    const pending: PendingWindowMoves = {
      "idle-tab": { x: 5, y: 6, targetWindowLabel: "other" },
      "busy-tab": null,
      "closed-tab": null,
    };
    render({
      pendingWindowMoves: pending,
      tabs: [idleTab, busyTab],
      sessions: [idleSession, busySession],
    });
    expect(deps.onMoveTabsToNewWindow).toHaveBeenCalledOnce();
    expect(deps.onMoveTabsToNewWindow).toHaveBeenCalledWith(["idle-tab"], {
      position: { x: 5, y: 6, targetWindowLabel: "other" },
      targetWindowLabel: "other",
    });
    const update = vi.mocked(deps.setPendingWindowMoves).mock.calls[0][0] as (
      previous: PendingWindowMoves,
    ) => PendingWindowMoves;
    // The ready tab and the vanished tab leave the queue; the still-busy tab stays queued.
    expect(Object.keys(update(pending))).toEqual(["busy-tab"]);
    expect(published).toEqual([]);
  });

  it("leaves a queue alone while every tab is still busy", () => {
    const busySession = { ...newSession("codex", "/repo"), id: "busy", busy: true };
    const busyTab: WorkspaceTab = { ...newTab(busySession.id), id: "busy-tab" };
    render({
      pendingWindowMoves: { "busy-tab": null },
      tabs: [busyTab],
      sessions: [busySession],
    });
    expect(deps.onMoveTabsToNewWindow).not.toHaveBeenCalled();
    expect(deps.setPendingWindowMoves).not.toHaveBeenCalled();
  });

  it("cancels one queued move, keeps the others and tells the user once", () => {
    render();
    act(() => actions.onCancelMoveToNewWindow("busy-tab"));
    expect(deps.setPendingWindowMoves).toHaveBeenCalledOnce();
    const update = vi.mocked(deps.setPendingWindowMoves).mock.calls[0][0] as (
      previous: PendingWindowMoves,
    ) => PendingWindowMoves;
    expect(update({ "busy-tab": null, other: null })).toEqual({ other: null });
    expect(deps.onMoveTabsToNewWindow).not.toHaveBeenCalled();
    expect(published).toEqual(["The move to a new window was cancelled."]);
  });
});

describe("opening one file in a new window", () => {
  function twoFileTab(): WorkspaceTab {
    const pane = { id: "editor-pane", files: [file("one"), file("two")], activeFileId: "one" };
    return {
      ...newTab("unused"),
      id: "editor-tab",
      layout: leaf(pane.id),
      focusedId: pane.id,
      editorPanes: [pane],
    };
  }

  it("closes the original editor only after the new window took the file", async () => {
    const tab = twoFileTab();
    vi.mocked(invoke).mockResolvedValue("moved");
    render({ tabsRef: { current: [tab] } });
    await act(async () => actions.onOpenFileInNewWindow("editor-pane", "two"));
    expect(invoke).toHaveBeenCalledOnce();
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe("move_window_tabs");
    expect(deps.onCloseFile).toHaveBeenCalledExactlyOnceWith("editor-pane", "two", {
      skipConfirm: true,
    });
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(deps.openingFileWindowIds.current.size).toBe(0);
  });

  it("keeps the original editor, explains and releases the guards when the move is refused", async () => {
    const tab = twoFileTab();
    vi.mocked(invoke).mockRejectedValue(new Error("Receiver refused"));
    render({ tabsRef: { current: [tab] } });
    await act(async () => actions.onOpenFileInNewWindow("editor-pane", "two"));
    expect(deps.onCloseFile).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledOnce();
    expect(vi.mocked(message).mock.calls[0][0]).toContain("The original editor is still here.");
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(deps.openingFileWindowIds.current.size).toBe(0);
    const lastMoving = vi.mocked(deps.setMovingWindows).mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastMoving.size).toBe(0);
  });

  it("does not move a file with unsaved edits", async () => {
    const tab = twoFileTab();
    render({ tabsRef: { current: [tab] }, dirtyFilesRef: { current: new Set(["two"]) } });
    await act(async () => actions.onOpenFileInNewWindow("editor-pane", "two"));
    expect(invoke).not.toHaveBeenCalled();
    expect(deps.onCloseFile).not.toHaveBeenCalled();
  });

  it("ignores a file that is already opening or whose pane is moving", async () => {
    const tab = twoFileTab();
    render({
      tabsRef: { current: [tab] },
      openingFileWindowIds: { current: new Set(["two"]) },
    });
    await act(async () => actions.onOpenFileInNewWindow("editor-pane", "two"));
    expect(invoke).not.toHaveBeenCalled();
    render({ tabsRef: { current: [tab] }, isMovingPane: vi.fn(() => true) });
    await act(async () => actions.onOpenFileInNewWindow("editor-pane", "one"));
    expect(invoke).not.toHaveBeenCalled();
  });
});
