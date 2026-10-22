// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useNewSessionActions, type NewSessionActionDeps } from "./useNewSessionActions";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import { clearComposerDraft, setComposerDraft } from "../../../features/sessions/model/draftCache";
import {
  rememberRemoteSession,
  remoteSessionFor,
} from "../../../features/connections/model/connections";
import { normalizeSessionPreview } from "../../../features/workspace/model/sessionPreview";

it("reuses remote previews while protecting drafts, explicit keep-open and existing sessions", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  resetSessionsStore([]);
  let actions!: ReturnType<typeof useNewSessionActions>;
  const tabsRef: NewSessionActionDeps["tabsRef"] = { current: [] };
  const sessionsRef = { current: getSessions() };
  const deps: NewSessionActionDeps = {
    active: undefined,
    sessionDefaults: undefined,
    projectCwd: "remote://fixture/project",
    sidebarCwd: "remote://fixture/project",
    tabsRef,
    sessionsRef,
    setSessions: (update) => {
      setSessions(update);
      sessionsRef.current = getSessions();
    },
    setTabs: (update) => {
      tabsRef.current = (typeof update === "function" ? update(tabsRef.current) : update).map(
        normalizeSessionPreview,
      );
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
    actions = useNewSessionActions(deps);
    return null;
  }
  try {
    act(() => root.render(createElement(Harness)));
    for (let index = 0; index < 10; index++) {
      act(() =>
        actions.onSelectRemoteSession(deps.projectCwd, `remote-${index}`, { preview: true }),
      );
    }
    expect(tabsRef.current).toHaveLength(1);
    const draftedId = tabsRef.current[0].focusedId;
    expect(remoteSessionFor(draftedId)).toBe("remote-9");
    setComposerDraft(draftedId, "Unsent remote work");
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-next", { preview: true }));
    expect(tabsRef.current).toHaveLength(2);
    expect(tabsRef.current[0].previewSessionId).toBeUndefined();
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-next"));
    expect(tabsRef.current[1].previewSessionId).toBeUndefined();
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-final", { preview: true }));
    expect(tabsRef.current).toHaveLength(3);
    act(() => actions.onSelectRemoteSession(deps.projectCwd, "remote-9", { preview: true }));
    expect(tabsRef.current).toHaveLength(3);
    expect(deps.activateTab).toHaveBeenLastCalledWith(tabsRef.current[0].id, draftedId);
  } finally {
    act(() => root.unmount());
    for (const session of getSessions()) {
      clearComposerDraft(session.id);
      rememberRemoteSession(session.id, undefined);
    }
    resetSessionsStore([]);
    container.remove();
    vi.unstubAllGlobals();
  }
});
