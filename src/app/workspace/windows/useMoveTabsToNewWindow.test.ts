// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { newSession } from "../../../features/sessions/model/session";
import { newTab } from "../../../features/workspace/model/layout";
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
