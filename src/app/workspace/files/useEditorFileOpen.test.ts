// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useEditorFileOpen,
  type EditorFileOpen,
  type EditorFileOpenDeps,
} from "./useEditorFileOpen";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";

const native = vi.hoisted(() => ({ directory: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  isLocalDirectory: native.directory,
  openPathWithDefaultApp: vi.fn(),
}));
vi.mock("./useExternalFileDrop", () => ({ useExternalFileDrop: vi.fn() }));
vi.mock("../../../features/files/model/fileIndex", () => ({
  resolveFileOpenRequest: async (_cwd: string, path: string) => path,
  rememberOpenedFile: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("opens a validated external file without waiting for a second native inspection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // An accidental second inspection never completes, so it would prevent the tab opening.
  native.directory.mockImplementation(() => new Promise(() => {}));
  const tabs = { current: [] as WorkspaceTab[] };
  const deps: EditorFileOpenDeps = {
    activeTabId: "",
    activeTabIdRef: { current: "" },
    tabsRef: tabs,
    sessionsRef: { current: [] },
    gitCwdRef: { current: "/repo" },
    sidebarCwdRef: { current: "/repo" },
    activateTab: vi.fn(),
    insertBesideActive: (previous, tab) => [...previous, tab],
    setTabs: (update) => {
      tabs.current = typeof update === "function" ? update(tabs.current) : update;
    },
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    setProjectTerminalFocused: vi.fn(),
    setEditorNavigation: vi.fn(),
    editorNavigationToken: { current: 0 },
  };
  let actions!: EditorFileOpen;
  function Harness() {
    actions = useEditorFileOpen(deps);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () =>
      actions.onOpenFile(
        "/Downloads/report.pdf",
        undefined,
        { exact: true, pin: true },
        { cwd: "/Downloads", projectCwd: "", external: true },
      ),
    );
    expect(native.directory).not.toHaveBeenCalled();
    expect(tabs.current).toHaveLength(1);
    expect(tabs.current[0].editorPanes[0].files[0]).toMatchObject({
      path: "/Downloads/report.pdf",
      cwd: "/Downloads",
      external: true,
    });
    expect(deps.setActiveTabId).toHaveBeenCalledWith(tabs.current[0].id);
  } finally {
    await act(async () => root.unmount());
  }
});
