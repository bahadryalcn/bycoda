// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../features/sessions/model/sessionsStore";
import { useQuickSessionLaunch, type QuickSessionLaunchDeps } from "./useQuickSessionLaunch";

it("publishes one quick session before submitting and preserves the accepted turn", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([]);
  const submitSession = vi.fn((id: string, text: string) => {
    expect(getSessions().filter((session) => session.id === id)).toHaveLength(1);
    setSessions((sessions) =>
      sessions.map((session) =>
        session.id === id
          ? { ...session, blocks: [{ id: "turn", role: "user" as const, text }] }
          : session,
      ),
    );
    return true;
  });
  const deps: QuickSessionLaunchDeps = {
    appendTab: vi.fn(),
    submitSession,
    onSaveDraft: vi.fn(() => true),
    tabsRef: { current: [] },
    setTabs: vi.fn(),
    setActiveTabId: vi.fn(),
    setComposerFocused: vi.fn(),
    setSearchViewOpen: vi.fn(),
    setInboxViewOpen: vi.fn(),
    setNotesViewOpen: vi.fn(),
    setAutomationsViewOpen: vi.fn(),
    setSidebarTab: vi.fn(),
    setProjectCwd: vi.fn(),
    setRecents: vi.fn(),
  };
  let launch!: ReturnType<typeof useQuickSessionLaunch>["launchQuickSession"];
  function Harness() {
    launch = useQuickSessionLaunch(deps).launchQuickSession;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      await launch({ cwd: "/repo", harness: "codex", prompt: "hello", reveal: false }, "delivery");
    });
    expect(submitSession).toHaveBeenCalledOnce();
    expect(deps.appendTab).toHaveBeenCalledOnce();
    expect(getSessions()).toHaveLength(1);
    expect(getSessions()[0]).toMatchObject({
      id: "delivery",
      quickLaunchAccepted: true,
      blocks: [{ id: "turn", text: "hello" }],
    });
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});
