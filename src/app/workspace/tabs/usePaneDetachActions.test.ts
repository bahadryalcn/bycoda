// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import {
  leaf,
  leafIds,
  newTab,
  splitPane,
  type EditorPane,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  subscribeWindowTransferNotice,
} from "../../model/windowTransferNotice";
import type { MoveTabsOutcome } from "../windows/useMoveTabsToNewWindow";
import { usePaneDetachActions, type PaneDetachActionDeps } from "./usePaneDetachActions";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let deps: PaneDetachActionDeps;
let actions: ReturnType<typeof usePaneDetachActions>;
let source: WorkspaceTab;
let published: number;
let unsubscribe: () => void;
const position = { x: 40, y: 60 };

function file(id: string, extra: Partial<FilePaneTab> = {}): FilePaneTab {
  return { id, path: `/repo/${id}`, cwd: "/repo", ...extra };
}

function pane(id: string, files: FilePaneTab[]): EditorPane {
  return { id, files, activeFileId: files[0].id };
}

/** One tab holding a session pane and a second pane, so the second can be detached. */
function splitTab(editorPanes: EditorPane[] = []): WorkspaceTab {
  return {
    ...newTab("pane-a"),
    id: "source-tab",
    layout: splitPane(leaf("pane-a"), "pane-a", "right", "pane-b"),
    focusedId: "pane-b",
    editorPanes,
  };
}

function mount(onMove: PaneDetachActionDeps["onMoveTabsToNewWindow"], tab = source) {
  deps = {
    tabsRef: { current: [tab] },
    movingTabIds: { current: new Set() },
    dirtyFilesRef: { current: new Set() },
    isMovingPane: vi.fn(() => false),
    setTabs: vi.fn(),
    setProjectTerminalFocused: vi.fn(),
    activateTab: vi.fn(),
    onMoveTabsToNewWindow: onMove,
  };
  function Harness() {
    actions = usePaneDetachActions(deps);
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(message).mockClear();
  dismissWindowTransferNotice();
  published = 0;
  unsubscribe = subscribeWindowTransferNotice(() => {
    if (getWindowTransferNotice()) published += 1;
  });
  source = splitTab();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  unsubscribe();
  act(() => root.unmount());
  document.querySelector("[data-drag-announcer]")?.remove();
  vi.unstubAllGlobals();
});

describe("pane pop-out keeps source ownership until the receiver answers", () => {
  it("hands a single-pane tab over without splitting it first", () => {
    const only = { ...newTab("solo"), id: "solo-tab" };
    const move = vi.fn(async () => "transferred" as MoveTabsOutcome);
    mount(move, only);
    act(() => actions.onPopOutPane("solo", position));
    expect(move).toHaveBeenCalledExactlyOnceWith(["solo-tab"], { position });
    expect(deps.setTabs).not.toHaveBeenCalled();
  });

  it("detaches into its own tab, then waits: nothing is restored while the move is pending", async () => {
    let settle!: (outcome: MoveTabsOutcome) => void;
    const move = vi.fn(() => new Promise<MoveTabsOutcome>((resolve) => (settle = resolve)));
    mount(move);
    act(() => actions.onPopOutPane("pane-b", position));
    const detachedTab = deps.tabsRef.current.find((tab) => tab.id !== "source-tab");
    expect(detachedTab && leafIds(detachedTab.layout)).toEqual(["pane-b"]);
    expect(leafIds(deps.tabsRef.current.find((tab) => tab.id === "source-tab")!.layout)).toEqual([
      "pane-a",
    ]);
    expect(move).toHaveBeenCalledExactlyOnceWith([detachedTab!.id], { position });
    expect(deps.setTabs).toHaveBeenCalledOnce();
    // The source still owns the detached tab here: it is only removed by the move owner on ACK.
    expect(deps.tabsRef.current).toHaveLength(2);
    await act(async () => settle("transferred"));
    // A completed transfer is not undone by this hook and publishes nothing.
    expect(deps.setTabs).toHaveBeenCalledOnce();
    expect(published).toBe(0);
  });

  it.each(["queued", "relocated", undefined] as const)(
    "does not restore the split for outcome %s",
    async (outcome) => {
      const move = vi.fn(async () => outcome);
      mount(move);
      await act(async () => actions.onPopOutPane("pane-b", position));
      expect(deps.setTabs).toHaveBeenCalledOnce();
      expect(deps.tabsRef.current).toHaveLength(2);
      expect(published).toBe(0);
    },
  );

  it("restores the original split once and tells the user when the move fails", async () => {
    const move = vi.fn(async () => "failed" as MoveTabsOutcome);
    mount(move);
    await act(async () => actions.onPopOutPane("pane-b", position));
    expect(deps.tabsRef.current).toHaveLength(1);
    const restored = deps.tabsRef.current[0];
    expect(restored.id).toBe("source-tab");
    expect(restored.layout).toBe(source.layout);
    expect(restored.focusedId).toBe("pane-b");
    expect(deps.activateTab).toHaveBeenLastCalledWith("source-tab", "pane-b");
    expect(published).toBe(1);
    expect(getWindowTransferNotice()).toMatchObject({
      tone: "info",
      message: "The pane went back to its original split.",
    });
  });

  it("brings the detached editor pane back with its files when the move fails", async () => {
    const editor = pane("pane-b", [file("one")]);
    source = splitTab([editor]);
    mount(async () => "failed" as MoveTabsOutcome);
    await act(async () => actions.onPopOutPane("pane-b", position));
    expect(deps.tabsRef.current).toHaveLength(1);
    expect(deps.tabsRef.current[0].editorPanes.map((entry) => entry.id)).toEqual(["pane-b"]);
  });

  it("leaves a layout the user rearranged while the move was pending", async () => {
    let settle!: (outcome: MoveTabsOutcome) => void;
    mount(() => new Promise<MoveTabsOutcome>((resolve) => (settle = resolve)));
    act(() => actions.onPopOutPane("pane-b", position));
    const [remainder, detached] = deps.tabsRef.current;
    deps.tabsRef.current = [{ ...remainder, layout: leaf("pane-a") }, detached];
    const rearranged = deps.tabsRef.current;
    await act(async () => settle("failed"));
    expect(deps.tabsRef.current).toBe(rearranged);
    expect(published).toBe(0);
  });

  it("does nothing for a tab that is already moving", () => {
    const move = vi.fn(async () => "transferred" as MoveTabsOutcome);
    mount(move);
    deps.movingTabIds.current.add("source-tab");
    act(() => actions.onPopOutPane("pane-b", position));
    expect(move).not.toHaveBeenCalled();
    expect(deps.setTabs).not.toHaveBeenCalled();
  });

  it("refuses a pane with unsaved files and explains why", () => {
    const editor = pane("pane-b", [file("dirty")]);
    source = splitTab([editor]);
    const move = vi.fn(async () => "transferred" as MoveTabsOutcome);
    mount(move);
    deps.dirtyFilesRef.current.add("dirty");
    act(() => actions.onPopOutPane("pane-b", position));
    expect(message).toHaveBeenCalledOnce();
    expect(move).not.toHaveBeenCalled();
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.tabsRef.current).toEqual([source]);
  });

  it("never moves a pane holding a live terminal", () => {
    const editor = pane("pane-b", [file("shell", { terminal: true })]);
    source = splitTab([editor]);
    const move = vi.fn(async () => "transferred" as MoveTabsOutcome);
    mount(move);
    act(() => actions.onPopOutPane("pane-b", position));
    expect(move).not.toHaveBeenCalled();
    expect(deps.setTabs).not.toHaveBeenCalled();
  });
});

describe("pane detach inside the window", () => {
  it("is ignored while the pane or target tab is moving", () => {
    const move = vi.fn(async () => "transferred" as MoveTabsOutcome);
    mount(move);
    vi.mocked(deps.isMovingPane).mockReturnValue(true);
    act(() => actions.onDetachPane("pane-b", "source-tab", "after"));
    expect(deps.setTabs).not.toHaveBeenCalled();
    vi.mocked(deps.isMovingPane).mockReturnValue(false);
    deps.movingTabIds.current.add("source-tab");
    act(() => actions.onDetachPane("pane-b", "source-tab", "after"));
    expect(deps.setTabs).not.toHaveBeenCalled();
  });

  it("detaches the pane into a neighbouring tab when nothing is moving", () => {
    mount(vi.fn(async () => "transferred" as MoveTabsOutcome));
    act(() => actions.onDetachPane("pane-b", "source-tab", "after"));
    expect(deps.setTabs).toHaveBeenCalledOnce();
    expect(deps.tabsRef.current).toHaveLength(2);
    expect(deps.setProjectTerminalFocused).toHaveBeenCalledWith(false);
  });
});
