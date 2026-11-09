// @vitest-environment happy-dom
import { act, createElement, StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PreparedEditorDraftRestore } from "../../../features/files/data/editorDraftRecovery";
import {
  newEditorWorkspaceTab,
  newFileTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { insertTabBesideActive } from "../../../features/workspace/model/tabGroups";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "../../../features/workspace/model/workspaceSnapshot";
import {
  useOpenRecoveredEditorDraft,
  type OpenRecoveredEditorDraft,
  type OpenRecoveredEditorDraftDeps,
} from "./useOpenRecoveredEditorDraft";

const roots = new Set<Root>();
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear();
  vi.unstubAllGlobals();
});

function prepared(): PreparedEditorDraftRestore {
  return {
    version: 1,
    qualified: false,
    source: {
      ownerId: "c".repeat(64),
      documentId: crypto.randomUUID(),
      revision: 8,
      payloadDigest: "a".repeat(64),
    },
    target: {
      ownerEpoch: "d".repeat(64),
      documentId: crypto.randomUUID(),
      path: "/repo/dirty.ts",
      revision: 1,
      payloadDigest: "b".repeat(64),
    },
    payload: { text: "retained unsaved text", eol: "crlf", diskBaseline: "old disk text" },
  };
}

async function fixture(initial: WorkspaceTab[] = [], strict = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tabsRef = { current: initial };
  const deps: OpenRecoveredEditorDraftDeps = {
    tabsRef,
    setTabs: vi.fn((update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    }),
    insertBesideActive: vi.fn((previous, tab) => [...previous, tab]),
    activateTab: vi.fn(),
    setActiveTabId: vi.fn(),
    setProjectTerminalFocused: vi.fn(),
    setComposerFocused: vi.fn(),
    allowPath: vi.fn(() => true),
  };
  let actions!: OpenRecoveredEditorDraft;
  function Harness() {
    actions = useOpenRecoveredEditorDraft(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.add(root);
  const render = () =>
    act(async () =>
      root.render(
        strict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness),
      ),
    );
  await render();
  return { deps, tabsRef, actions, root, render };
}

it("opens a separate permanent workspace tab without replacing dirty same-path or unrelated panes", async () => {
  const dirty = newFileTab("/repo/dirty.ts", "/repo");
  dirty.preview = true;
  const origin = newEditorWorkspaceTab(dirty);
  origin.groupId = "existing-group";
  const unrelated = newEditorWorkspaceTab(newFileTab("/other/unrelated.ts", "/other"));
  const f = await fixture([origin, unrelated]);
  const copy = prepared();
  // Structural excess must not accidentally persist content inside the locator.
  Object.assign(copy.target, { text: "never serialize extra target text" });
  const before = structuredClone([origin, unrelated]);
  await act(async () => f.actions.openRecoveredEditorDraft(copy, "/repo"));
  expect(f.tabsRef.current.slice(0, 2)).toEqual(before);
  expect(f.tabsRef.current[0]).toBe(origin);
  expect(f.tabsRef.current[1]).toBe(unrelated);
  const added = f.tabsRef.current[2];
  const file = added.editorPanes[0].files[0];
  expect(file).toEqual({
    id: copy.target.documentId,
    path: copy.target.path,
    cwd: "/repo",
    recoveredEditorDraft: {
      version: 1,
      ownerEpoch: copy.target.ownerEpoch,
      documentId: copy.target.documentId,
      path: copy.target.path,
      revision: copy.target.revision,
      payloadDigest: copy.target.payloadDigest,
    },
  });
  expect(file.preview).toBeUndefined();
  expect(JSON.stringify(f.tabsRef.current)).not.toContain(copy.payload.text);
  expect(JSON.stringify(f.tabsRef.current)).not.toContain(copy.payload.diskBaseline);
  expect(JSON.stringify(f.tabsRef.current)).not.toContain("never serialize");
  expect(f.deps.insertBesideActive).toHaveBeenCalledWith([origin, unrelated], added, "/repo");
  expect(f.deps.setActiveTabId).toHaveBeenCalledWith(added.id);
  expect(f.deps.setComposerFocused).toHaveBeenCalledWith(false);
  expect(f.deps.setProjectTerminalFocused).toHaveBeenCalledWith(false);
});

it("reuses only an exact target retry and selects its actual file in an existing pane", async () => {
  const f = await fixture([], true);
  const copy = prepared();
  await act(async () => f.actions.openRecoveredEditorDraft(copy));
  const tab = f.tabsRef.current[0];
  const pane = tab.editorPanes[0];
  pane.files[0].preview = true;
  pane.files.push(newFileTab("/new-dirty.ts", "/repo"));
  pane.activeFileId = pane.files[1].id;
  await act(async () => f.actions.openRecoveredEditorDraft(copy));
  expect(f.tabsRef.current).toHaveLength(1);
  expect(f.tabsRef.current[0].editorPanes[0].activeFileId).toBe(copy.target.documentId);
  expect(f.tabsRef.current[0].editorPanes[0].files[0].preview).toBeUndefined();
  expect(f.tabsRef.current[0].editorPanes[0].files[1]).toBe(pane.files[1]);
  expect(f.deps.insertBesideActive).toHaveBeenCalledTimes(1);
  expect(f.deps.activateTab).toHaveBeenCalledWith(tab.id, pane.id);
  const second = { ...copy, target: { ...copy.target, documentId: crypto.randomUUID() } };
  await act(async () => f.actions.openRecoveredEditorDraft(second));
  expect(f.tabsRef.current).toHaveLength(2);
  expect(f.tabsRef.current[1].editorPanes[0].files[0].id).toBe(second.target.documentId);
});

it.each(["ownerEpoch", "revision", "payloadDigest"] as const)(
  "rejects reuse of a target document ID with changed %s without any partial state",
  async (field) => {
    const f = await fixture();
    const copy = prepared();
    await act(async () => f.actions.openRecoveredEditorDraft(copy));
    const before = f.tabsRef.current;
    const other = { ...copy, target: { ...copy.target } };
    if (field === "revision") other.target.revision++;
    else other.target[field] = field === "ownerEpoch" ? crypto.randomUUID() : "c".repeat(64);
    vi.mocked(f.deps.setActiveTabId).mockClear();
    await expect(f.actions.openRecoveredEditorDraft(other)).rejects.toMatchObject({
      code: "target-conflict",
    });
    expect(f.tabsRef.current).toBe(before);
    expect(f.deps.setActiveTabId).not.toHaveBeenCalled();
  },
);

it("rejects an ordinary dirty file's document ID rather than replacing it", async () => {
  const copy = prepared();
  const dirty = { ...newFileTab(copy.target.path, "/repo"), id: copy.target.documentId };
  const initial = [newEditorWorkspaceTab(dirty)];
  const f = await fixture(initial);
  await expect(f.actions.openRecoveredEditorDraft(copy)).rejects.toMatchObject({
    code: "target-conflict",
  });
  expect(f.tabsRef.current).toBe(initial);
  expect(f.deps.setTabs).not.toHaveBeenCalled();
});

it("checks actual updater state even if tabsRef has not caught up with an exact open", async () => {
  const f = await fixture();
  const copy = prepared();
  await act(async () => f.actions.openRecoveredEditorDraft(copy));
  let actual = f.tabsRef.current;
  f.tabsRef.current = [];
  f.deps.setTabs = vi.fn((update) => {
    actual = typeof update === "function" ? update(actual) : update;
  });
  await act(async () => f.actions.openRecoveredEditorDraft(copy));
  expect(actual).toHaveLength(1);
  expect(f.deps.insertBesideActive).toHaveBeenCalledTimes(1);
});

it("rechecks current path locks inside admission and retains the prepared copy on denial", async () => {
  const initial = [newEditorWorkspaceTab(newFileTab("/other.ts", "/other"))];
  const f = await fixture(initial);
  const copy = prepared();
  const saved = structuredClone(copy);
  f.deps.allowPath = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  await expect(f.actions.openRecoveredEditorDraft(copy, "/repo")).rejects.toMatchObject({
    code: "path-denied",
  });
  expect(f.tabsRef.current).toBe(initial);
  expect(copy).toEqual(saved);
  expect(f.deps.insertBesideActive).not.toHaveBeenCalled();
  expect(f.deps.setActiveTabId).not.toHaveBeenCalled();
});

it("an older callback uses updated scope policy after a project or lock change", async () => {
  const f = await fixture();
  const savedCallback = f.actions.openRecoveredEditorDraft;
  f.deps.allowPath = vi.fn(() => false);
  await f.render();
  await expect(savedCallback(prepared(), "/repo")).rejects.toMatchObject({ code: "path-denied" });
  expect(f.deps.setTabs).not.toHaveBeenCalled();
});

it("keeps all state and the copy when insertion fails, allowing an explicit opening retry", async () => {
  const initial = [newEditorWorkspaceTab(newFileTab("/existing.ts", "/repo"))];
  const f = await fixture(initial);
  const copy = prepared();
  const saved = structuredClone(copy);
  vi.mocked(f.deps.insertBesideActive).mockImplementationOnce(() => {
    throw new Error("insertion unavailable");
  });
  await expect(f.actions.openRecoveredEditorDraft(copy)).rejects.toThrow("insertion unavailable");
  expect(f.tabsRef.current).toBe(initial);
  expect(copy).toEqual(saved);
  expect(f.deps.setActiveTabId).not.toHaveBeenCalled();
  await act(async () => f.actions.openRecoveredEditorDraft(copy));
  expect(f.tabsRef.current).toHaveLength(2);
});

it("does not report success when insertion rejects without adding a tab", async () => {
  const f = await fixture();
  f.deps.insertBesideActive = (previous) => previous;
  await expect(f.actions.openRecoveredEditorDraft(prepared())).rejects.toMatchObject({
    code: "open-failed",
  });
  expect(f.tabsRef.current).toHaveLength(0);
  expect(f.deps.setActiveTabId).not.toHaveBeenCalled();
});

it("preserves project group inheritance when the insertion helper clones the new tab", async () => {
  const origin = { ...newEditorWorkspaceTab(newFileTab("/repo/a.ts", "/repo")), groupId: "group" };
  const f = await fixture([origin]);
  f.deps.insertBesideActive = (previous, tab) =>
    insertTabBesideActive(previous, tab, origin.id, () => "/repo");
  await act(async () => f.actions.openRecoveredEditorDraft(prepared(), "/repo"));
  expect(f.tabsRef.current).toHaveLength(2);
  expect(f.tabsRef.current[1].groupId).toBe("group");
  expect(f.tabsRef.current[0]).toBe(origin);
});

it("uses only the local file parent for unassigned scope and rejects callbacks after unmount", async () => {
  const f = await fixture();
  await act(async () => f.actions.openRecoveredEditorDraft(prepared()));
  expect(f.tabsRef.current[0].editorPanes[0].files[0]).toMatchObject({
    cwd: "/repo",
    external: true,
  });
  expect(vi.mocked(f.deps.insertBesideActive).mock.calls[0][2]).toBeUndefined();
  await act(async () => f.root.unmount());
  roots.delete(f.root);
  await expect(f.actions.openRecoveredEditorDraft(prepared())).rejects.toMatchObject({
    code: "unmounted",
  });
  expect(f.tabsRef.current).toHaveLength(1);
});

it.each([
  ["/repo/dirty.ts", "/repo"],
  ["/root-level.ts", "/"],
  ["C:\\fixture\\native-file.ts", "C:/fixture"],
  ["C:\\root-level.ts", "C:/"],
  ["\\\\server\\share\\folder\\file.ts", "//server/share/folder"],
  ["\\\\server\\share\\file.ts", "//server/share"],
])(
  "persists an unassigned recovery tab through workspace roundtrip for %s",
  async (path, parent) => {
    const f = await fixture();
    const copy = prepared();
    const input = { ...copy, target: { ...copy.target, path } };
    await act(async () => f.actions.openRecoveredEditorDraft(input));
    const tab = f.tabsRef.current[0];
    const file = tab.editorPanes[0].files[0];
    expect(file).toMatchObject({ id: copy.target.documentId, path, cwd: parent, external: true });
    expect(file.projectCwd).toBeUndefined();
    expect(tab.groupId).toBeUndefined();
    expect(vi.mocked(f.deps.insertBesideActive).mock.calls[0][2]).toBeUndefined();
    const snapshot = collectWorkspaceSnapshot(f.tabsRef.current, [], tab.id, "", new Map());
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain(copy.payload.text);
    expect(encoded).not.toContain(copy.payload.diskBaseline);
    const parsed = parseWorkspaceSnapshot(JSON.parse(encoded));
    expect(parsed).not.toBeNull();
    const restored = hydrateWorkspaceSnapshot(parsed!, new Map());
    expect(restored?.tabs[0]?.editorPanes[0]?.files[0]).toEqual(file);
  },
);

it("commits one permanent target with real React state and StrictMode updater replay", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const allowPath = vi.fn(() => true);
  const insert = vi.fn((previous: WorkspaceTab[], tab: WorkspaceTab) => [...previous, tab]);
  const activated = vi.fn();
  let actual: WorkspaceTab[] = [];
  let actions!: OpenRecoveredEditorDraft;
  function Harness() {
    const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
    const tabsRef = useRef(tabs);
    useLayoutEffect(() => {
      tabsRef.current = tabs;
      actual = tabs;
    }, [tabs]);
    actions = useOpenRecoveredEditorDraft({
      tabsRef,
      setTabs,
      insertBesideActive: insert,
      activateTab: activated,
      setActiveTabId: activated,
      setProjectTerminalFocused: vi.fn(),
      setComposerFocused: vi.fn(),
      allowPath,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.add(root);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
  const copy = prepared();
  await act(async () =>
    Promise.all([actions.openRecoveredEditorDraft(copy), actions.openRecoveredEditorDraft(copy)]),
  );
  expect(actual).toHaveLength(1);
  expect(actual[0].editorPanes[0].files[0].id).toBe(copy.target.documentId);
  const before = actual;
  allowPath.mockReturnValueOnce(true).mockReturnValue(false);
  await act(async () => {
    await expect(actions.openRecoveredEditorDraft(prepared())).rejects.toMatchObject({
      code: "path-denied",
    });
  });
  expect(actual).toBe(before);
});
