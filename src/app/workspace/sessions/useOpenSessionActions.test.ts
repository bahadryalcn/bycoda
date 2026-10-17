// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { resetSessionsStore } from "../../../features/sessions/model/sessionsStore";
import {
  clearComposerDraft,
  setComposerAttachments,
  setComposerDraft,
} from "../../../features/sessions/model/draftCache";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { normalizeSessionPreview } from "../../../features/workspace/model/sessionPreview";
import { useOpenSessionActions, type OpenSessionActionsDeps } from "./useOpenSessionActions";

let root: Root;
let container: HTMLDivElement;
let actions: ReturnType<typeof useOpenSessionActions>;
let deps: OpenSessionActionsDeps;
let sessions: Session[];
let active: string;
let currentNavigation: boolean;

function session(id: string, cwd = "/preview-project"): Session {
  return { ...newDefaultSession(cwd), id, title: id };
}

function Harness() {
  actions = useOpenSessionActions(deps);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessions = Array.from({ length: 12 }, (_, i) => session(`session-${i}`));
  resetSessionsStore(sessions);
  active = "";
  currentNavigation = true;
  const tabsRef = { current: [] as WorkspaceTab[] };
  deps = {
    sessions,
    tabsRef,
    setTabs: (update) => {
      const next = typeof update === "function" ? update(tabsRef.current) : update;
      tabsRef.current = next.map(normalizeSessionPreview);
    },
    setActiveTabId: (id) => {
      active = id;
    },
    setProjectTerminalFocused: vi.fn(),
    setComposerFocused: vi.fn(),
    setInspectedWorkerId: vi.fn(),
    followProject: vi.fn(),
    appendTab: (tab) => {
      tabsRef.current = [...tabsRef.current, tab];
    },
    insertBesideActive: (tabs, tab) => [...tabs, tab],
    ensureOpenSession: vi.fn(async (id) => sessions.find((entry) => entry.id === id) ?? null),
    focusOpenSession: (id) => {
      const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(id));
      if (!tab) return false;
      active = tab.id;
      return true;
    },
    replaceBlankPaneWithSession: vi.fn(() => false),
    linkedSessionUpdatesRef: { current: new Map() },
    revealLinkedSessionUpdate: vi.fn(),
    orchestrator: {
      forSession: () => undefined,
    } as unknown as OpenSessionActionsDeps["orchestrator"],
    workspaceNavigation: { cancel: vi.fn(), captureRequest: () => () => currentNavigation },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  for (const entry of sessions) clearComposerDraft(entry.id);
  resetSessionsStore([]);
  container.remove();
  vi.unstubAllGlobals();
});

async function preview(id: string) {
  await act(async () => {
    await actions.onPreviewHistorySession(id);
  });
}

it("browses ten sessions in one stable slot and leaves the last selected", async () => {
  for (let i = 0; i < 10; i++) await preview(sessions[i].id);
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(deps.tabsRef.current[0].previewSessionId).toBe(sessions[9].id);
  expect(deps.tabsRef.current[0].id).toBe(active);
  expect(deps.replaceBlankPaneWithSession).toHaveBeenCalledTimes(1);
});

it("keeps text and attachments immediately, even if the text is later cleared", async () => {
  await preview(sessions[0].id);
  act(() => setComposerDraft(sessions[0].id, "a draft"));
  act(() => setComposerDraft(sessions[0].id, ""));
  await preview(sessions[1].id);
  act(() => setComposerAttachments(sessions[1].id, [{ name: "file.txt" } as never]));
  await preview(sessions[2].id);
  expect(deps.tabsRef.current).toHaveLength(3);
  expect(deps.tabsRef.current.map((tab) => tab.previewSessionId)).toEqual([
    undefined,
    undefined,
    sessions[2].id,
  ]);
});

it("keeps all ten sessions when the user works in each", async () => {
  for (let i = 0; i < 10; i++) {
    await preview(sessions[i].id);
    act(() => setComposerDraft(sessions[i].id, "work"));
  }
  expect(deps.tabsRef.current).toHaveLength(10);
  expect(deps.tabsRef.current.every((tab) => !tab.previewSessionId)).toBe(true);
});

it("focuses existing tabs without duplicates and supports explicit keep-open", async () => {
  await preview(sessions[0].id);
  await act(async () => {
    await actions.onPreviewHistorySession(sessions[0].id, { keepOpen: true });
  });
  await preview(sessions[1].id);
  await preview(sessions[0].id);
  expect(deps.tabsRef.current).toHaveLength(2);
  expect(deps.tabsRef.current[0].previewSessionId).toBeUndefined();
  expect(active).toBe(deps.tabsRef.current[0].id);
});

it("does not replace another project's preview or a busy session", async () => {
  sessions[1].cwd = "/other-project";
  sessions[2].busy = true;
  await preview(sessions[0].id);
  await preview(sessions[1].id);
  await preview(sessions[2].id);
  await preview(sessions[3].id);
  expect(deps.tabsRef.current).toHaveLength(3);
  expect(
    deps.tabsRef.current.some(
      (tab) => leafIds(tab.layout).includes(sessions[2].id) && !tab.previewSessionId,
    ),
  ).toBe(true);
});

it("ignores slow earlier opens and navigation superseded by a project change", async () => {
  let resolve!: (value: Session) => void;
  deps.ensureOpenSession = vi.fn((id: string) =>
    id === sessions[0].id
      ? new Promise<Session>((yes) => {
          resolve = yes;
        })
      : Promise.resolve(sessions[1]),
  );
  act(() => root.render(createElement(Harness)));
  let pending!: Promise<void>;
  act(() => {
    pending = actions.onPreviewHistorySession(sessions[0].id);
  });
  await preview(sessions[1].id);
  await act(async () => {
    resolve(sessions[0]);
    await pending;
  });
  expect(deps.tabsRef.current).toHaveLength(1);
  expect(deps.tabsRef.current[0].previewSessionId).toBe(sessions[1].id);
  act(() => {
    pending = actions.onPreviewHistorySession(sessions[0].id);
  });
  currentNavigation = false;
  await act(async () => {
    resolve(sessions[0]);
    await pending;
  });
  expect(deps.tabsRef.current[0].previewSessionId).toBe(sessions[1].id);
});

it("opens side-by-side sessions as a kept composition", async () => {
  await preview(sessions[0].id);
  await act(async () => {
    await actions.onOpenSessionsSideBySide([sessions[0].id, sessions[1].id]);
  });
  const tab = deps.tabsRef.current.find((entry) => entry.id === active)!;
  expect(leafIds(tab.layout)).toEqual(expect.arrayContaining([sessions[0].id, sessions[1].id]));
  expect(tab.previewSessionId).toBeUndefined();
});

it("preserves existing kept tabs", async () => {
  const kept = newTab(sessions[0].id);
  deps.tabsRef.current = [kept];
  await preview(sessions[1].id);
  await preview(sessions[2].id);
  expect(deps.tabsRef.current[0]).toBe(kept);
  expect(deps.tabsRef.current).toHaveLength(2);
});

it("keeps a preview when its workspace gains an editor", async () => {
  await preview(sessions[0].id);
  act(() =>
    deps.setTabs((tabs) =>
      tabs.map((tab) => ({
        ...tab,
        editorPanes: [
          {
            id: "editor",
            activeFileId: "file",
            files: [{ id: "file", path: "a.ts", cwd: sessions[0].cwd }],
          },
        ],
      })),
    ),
  );
  await preview(sessions[1].id);
  expect(deps.tabsRef.current).toHaveLength(2);
  expect(deps.tabsRef.current[0].editorPanes[0].files[0].path).toBe("a.ts");
  expect(deps.tabsRef.current[0].previewSessionId).toBeUndefined();
});
