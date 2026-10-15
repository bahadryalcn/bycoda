import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  newFileTab,
  newPlanTab,
  newTab,
  openEditorTab,
  type WorkspaceTab,
} from "../../workspace/model/layout";
import { newSession, type Session } from "./session";
import {
  removeSessionFromWorkspace,
  type SessionWorkspaceRemoval,
} from "./sessionWorkspaceLifecycle";

function session(id: string, cwd = "/projects/bycoda"): Session {
  return { ...newSession("cursor", cwd), id };
}

function tab(id: string, sessionId: string): WorkspaceTab {
  return { ...newTab(sessionId), id };
}

function remove(input: {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sessionId: string;
  activeTabId: string;
  scope?: "project" | "workspace";
}): SessionWorkspaceRemoval {
  return removeSessionFromWorkspace({
    ...input,
    scope: input.scope ?? "workspace",
    createReplacement: (seed) => session("replacement", seed?.cwd),
  });
}

describe("removeSessionFromWorkspace", () => {
  it("closes the sole-session tab with its files instead of promoting them", () => {
    const file = newFileTab("/projects/bycoda/README.md", "/projects/bycoda");
    const closing = {
      ...tab("closing", "s1"),
      layout: {
        type: "split" as const,
        id: "split",
        dir: "right" as const,
        children: [leaf("s1"), leaf("editor")],
        sizes: [0.5, 0.5],
      },
      focusedId: "s1",
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    };
    const result = remove({
      tabs: [closing, tab("other", "s2")],
      sessions: [session("s1"), session("s2", "/projects/ruler")],
      sessionId: "s1",
      activeTabId: "closing",
    });

    expect(result.closedTabs.map((entry) => entry.id)).toEqual(["closing"]);
    expect(result.tabs.map((entry) => entry.id)).toEqual(["other"]);
    expect(result.sessions.map((entry) => entry.id)).toEqual(["s2"]);
    expect(result.activeTabId).toBe("other");
  });

  it("retains file panes and another conversation in a shared workspace", () => {
    const file = newFileTab("/projects/bycoda/README.md", "/projects/bycoda");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split" as const,
        id: "outer",
        dir: "right" as const,
        children: [
          leaf("s1"),
          {
            type: "split",
            id: "inner",
            dir: "down",
            children: [leaf("s2"), leaf("editor")],
            sizes: [0.5, 0.5],
          },
        ],
        sizes: [0.5, 0.5],
      },
      focusedId: "s1",
      editorPanes: [{ id: "editor", files: [file], activeFileId: file.id }],
    };
    const result = remove({
      tabs: [shared],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });

    expect(result.closedTabs).toEqual([]);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]?.editorPanes).toEqual(shared.editorPanes);
    expect(result.tabs[0]?.layout).toEqual({
      type: "split",
      id: "inner",
      dir: "down",
      children: [leaf("s2"), leaf("editor")],
      sizes: [0.5, 0.5],
    });
    expect(result.sessions.map((entry) => entry.id)).toEqual(["s2"]);
  });

  it("closes session-scoped changes with the session while preserving other files", () => {
    const sessionChanges = {
      id: "changes",
      path: "/projects/bycoda",
      cwd: "/projects/bycoda",
      review: true,
      sessionChanges: { sessionId: "s1" },
    };
    const readme = newFileTab("/projects/bycoda/README.md", "/projects/bycoda");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split" as const,
        id: "split",
        dir: "right" as const,
        children: [leaf("s1"), leaf("s2"), leaf("editor")],
        sizes: [1 / 3, 1 / 3, 1 / 3],
      },
      focusedId: "s1",
      editorPanes: [
        {
          id: "editor",
          files: [sessionChanges, readme],
          activeFileId: sessionChanges.id,
        },
      ],
    };
    const result = remove({
      tabs: [shared],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });

    expect(result.tabs[0]?.editorPanes[0]?.files).toEqual([readme]);
    expect(result.tabs[0]?.editorPanes[0]?.activeFileId).toBe(readme.id);
  });

  it("replaces the final project tab with a blank session", () => {
    const result = remove({
      tabs: [tab("only", "s1")],
      sessions: [session("s1")],
      sessionId: "s1",
      activeTabId: "only",
      scope: "project",
    });

    expect(result.closedTabs.map((entry) => entry.id)).toEqual(["only"]);
    expect(result.tabs[0]?.id).toBe("only");
    expect(result.tabs[0]?.focusedId).toBe("replacement");
    expect(result.sessions.map((entry) => entry.id)).toEqual(["replacement"]);
  });

  it("does not leave the project when closing its final tab in project scope", () => {
    const result = remove({
      tabs: [tab("ruler", "r1"), tab("bycoda", "s1")],
      sessions: [session("r1", "/projects/ruler"), session("s1")],
      sessionId: "s1",
      activeTabId: "bycoda",
      scope: "project",
    });

    expect(result.tabs.map((entry) => entry.id)).toEqual(["ruler", "bycoda"]);
    expect(result.activeTabId).toBe("bycoda");
    expect(result.tabs[1]?.focusedId).toBe("replacement");
  });
  it("removes only the archived session's plans in a shared workspace", () => {
    const own = newPlanTab("s1", "p1", "Own plan", "/projects/bycoda");
    const other = newPlanTab("s2", "p2", "Other plan", "/projects/bycoda");
    const readme = newFileTab("/projects/bycoda/README.md", "/projects/bycoda");
    const shared: WorkspaceTab = {
      ...tab("shared", "s1"),
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        children: [leaf("s1"), leaf("s2")],
        sizes: [0.5, 0.5],
      },
    };
    const withFiles = [own, other, readme].reduce(
      (tab, file) => openEditorTab(tab, file, { pin: true }),
      shared,
    );
    const result = remove({
      tabs: [withFiles],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "shared",
    });
    expect(result.tabs[0].editorPanes[0].files).toEqual([other, readme]);
    expect(leafIds(result.tabs[0].layout)).not.toContain("s1");
  });

  it("removes plan panes even after their conversation moved to another tab", () => {
    const plan = newPlanTab("s1", "p1", "Plan", "/projects/bycoda");
    const other = openEditorTab(tab("other", "s2"), plan);
    const result = remove({
      tabs: [tab("own", "s1"), other],
      sessions: [session("s1"), session("s2")],
      sessionId: "s1",
      activeTabId: "other",
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].editorPanes).toEqual([]);
    expect(result.tabs[0].focusedId).toBe("s2");
    expect(result.tabs[0].layout).toEqual(leaf("s2"));
  });

  it("replaces a standalone plan pane without leaving a dangling layout leaf", () => {
    const plan = newPlanTab("s1", "p1", "Plan", "/projects/bycoda");
    const only: WorkspaceTab = {
      ...tab("only", "editor"),
      editorPanes: [{ id: "editor", files: [plan], activeFileId: plan.id }],
    };
    const result = remove({
      tabs: [only],
      sessions: [session("s1")],
      sessionId: "s1",
      activeTabId: "only",
    });
    expect(result.tabs[0].editorPanes).toEqual([]);
    expect(result.tabs[0].layout).toEqual(leaf("replacement"));
    expect(result.sessions.map((s) => s.id)).toEqual(["replacement"]);
  });
});

describe("removeSessionFromWorkspace across worktrees", () => {
  const sessions = [
    session("main"),
    { ...session("a1"), worktreeCwd: "/trees/a" },
    { ...session("a2"), worktreeCwd: "/trees/a" },
  ];
  const tabs = [tab("t-a1", "a1"), tab("t-main", "main"), tab("t-a2", "a2")];
  const worktreeOf = (entry: WorkspaceTab) =>
    sessions.find((item) => leafIds(entry.layout).includes(item.id))?.worktreeCwd ??
    "/projects/bycoda";

  it("moves to a tab of the same worktree instead of the nearest one", () => {
    const result = removeSessionFromWorkspace({
      tabs,
      sessions,
      sessionId: "a2",
      activeTabId: "t-a2",
      scope: "project",
      worktreeOf,
      createReplacement: (seed) => session("replacement", seed?.cwd),
    });
    expect(result.activeTabId).toBe("t-a1");
  });

  it("keeps the last tab of a worktree with a blank session", () => {
    const result = removeSessionFromWorkspace({
      tabs: [tab("t-main", "main"), tab("t-a1", "a1")],
      sessions,
      sessionId: "a1",
      activeTabId: "t-a1",
      scope: "project",
      worktreeOf,
      createReplacement: (seed) => session("replacement", seed?.cwd),
    });
    expect(result.activeTabId).toBe("t-a1");
    expect(result.tabs.map((entry) => entry.id)).toEqual(["t-main", "t-a1"]);
  });
});
