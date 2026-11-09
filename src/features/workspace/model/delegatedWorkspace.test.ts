// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot } from "./workspaceSnapshot";
import { leafIds, newTab } from "./layout";
import { remoteSessionFor } from "../../connections/model/connections";

describe.each(["advisor", "subagent"])("%s workspace visibility", (kind) => {
  const parent = () => ({ ...newSession("codex", "/repo"), id: "parent" });
  const child = () => ({
    ...newSession("codex", "/repo"),
    id: "child",
    modelSettings: {
      delegationParent: JSON.stringify({
        parentSessionId: "parent",
        runId: "run",
        kind,
        model: "codex:m",
        startedAt: 1,
      }),
    },
  });

  it("does not persist a child's normal tab or session stub", () => {
    const root = parent(),
      run = child();
    const snapshot = collectWorkspaceSnapshot(
      [newTab(root.id), newTab(run.id)],
      [root, run],
      run.id,
      "/repo",
      new Map(),
    );
    expect(snapshot.tabs.flatMap((tab) => leafIds(tab.layout))).toEqual([root.id]);
    expect(snapshot.sessions.map((session) => session.id)).toEqual([root.id]);
    expect(snapshot.activeTabId).toBe(snapshot.tabs[0].id);
    expect(run.modelSettings.delegationParent).toBeTruthy();
  });

  it("drops a legacy child tab even when only the loaded record has its lineage", () => {
    const root = parent(),
      run = child();
    const snapshot = collectWorkspaceSnapshot(
      [newTab(root.id), newTab(run.id)],
      [root, { ...run, modelSettings: {} }],
      root.id,
      "/repo",
      new Map(),
    );
    const restored = hydrateWorkspaceSnapshot(
      snapshot,
      new Map([
        [root.id, root],
        [run.id, run],
      ]),
      new Set([run.id]),
    );
    expect(restored?.tabs.flatMap((tab) => leafIds(tab.layout))).toEqual([root.id]);
    expect(restored?.sessions.map((session) => session.id)).toEqual([root.id]);
  });

  it("keeps the sibling session pane when removing a saved child pane", () => {
    const root = parent(),
      run = child();
    const tab = {
      ...newTab(run.id),
      layout: { type: "leaf" as const, id: run.id, tabIds: [run.id, root.id] },
    };
    const snapshot = collectWorkspaceSnapshot([tab], [root, run], tab.id, "/repo", new Map());
    expect(snapshot.tabs[0].id).toBe(tab.id);
    expect(leafIds(snapshot.tabs[0].layout)).toEqual([root.id]);
  });

  it("does not claim the canonical remote id for a rejected legacy child shell", () => {
    const root = parent();
    const run = { ...child(), id: `legacy-${kind}`, cwd: "remote://visibility/repo" };
    const snapshot = collectWorkspaceSnapshot(
      [newTab(root.id), newTab(run.id)],
      [root, { ...run, modelSettings: {} }],
      root.id,
      "/repo",
      new Map(),
    );
    snapshot.sessions.find((entry) => entry.id === run.id)!.remoteSessionId = `canonical-${kind}`;
    hydrateWorkspaceSnapshot(
      snapshot,
      new Map([
        [root.id, root],
        [run.id, run],
      ]),
    );
    expect(remoteSessionFor(run.id)).toBeUndefined();
  });
});
