// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { newSession } from "../../../features/sessions/model/session";
import { newEditorWorkspaceTab, newTab } from "../../../features/workspace/model/layout";
import {
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  subscribeWindowTransferNotice,
} from "../../model/windowTransferNotice";
import { useMoveTabsToNewWindow, type MoveTabsToNewWindowDeps } from "./useMoveTabsToNewWindow";

const native = vi.hoisted(() => ({ label: "window-1" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("../../model/appLifecycle", () => ({
  abortQuit: vi.fn(),
  relinquishTransferredWindow: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let deps: MoveTabsToNewWindowDeps;
let actions: ReturnType<typeof useMoveTabsToNewWindow>;
const position = { x: 1200, y: 10, clientX: 1400, clientY: 30, pixelRatio: 1.5 };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.mocked(invoke).mockReset();
  vi.mocked(message).mockClear();
  native.label = "window-1";
  const session = { ...newSession("codex", "/repo"), id: "running-session", busy: true };
  const tab = { ...newTab(session.id), id: crypto.randomUUID() };
  deps = {
    activateTab: vi.fn(),
    tabsRef: { current: [tab] },
    sessionsRef: { current: [session] },
    projectTerminalsRef: { current: [] },
    activeTabIdRef: { current: tab.id },
    projectCwdRef: { current: "/repo" },
    dirtyFilesRef: { current: new Set() },
    movingTabIds: { current: new Set() },
    movingSessionIds: { current: new Set() },
    skipForgetSessionIds: { current: new Set() },
    setMovingWindows: vi.fn(),
    setPendingWindowMoves: vi.fn(),
    setProjectTerminals: vi.fn(),
    setSessions: vi.fn(),
    setTabs: vi.fn(),
    setDirtyFiles: vi.fn(),
  };
  container = document.createElement("div");
  root = createRoot(container);
  function Harness() {
    actions = useMoveTabsToNewWindow(deps);
    return null;
  }
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("detached workspace movement", () => {
  it("relocates a running workspace without queuing or transferring its live session", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const result = await actions.onMoveTabsToNewWindow([deps.activeTabIdRef.current], { position });
    expect(result).toBe("relocated");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("try_relocate_workspace_window", {
      clientX: 1400,
      clientY: 30,
      pixelRatio: 1.5,
    });
    expect(deps.setPendingWindowMoves).not.toHaveBeenCalled();
    expect(deps.setSessions).not.toHaveBeenCalled();
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.movingTabIds.current.size).toBe(0);
  });

  it("keeps the safe transfer path when another workspace is under the pointer", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    expect(await actions.onMoveTabsToNewWindow([deps.activeTabIdRef.current], { position })).toBe(
      "queued",
    );
    expect(deps.setPendingWindowMoves).toHaveBeenCalledOnce();
    expect(deps.setSessions).not.toHaveBeenCalled();
  });

  it.each(["main", "explicit-destination", "subset"])(
    "does not relocate the whole window for %s",
    async (scenario) => {
      if (scenario === "main") native.label = "main";
      if (scenario === "subset") deps.tabsRef.current.push(newTab("other-session"));
      const result = await actions.onMoveTabsToNewWindow([deps.activeTabIdRef.current], {
        position,
        targetWindowLabel: scenario === "explicit-destination" ? "main" : undefined,
      });
      expect(result).toBe("queued");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("preserves the original workspace and releases the guard on native failure", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Unavailable monitor"));
    expect(await actions.onMoveTabsToNewWindow([deps.activeTabIdRef.current], { position })).toBe(
      "failed",
    );
    expect(deps.setSessions).not.toHaveBeenCalled();
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.setPendingWindowMoves).not.toHaveBeenCalled();
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(message).toHaveBeenCalledOnce();
  });
});

describe("transfer to another window: ownership, ACK, reject and queue", () => {
  let published: string[];
  let unsubscribe: () => void;
  const flush = () => act(async () => {});
  const idle = () => {
    deps.sessionsRef.current = deps.sessionsRef.current.map((entry) => ({ ...entry, busy: false }));
  };

  beforeEach(() => {
    native.label = "main";
    dismissWindowTransferNotice();
    published = [];
    unsubscribe = subscribeWindowTransferNotice(() => {
      const notice = getWindowTransferNotice();
      if (notice) published.push(notice.message);
    });
  });

  afterEach(() => {
    unsubscribe();
    document.querySelector("[data-drag-announcer]")?.remove();
  });

  it("keeps the tab and its guards here until the receiver acknowledges the move", async () => {
    idle();
    let acknowledge!: (outcome: string) => void;
    vi.mocked(invoke).mockImplementation(
      () => new Promise<unknown>((resolve) => (acknowledge = resolve as (value: string) => void)),
    );
    const tabId = deps.activeTabIdRef.current;
    let result: Promise<unknown> | undefined;
    act(() => {
      result = actions.onMoveTabsToNewWindow([tabId], { position: { x: 1, y: 2 } });
    });
    await flush();
    expect(invoke).toHaveBeenCalledOnce();
    const [command, args] = vi.mocked(invoke).mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe("move_window_tabs");
    expect(JSON.parse(args.transfer as string).tabs.map((tab: { id: string }) => tab.id)).toEqual([
      tabId,
    ]);
    expect(args).toMatchObject({ targetWindowLabel: null, relocate: false });
    // Pending: this window still owns everything and the tab and session are locked.
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.setSessions).not.toHaveBeenCalled();
    expect(deps.movingTabIds.current.has(tabId)).toBe(true);
    expect(deps.movingSessionIds.current.has("running-session")).toBe(true);
    expect(deps.skipForgetSessionIds.current.has("running-session")).toBe(true);
    acknowledge("moved");
    expect(await result).toBe("transferred");
    expect(deps.setTabs).toHaveBeenCalledOnce();
    expect(deps.setSessions).toHaveBeenCalledOnce();
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(deps.skipForgetSessionIds.current.size).toBe(0);
    const lastMoving = vi.mocked(deps.setMovingWindows).mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastMoving.size).toBe(0);
    expect(published).toEqual([]);
  });

  it("keeps the tab and shows the reason when the receiver rejects the move", async () => {
    idle();
    vi.mocked(invoke).mockRejectedValue(
      new Error("This panel is not ready to receive a transfer."),
    );
    const tabId = deps.activeTabIdRef.current;
    expect(await actions.onMoveTabsToNewWindow([tabId], { position })).toBe("failed");
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.setSessions).not.toHaveBeenCalled();
    expect(deps.setProjectTerminals).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledOnce();
    expect(vi.mocked(message).mock.calls[0][0]).toContain("Your tab is still here.");
    expect(vi.mocked(message).mock.calls[0][0]).toContain("This panel is not ready");
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(deps.movingSessionIds.current.size).toBe(0);
    expect(deps.skipForgetSessionIds.current.size).toBe(0);
    // The dialog is the visible feedback here; no second notice.
    expect(published).toEqual([]);
  });

  it("queues a busy conversation and says so exactly once", async () => {
    expect(await actions.onMoveTabsToNewWindow([deps.activeTabIdRef.current])).toBe("queued");
    expect(invoke).not.toHaveBeenCalled();
    expect(deps.setPendingWindowMoves).toHaveBeenCalledOnce();
    expect(published).toEqual(["This tab moves to a new window when the response finishes."]);
  });

  it("refuses unsaved files before anything leaves this window", async () => {
    const file = { id: "doc", path: "/repo/doc.md", cwd: "/repo" };
    const tab = newEditorWorkspaceTab(file);
    deps.tabsRef.current = [tab];
    deps.sessionsRef.current = [];
    deps.dirtyFilesRef.current = new Set(["doc"]);
    expect(await actions.onMoveTabsToNewWindow([tab.id])).toBe("failed");
    expect(invoke).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledOnce();
    expect(deps.setTabs).not.toHaveBeenCalled();
    expect(deps.movingTabIds.current.size).toBe(0);
    expect(published).toEqual([]);
  });

  it("refuses terminal tabs before anything leaves this window", async () => {
    const tab = newEditorWorkspaceTab({ id: "shell", path: "shell", cwd: "/repo", terminal: true });
    deps.tabsRef.current = [tab];
    deps.sessionsRef.current = [];
    expect(await actions.onMoveTabsToNewWindow([tab.id])).toBe("failed");
    expect(invoke).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledOnce();
    expect(deps.movingTabIds.current.size).toBe(0);
  });

  it("ignores a second request for a tab that is already moving", async () => {
    idle();
    const tabId = deps.activeTabIdRef.current;
    deps.movingTabIds.current.add(tabId);
    expect(await actions.onMoveTabsToNewWindow([tabId])).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });
});
