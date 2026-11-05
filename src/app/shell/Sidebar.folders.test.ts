// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionTitle } from "../../features/sessions/model/session";
import { Sidebar } from "./Sidebar";
import {
  loadSessionFolders,
  saveSessionFolders,
} from "../../features/sessions/model/sessionFolders";

// Keep native services out of this folder persistence test.
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
vi.mock("../../features/sessions/model/sessionFolders", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../features/sessions/model/sessionFolders")>();
  return { ...actual, saveSessionFolders: vi.fn(actual.saveSessionFolders) };
});

const CWD = "/workspace/project";
const CHANGE_EVENT = "bycoda:session-folders-change";

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;
let storeWrites: string[];
let changeEvents: number;
const onChange = () => {
  changeEvents += 1;
};

function session(id: string) {
  return {
    id,
    cwd: CWD,
    harness: "codex" as const,
    model: "",
    runtimeMode: "supervised" as const,
    title: formatSessionTitle("codex", `Conversation ${id}`),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function seedFolders(folders: unknown[]) {
  localStorage.setItem("bycoda.sessionFolders", JSON.stringify({ [CWD]: folders }));
  storeWrites.length = 0;
}

const renderStrict = () =>
  act(async () => root.render(createElement(StrictMode, null, createElement(Sidebar, props))));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storeWrites = [];
  changeEvents = 0;
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === "bycoda.sessionFolders") storeWrites.push(value);
      stored.set(key, value);
    },
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  window.addEventListener(CHANGE_EVENT, onChange);
  vi.mocked(saveSessionFolders).mockClear();
  props = {
    cwd: CWD,
    open: true,
    sessions: [session("keep-1"), session("keep-2")],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "keep-1",
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
  window.removeEventListener(CHANGE_EVENT, onChange);
  container.remove();
  vi.unstubAllGlobals();
});

describe("sidebar folder retention under StrictMode with partial history", () => {
  it("retains absent session IDs without publishing a mount-time prune", async () => {
    seedFolders([{ id: "work", name: "Work", sessionIds: ["keep-1", "gone-1"], collapsed: false }]);
    await renderStrict();

    const calls = vi.mocked(saveSessionFolders).mock.calls;
    expect(calls).toHaveLength(0);
    expect(storeWrites).toHaveLength(0);
    expect(changeEvents).toBe(0);
    expect(loadSessionFolders(CWD)[0].sessionIds).toEqual(["keep-1", "gone-1"]);
    expect(container.querySelector('[data-session-folder="work"]')).not.toBeNull();
  });

  it("retains a folder whose sessions are absent from partial history", async () => {
    seedFolders([
      { id: "stale", name: "Stale", sessionIds: ["gone-1", "gone-2"], collapsed: false },
      { id: "work", name: "Work", sessionIds: ["keep-2"], collapsed: false },
    ]);
    await renderStrict();

    expect(saveSessionFolders).not.toHaveBeenCalled();
    expect(storeWrites).toHaveLength(0);
    expect(changeEvents).toBe(0);
    expect(loadSessionFolders(CWD).map((folder) => folder.id)).toEqual(["stale", "work"]);
    expect(loadSessionFolders(CWD)[0].sessionIds).toEqual(["gone-1", "gone-2"]);
    expect(container.querySelector('[data-session-folder="work"]')).not.toBeNull();
  });

  it("keeps membership without writes when a session disappears from the visible page", async () => {
    seedFolders([{ id: "work", name: "Work", sessionIds: ["keep-1", "keep-2"], collapsed: false }]);
    await renderStrict();
    expect(saveSessionFolders).not.toHaveBeenCalled();

    props = { ...props, sessions: [session("keep-1")] };
    await renderStrict();

    expect(saveSessionFolders).not.toHaveBeenCalled();
    expect(storeWrites).toHaveLength(0);
    expect(changeEvents).toBe(0);
    expect(loadSessionFolders(CWD)[0].sessionIds).toEqual(["keep-1", "keep-2"]);
  });

  it("does not write or announce when every folder session is known", async () => {
    seedFolders([{ id: "work", name: "Work", sessionIds: ["keep-1", "keep-2"], collapsed: false }]);
    await renderStrict();
    await renderStrict();

    expect(saveSessionFolders).not.toHaveBeenCalled();
    expect(storeWrites).toHaveLength(0);
    expect(changeEvents).toBe(0);
  });

  it("stays quiet after the prune settles on later renders", async () => {
    seedFolders([{ id: "work", name: "Work", sessionIds: ["keep-1", "gone-1"], collapsed: false }]);
    await renderStrict();
    const settled = vi.mocked(saveSessionFolders).mock.calls.length;
    const settledEvents = changeEvents;

    props = { ...props, activeSessionId: "keep-2" };
    await renderStrict();
    expect(saveSessionFolders).toHaveBeenCalledTimes(settled);
    expect(changeEvents).toBe(settledEvents);
  });

  it("does not prune while the session list is still pending", async () => {
    props = { ...props, pending: true, sessions: [] };
    seedFolders([{ id: "work", name: "Work", sessionIds: ["gone-1"], collapsed: false }]);
    await renderStrict();

    expect(saveSessionFolders).not.toHaveBeenCalled();
    expect(loadSessionFolders(CWD)[0].sessionIds).toEqual(["gone-1"]);
  });
});
