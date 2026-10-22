import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  newTab,
  newEditorWorkspaceTab,
  newFileTab,
  newTerminalFile,
  type WorkspaceTab,
} from "../../features/workspace/model/layout";
import { createProjectTerminal } from "../../features/projects/model/projectTerminal";
import type { Attachment, Session } from "../../features/sessions/model/session";
import {
  collectWindowTransfer,
  mergeWindowTransfer,
  parseWindowTransfer,
  removeWindowTransfer,
  restoreTransferredDrafts,
} from "./windowTransfer";
import {
  composerDraftOf,
  clearComposerDraft,
  setComposerDraft,
  setComposerAttachments,
  setComposerMcpTags,
} from "../../features/sessions/model/draftCache";

function session(id: string, cwd: string): Session {
  return {
    id,
    cwd,
    harness: "cursor",
    title: "",
    blocks: [],
    busy: false,
    model: "",
    modelSettings: {},
    runtimeMode: "default",
  };
}

describe("transferred window focus recovery", () => {
  const payload = (tab: WorkspaceTab) => ({
    tabs: [tab],
    sessions: [session("moving", "/repo")],
    activeTabId: tab.id,
    projectCwd: "/repo",
    dirtyFileIds: [],
  });

  it("repairs stale focus before sending without mutating the source", () => {
    const tab = { ...newTab("moving"), focusedId: "closed-pane" };
    const incoming = collectWindowTransfer(
      [tab],
      [session("moving", "/repo")],
      [tab.id],
      tab.id,
      new Set(),
      "/repo",
    )!;
    expect(incoming.tabs[0].focusedId).toBe("moving");
    expect(tab.focusedId).toBe("closed-pane");
    expect(parseWindowTransfer(JSON.stringify(incoming)).sessions).toEqual(incoming.sessions);
  });

  it("recovers stale focus from an older sender and keeps the full conversation", () => {
    const tab = { ...newTab("moving"), focusedId: "closed-pane" };
    const incoming = parseWindowTransfer(JSON.stringify(payload(tab)));
    expect(incoming.tabs[0].focusedId).toBe("moving");
    expect(incoming.sessions).toEqual(payload(tab).sessions);
  });

  it("selects a valid focused member of a pane tab group", () => {
    const tab = {
      ...newTab("moving"),
      focusedId: "other",
      layout: { type: "leaf" as const, id: "moving", tabIds: ["moving", "other"] },
    };
    const incoming = parseWindowTransfer(
      JSON.stringify({
        ...payload(tab),
        sessions: [session("moving", "/repo"), session("other", "/repo")],
      }),
    );
    expect(incoming.tabs[0].layout.id).toBe("other");
    expect(incoming.tabs[0].focusedId).toBe("other");
  });

  it("still rejects malformed focus and missing content", () => {
    expect(() =>
      parseWindowTransfer(
        JSON.stringify(payload({ ...newTab("moving"), focusedId: 42 } as unknown as WorkspaceTab)),
      ),
    ).toThrow("Invalid transferred focus");
    expect(() =>
      parseWindowTransfer(
        JSON.stringify({ ...payload({ ...newTab("moving"), focusedId: "closed" }), sessions: [] }),
      ),
    ).toThrow("no content");
  });
});

describe("cross-window title strip placement", () => {
  it.each(["before", "after"] as const)(
    "inserts incoming tabs %s the previewed title target",
    (position) => {
      const left = newTab("left");
      const right = newTab("right");
      const moved = newTab("moved");
      const incoming = {
        tabs: [moved],
        sessions: [session("moved", "/repo")],
        activeTabId: moved.id,
        projectCwd: "/repo",
        dirtyFileIds: [],
      };
      const merged = mergeWindowTransfer(
        [left, right],
        [session("left", "/repo"), session("right", "/repo")],
        [],
        incoming,
        null,
        { targetTabId: right.id, position },
      );
      expect(merged.tabs.map((tab) => tab.id)).toEqual(
        position === "before" ? [left.id, moved.id, right.id] : [left.id, right.id, moved.id],
      );
      expect(merged.activeTabId).toBe(moved.id);
      expect(merged.tabs.find((tab) => tab.id === moved.id)?.layout).toEqual(moved.layout);
    },
  );
});

describe("cross-window individual editor file placement", () => {
  it("docks a conversation onto an editor strip as a panel instead of using the file insertion slot", () => {
    const target = newEditorWorkspaceTab(newFileTab("/p/target.ts", "/p"));
    const moving = newTab("conversation");
    const incoming = collectWindowTransfer(
      [moving],
      [session("conversation", "/p")],
      [moving.id],
      moving.id,
      new Set(),
      "/p",
    )!;
    const merged = mergeWindowTransfer([target], [], [], incoming, {
      id: target.focusedId,
      edge: "center",
      targetFileId: target.editorPanes[0].files[0].id,
      tabPosition: "before",
    });
    expect(leafIds(merged.tabs[0].layout)).toEqual([target.focusedId, "conversation"]);
    expect(merged.tabs[0].editorPanes[0].files).toEqual(target.editorPanes[0].files);
  });
  it.each(["before", "after"] as const)(
    "moves a saved file %s the exact destination file and restores its active file on rollback",
    (tabPosition) => {
      const first = newFileTab("/p/first.ts", "/p");
      const targetFile = newFileTab("/p/target.ts", "/p");
      const target = newEditorWorkspaceTab(first);
      target.editorPanes[0].files.push(targetFile);
      const movedFile = newFileTab("/p/moved.ts", "/p");
      const moving = newEditorWorkspaceTab(movedFile);
      const incoming = collectWindowTransfer(
        [moving],
        [],
        [moving.id],
        moving.id,
        new Set(),
        "/p",
      )!;
      const merged = mergeWindowTransfer([target], [], [], incoming, {
        id: target.editorPanes[0].id,
        edge: "center",
        targetFileId: targetFile.id,
        tabPosition,
      });
      expect(merged.tabs).toHaveLength(1);
      expect(merged.tabs[0].layout).toEqual(target.layout);
      expect(merged.tabs[0].focusedId).toBe(target.editorPanes[0].id);
      expect(merged.tabs[0].editorPanes[0].files.map((file) => file.id)).toEqual(
        tabPosition === "before"
          ? [first.id, movedFile.id, targetFile.id]
          : [first.id, targetFile.id, movedFile.id],
      );
      expect(merged.tabs[0].editorPanes[0].activeFileId).toBe(movedFile.id);

      const unrelated = newFileTab("/p/new-destination-edit.ts", "/p");
      const edited = {
        ...merged.tabs[0],
        editorPanes: [
          {
            ...merged.tabs[0].editorPanes[0],
            files: [...merged.tabs[0].editorPanes[0].files, unrelated],
          },
        ],
      };
      const rolledBack = removeWindowTransfer([edited], incoming, {
        before: [target],
        accepted: merged.tabs,
      });
      expect(rolledBack[0].editorPanes[0].files).toEqual([first, targetFile, unrelated]);
      expect(rolledBack[0].editorPanes[0].activeFileId).toBe(first.id);
      expect(rolledBack[0].layout).toEqual(target.layout);
    },
  );

  it("preserves a destination file selection made after the accepted placement", () => {
    const target = newEditorWorkspaceTab(newFileTab("/p/original.ts", "/p"));
    const moving = newEditorWorkspaceTab(newFileTab("/p/moving.ts", "/p"));
    const incoming = collectWindowTransfer([moving], [], [moving.id], moving.id, new Set(), "/p")!;
    const merged = mergeWindowTransfer([target], [], [], incoming, {
      id: target.focusedId,
      edge: "center",
    });
    const newer = newFileTab("/p/newer.ts", "/p");
    const edited = {
      ...merged.tabs[0],
      editorPanes: [
        {
          ...merged.tabs[0].editorPanes[0],
          files: [...merged.tabs[0].editorPanes[0].files, newer],
          activeFileId: newer.id,
        },
      ],
    };
    const rolledBack = removeWindowTransfer([edited], incoming, {
      before: [target],
      accepted: merged.tabs,
    });
    expect(rolledBack[0].editorPanes[0].activeFileId).toBe(newer.id);
    expect(rolledBack[0].editorPanes[0].files.map((file) => file.id)).toEqual([
      target.editorPanes[0].files[0].id,
      newer.id,
    ]);
  });

  it("rejects a duplicate file identity under a new pane and workspace tab", () => {
    const file = newFileTab("/p/shared.ts", "/p");
    const target = newEditorWorkspaceTab(file);
    const moving = newEditorWorkspaceTab(file);
    const incoming = collectWindowTransfer([moving], [], [moving.id], moving.id, new Set(), "/p")!;
    expect(() =>
      mergeWindowTransfer([target], [], [], incoming, { id: target.focusedId, edge: "center" }),
    ).toThrow("editor tab is already open");
  });
});

describe("collectWindowTransfer", () => {
  it("preserves destination native scale metadata and rejects invalid monitor scaling", () => {
    const tab = newTab("scaling");
    const payload = collectWindowTransfer(
      [tab],
      [session("scaling", "/p")],
      [tab.id],
      tab.id,
      new Set(),
      "/p",
    )!;
    const dropPoint = { x: 200, y: 150, scaleFactor: 2 };
    expect(parseWindowTransfer(JSON.stringify({ ...payload, dropPoint })).dropPoint).toEqual(
      dropPoint,
    );
    for (const scaleFactor of [0, -1, null])
      expect(() =>
        parseWindowTransfer(
          JSON.stringify({ ...payload, dropPoint: { ...dropPoint, scaleFactor } }),
        ),
      ).toThrow("coordinates");
  });
  it("validates transferred content before a destination can acknowledge it", () => {
    const moving = newTab("moving");
    const payload = collectWindowTransfer(
      [moving],
      [session("moving", "/p")],
      [moving.id],
      moving.id,
      new Set(),
      "/p",
    )!;
    expect(parseWindowTransfer(JSON.stringify(payload))).toEqual(payload);
    const optionalTerminals = { ...moving, terminalPanes: undefined };
    expect(
      parseWindowTransfer(JSON.stringify({ ...payload, tabs: [optionalTerminals] })).tabs[0].id,
    ).toBe(moving.id);
    expect(() => parseWindowTransfer(JSON.stringify({ ...payload, sessions: [] }))).toThrow(
      "no content",
    );
    expect(() =>
      parseWindowTransfer(JSON.stringify({ ...payload, activeTabId: "missing" })),
    ).toThrow("active tab");
    expect(() =>
      parseWindowTransfer(JSON.stringify({ ...payload, tabs: [moving, moving] })),
    ).toThrow("transferred tab");
    expect(() =>
      parseWindowTransfer(JSON.stringify({ ...payload, dropPoint: { x: null, y: 1 } })),
    ).toThrow("coordinates");
  });

  it("restores the destination ratios and selected group tab after a rejected move", () => {
    const original = {
      ...newTab("right"),
      layout: {
        type: "split" as const,
        id: "split",
        dir: "right" as const,
        children: [
          leaf("left"),
          { type: "leaf" as const, id: "right", tabIds: ["hidden", "right"] },
        ],
        sizes: [0.25, 0.75],
      },
    };
    const moving = newTab("moving");
    const incoming = collectWindowTransfer(
      [moving],
      [session("moving", "/p")],
      [moving.id],
      moving.id,
      new Set(),
      "/p",
    )!;
    const merged = mergeWindowTransfer(
      [original],
      [session("left", "/p"), session("hidden", "/p"), session("right", "/p")],
      [],
      incoming,
      { id: "right", edge: "right" },
    );
    const renamed = { ...merged.tabs[0], groupId: "destination edit" };
    const rolledBack = removeWindowTransfer([renamed], incoming, {
      before: [original],
      accepted: merged.tabs,
    });
    expect(rolledBack[0].layout).toEqual(original.layout);
    expect(rolledBack[0].focusedId).toBe("right");
    expect(rolledBack[0].groupId).toBe("destination edit");

    const grouped = mergeWindowTransfer([original], [], [], incoming, {
      id: "right",
      edge: "center",
      tabPosition: "before",
    });
    expect(
      removeWindowTransfer(grouped.tabs, incoming, {
        before: [original],
        accepted: grouped.tabs,
      })[0].layout,
    ).toEqual(original.layout);
  });

  it.each(["before", "after"] as const)(
    "inserts into the exact pane group position %s a hidden tab",
    (tabPosition) => {
      const original = {
        ...newTab("right"),
        layout: { type: "leaf" as const, id: "right", tabIds: ["left", "right"] },
      };
      const moving = newTab("moving");
      const incoming = collectWindowTransfer(
        [moving],
        [session("moving", "/p")],
        [moving.id],
        moving.id,
        new Set(),
        "/p",
      )!;
      const merged = mergeWindowTransfer([original], [], [], incoming, {
        id: "left",
        edge: "center",
        tabPosition,
      });
      expect(merged.tabs[0].layout).toEqual({
        type: "leaf",
        id: "moving",
        tabIds:
          tabPosition === "before" ? ["moving", "left", "right"] : ["left", "moving", "right"],
      });
    },
  );
  it.each(["left", "right", "top", "bottom", "center"] as const)(
    "keeps moved multi-tab order and focus at the %s target",
    (edge) => {
      const existing = newTab("existing");
      const first = newTab("first");
      const second = newTab("second");
      const incoming = collectWindowTransfer(
        [first, second],
        [session("first", "/p"), session("second", "/p")],
        [first.id, second.id],
        first.id,
        new Set(),
        "/p",
      )!;
      const merged = mergeWindowTransfer([existing], [session("existing", "/p")], [], incoming, {
        id: "existing",
        edge,
        tabPosition: edge === "center" ? "after" : undefined,
      });
      expect(leafIds(merged.tabs[0].layout)).toEqual(
        edge === "left" || edge === "top"
          ? ["first", "second", "existing"]
          : ["existing", "first", "second"],
      );
      expect(merged.tabs[0].focusedId).toBe("first");
    },
  );
  it.each(["right", "center"] as const)(
    "docks into a destination pane at %s and rolls back safely",
    (edge) => {
      const existing = newTab("existing");
      const moving = newTab("moving");
      const incoming = collectWindowTransfer(
        [moving],
        [session("moving", "/p")],
        [moving.id],
        moving.id,
        new Set(),
        "/p",
      )!;
      const merged = mergeWindowTransfer([existing], [session("existing", "/p")], [], incoming, {
        id: "existing",
        edge,
      });
      expect(merged.tabs).toHaveLength(1);
      expect(merged.activeTabId).toBe(existing.id);
      expect(merged.tabs[0].focusedId).toBe("moving");
      const editedDestination = {
        ...merged.tabs[0],
        groupLabel: "preserve destination edit",
      };
      const rolledBack = removeWindowTransfer([editedDestination], incoming);
      expect(rolledBack).toHaveLength(1);
      expect(rolledBack[0].layout).toEqual(existing.layout);
      expect(rolledBack[0].groupLabel).toBe("preserve destination edit");
      expect(rolledBack[0].focusedId).toBe("existing");
    },
  );

  it("keeps incoming tabs when the drop target has disappeared", () => {
    const existing = newTab("existing");
    const moving = newTab("moving");
    const incoming = collectWindowTransfer(
      [moving],
      [session("moving", "/p")],
      [moving.id],
      moving.id,
      new Set(),
      "/p",
    )!;
    const merged = mergeWindowTransfer([existing], [], [], incoming, {
      id: "closed-pane",
      edge: "right",
    });
    expect(merged.tabs).toEqual([existing, moving]);
    expect(merged.activeTabId).toBe(moving.id);
  });

  it("reattaches a tab while retaining the destination's tabs and drafts", () => {
    const existing = newTab("existing");
    const moved = newTab("moved");
    const payload = collectWindowTransfer(
      [moved],
      [session("moved", "/p")],
      [moved.id],
      moved.id,
      new Set(),
      "/p",
    )!;
    const merged = mergeWindowTransfer([existing], [session("existing", "/p")], [], payload);
    expect(merged.tabs).toEqual([existing, moved]);
    expect(merged.sessions.map((s) => s.id)).toEqual(["existing", "moved"]);
    expect(() => mergeWindowTransfer(merged.tabs, merged.sessions, [], payload)).toThrow(
      "already open",
    );
  });

  it("rejects a duplicate conversation under a different tab ID", () => {
    const incoming = newTab("shared");
    const existing = newTab("shared");
    const payload = collectWindowTransfer(
      [incoming],
      [session("shared", "/p")],
      [incoming.id],
      incoming.id,
      new Set(),
      "/p",
    )!;
    expect(() => mergeWindowTransfer([existing], [], [], payload)).toThrow("already open");
  });
  it("moves the latest unsent text and leaves unrelated drafts alone", () => {
    setComposerDraft("moving", "message not sent yet");
    setComposerDraft("staying", "keep here");
    const tab = { ...newTab("moving"), id: "moving-tab" };
    const payload = collectWindowTransfer(
      [tab],
      [session("moving", "/p"), session("staying", "/p")],
      [tab.id],
      tab.id,
      new Set(),
      "/p",
    )!;
    expect(Object.keys(payload.composerDrafts!)).toEqual(["moving"]);
    clearComposerDraft("moving");
    restoreTransferredDrafts(payload);
    expect(composerDraftOf("moving").text).toBe("message not sent yet");
    expect(composerDraftOf("staying").text).toBe("keep here");
    clearComposerDraft("moving");
    clearComposerDraft("staying");
  });
  it("preserves attachments, tags, provider identity, queue and model through a round trip", () => {
    const moving: Session = {
      ...session("full-state", "/p"),
      model: "chosen-model",
      providerAccountId: "account",
      providerSessionId: "provider-thread",
      queuedMessages: [
        {
          id: "queued",
          text: "later",
          attachments: [],
          modelTarget: {
            harness: "cursor",
            model: "queued-model",
            modelSettings: {},
            providerAccountId: "queue-account",
          },
        },
      ],
    };
    setComposerDraft(moving.id, "unsent");
    const attachment: Attachment = {
      id: "attachment",
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file",
      size: 5,
      data: "aGVsbG8=",
    };
    setComposerAttachments(moving.id, [attachment]);
    setComposerMcpTags(moving.id, [
      {
        server: {
          name: "tool",
          provider: "cursor",
          scope: "project",
          configPath: "/p/mcp.json",
          transport: "stdio",
        },
        token: "@mcp/tool",
      },
    ]);
    const tab = newTab(moving.id);
    const payload = parseWindowTransfer(
      JSON.stringify(collectWindowTransfer([tab], [moving], [tab.id], tab.id, new Set(), "/p")),
    );
    clearComposerDraft(moving.id);
    restoreTransferredDrafts(payload);
    expect(payload.sessions[0]).toEqual(moving);
    expect(composerDraftOf(moving.id)).toEqual(payload.composerDrafts![moving.id]);
    clearComposerDraft(moving.id);
  });
  it("collects tabs, sessions, and dirty files for a group", () => {
    const s1 = session("s1", "/Users/me/agent-terminal");
    const s2 = session("s2", "/Users/me/agent-terminal");
    const tabs: WorkspaceTab[] = [
      { ...newTab("s1"), id: "t1" },
      { ...newTab("s2"), id: "t2" },
      { ...newTab("s1"), id: "t3", layout: leaf("s9") },
    ];
    const payload = collectWindowTransfer(tabs, [s1, s2], ["t1", "t2"], "t2", new Set(), "~");
    expect(payload).toMatchObject({
      activeTabId: "t2",
      projectCwd: "/Users/me/agent-terminal",
    });
    expect(payload?.tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    expect(payload?.sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(payload?.projectTerminals).toBeUndefined();
  });

  it("carries a project terminal dock into the new window", () => {
    const s1 = session("s1", "/Users/me/agent-terminal");
    const tabs: WorkspaceTab[] = [{ ...newTab("s1"), id: "t1" }];
    const dock = createProjectTerminal(
      "/Users/me/agent-terminal",
      newTerminalFile("/Users/me/agent-terminal"),
    );
    const payload = collectWindowTransfer(tabs, [s1], ["t1"], "t1", new Set(), "~", [dock]);
    expect(payload?.projectTerminals).toEqual([dock]);
  });
});
