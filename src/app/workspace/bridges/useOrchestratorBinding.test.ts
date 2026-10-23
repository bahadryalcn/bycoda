// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { resetSessionsStore, setSessions } from "../../../features/sessions/model/sessionsStore";
import { useOrchestratorBinding, type OrchestratorBindingDeps } from "./useOrchestratorBinding";

const sync = vi.hoisted(() => vi.fn());
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { bind: vi.fn(), sync },
}));

const deps: OrchestratorBindingDeps = {
  tabs: [],
  activeTabId: "",
  setTabs: vi.fn(),
  setActiveTabId: vi.fn(),
  orchestrationRuns: [],
  setHistory: vi.fn(),
  setStoredLinkedSessions: vi.fn(),
  checkOpenWorktreeFiles: vi.fn(),
  submitSession: () => false,
  onStop: vi.fn(),
  flushHarnessEvents: vi.fn(),
};
function Harness() {
  useOrchestratorBinding(deps);
  return null;
}
afterEach(() => {
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

it("syncs initially, coalesces store updates, ignores text frames and cancels on cleanup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = {
    ...newSession("claude", "/project"),
    blocks: [{ id: "a", role: "assistant" as const, text: "Hi", streaming: true }],
  };
  resetSessionsStore([session]);
  sync.mockClear();
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () =>
      setSessions([{ ...session, blocks: [{ ...session.blocks[0], text: "Hi there" }] }]),
    );
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      setSessions([{ ...session, title: "Renamed" }]);
      setSessions([{ ...session, title: "Renamed again" }]);
    });
    expect(sync).toHaveBeenCalledTimes(2);
    await act(async () => {
      setSessions([{ ...session, title: "Queued before disposal" }]);
      root.unmount();
    });
    expect(sync).toHaveBeenCalledTimes(2);
    setSessions([session]);
    await Promise.resolve();
    expect(sync).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
