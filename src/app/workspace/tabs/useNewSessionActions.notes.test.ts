// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useNewSessionActions, type NewSessionActionDeps } from "./useNewSessionActions";
import { useAddNoteToChatListener } from "../control/useWorkspaceWindowEvents";
import { requestAddNoteToChat, type Note } from "../../../features/notes";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";

it("opens the chosen project with exact note context and retains the source for later quick actions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  resetSessionsStore([]);
  const tabsRef: NewSessionActionDeps["tabsRef"] = { current: [] };
  const sessionsRef = { current: getSessions() };
  const deps: NewSessionActionDeps = {
    active: undefined,
    sessionDefaults: undefined,
    projectCwd: "/current",
    sidebarCwd: "/current",
    tabsRef,
    sessionsRef,
    setSessions: (update) => {
      setSessions(update);
      sessionsRef.current = getSessions();
    },
    setTabs: (update) => {
      tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update;
    },
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setSidebarTab: vi.fn(),
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    workspaceNavigation: { cancel: vi.fn() },
    activateTab: vi.fn(),
    appendTab: (tab) => deps.setTabs((tabs) => [...tabs, tab]),
    followProject: vi.fn(),
  };
  function Harness() {
    const actions = useNewSessionActions(deps);
    useAddNoteToChatListener(actions.onAddNoteToChat);
    return null;
  }
  const note: Note = {
    id: "note",
    slug: "note",
    title: "Note",
    body: "Exact **Markdown**.",
    tags: [],
    sourceCwd: "/work/source",
    createdAt: 1,
    updatedAt: 1,
  };
  try {
    act(() => root.render(createElement(Harness)));
    act(() => requestAddNoteToChat(note, "/work/target"));
    expect(getSessions()).toHaveLength(1);
    expect(getSessions()[0]).toMatchObject({
      cwd: "/work/target",
      noteCard: { sourceCwd: "/work/source", body: note.body },
    });
    expect(getSessions()[0].noteCard).not.toHaveProperty("targetCwd");
    expect(getSessions()[0].blocks).toHaveLength(0);
    expect(getSessions()[0].busy).not.toBe(true);
    act(() => requestAddNoteToChat(note));
    expect(getSessions()[1]).toMatchObject({ cwd: "/work/source" });
    expect(note.sourceCwd).toBe("/work/source");
  } finally {
    act(() => root.unmount());
    resetSessionsStore([]);
    container.remove();
    vi.unstubAllGlobals();
  }
});
