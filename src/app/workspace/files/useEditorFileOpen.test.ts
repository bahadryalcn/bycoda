// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  useEditorFileOpen,
  type EditorFileOpen,
  type EditorFileOpenDeps,
} from "./useEditorFileOpen";
import {
  newEditorWorkspaceTab,
  newFileTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";

const native = vi.hoisted(() => ({ directory: vi.fn(), mode: "pane" }));
vi.mock("../../../features/settings/model/settings", () => ({
  loadFileTabMode: () => native.mode,
}));
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
  native.mode = "pane";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "retains delayed pinned batch files after the latest open activates another workspace (already open: %s)",
  async (alreadyOpen) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    native.mode = "workspace";
    let resolve!: (value: boolean) => void;
    native.directory.mockImplementation((path: string) =>
      path === "/a.ts"
        ? new Promise<boolean>((yes) => {
            resolve = yes;
          })
        : Promise.resolve(false),
    );
    const old = newFileTab("/old.ts", "/repo");
    const existing = newFileTab("/a.ts", "/repo");
    existing.preview = true;
    const origin = newEditorWorkspaceTab(old);
    if (alreadyOpen) origin.editorPanes[0].files.push(existing);
    const tabs = { current: [origin] };
    const active = { current: origin.id };
    const deps: EditorFileOpenDeps = {
      activeTabId: origin.id,
      activeTabIdRef: active,
      tabsRef: tabs,
      sessionsRef: { current: [] },
      gitCwdRef: { current: "/repo" },
      sidebarCwdRef: { current: "/repo" },
      activateTab: vi.fn((id: string) => {
        active.current = id;
      }),
      insertBesideActive: (prev, tab) => [...prev, tab],
      setTabs: (update) => {
        tabs.current = typeof update === "function" ? update(tabs.current) : update;
      },
      setActiveTabId: vi.fn((id: string) => {
        active.current = id;
      }),
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
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(createElement(Harness)));
      await act(async () => {
        actions.onOpenFile("/a.ts", { line: 4 }, { pin: true });
        actions.onOpenFile("/b.ts", { line: 8 }, { pin: true });
      });
      const selected = active.current;
      await act(async () => resolve(false));
      expect(active.current).toBe(selected);
      expect(
        tabs.current.flatMap((tab) =>
          tab.editorPanes.flatMap((pane) => pane.files.map((file) => file.path)),
        ),
      ).toContain("/a.ts");
      expect(
        tabs.current
          .flatMap((tab) => tab.editorPanes.flatMap((pane) => pane.files))
          .find((file) => file.path === "/a.ts")?.preview,
      ).toBeUndefined();
      expect(tabs.current.find((tab) => tab.id === origin.id)?.editorPanes[0].activeFileId).toBe(
        old.id,
      );
      expect(deps.setEditorNavigation).toHaveBeenCalledTimes(1);
      expect(deps.setEditorNavigation).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/b.ts", line: 8 }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  },
);

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

it("ignores a delayed open after navigation to another project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (value: boolean) => void;
  native.directory.mockReturnValue(
    new Promise<boolean>((yes) => {
      resolve = yes;
    }),
  );
  const a = newEditorWorkspaceTab(newFileTab("/a/old.ts", "/a"));
  const b = newEditorWorkspaceTab(newFileTab("/b/b.ts", "/b"));
  const tabs = { current: [a, b] };
  const deps: EditorFileOpenDeps = {
    activeTabId: a.id,
    activeTabIdRef: { current: a.id },
    tabsRef: tabs,
    sessionsRef: { current: [] },
    gitCwdRef: { current: "/a" },
    sidebarCwdRef: { current: "/a" },
    activateTab: vi.fn(),
    insertBesideActive: (prev, tab) => [...prev, tab],
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
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => actions.onOpenFile("/a/delayed.ts", { line: 2 }));
    deps.activeTabIdRef.current = b.id;
    deps.sidebarCwdRef.current = "/b";
    await act(async () => resolve(false));
    expect(tabs.current).toEqual([a, b]);
    expect(deps.activateTab).not.toHaveBeenCalled();
    expect(deps.setEditorNavigation).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
