// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  listen: vi.fn(),
  handle: vi.fn(async () => ({ accepted: true })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "workspace-9" }),
}));
vi.mock("../../../features/agent-app/model/agentApp", () => ({ handleAgentApp: vi.fn() }));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({ lock: null }),
}));
vi.mock("../../../features/sessions/model/localSessionNavigation", () => ({
  localReferenceForSession: vi.fn(),
}));
vi.mock("../../../features/group-lock/model/lockState", () => ({ isProjectLockedIn: () => false }));
vi.mock("../../../features/notes", () => ({ NOTES_CHANGED_EVENT: "notes", upsertNote: vi.fn() }));
vi.mock("../../../features/orchestration/model/orchestration", () => ({
  orchestrator: { handle: mocks.handle, run: () => null },
}));
vi.mock("../../../features/projects/model/recents", () => ({ sameProjectPath: () => true }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  getSession: vi.fn(),
  listSessionsByProject: vi.fn(),
}));
vi.mock("../../../features/sessions/model/session", () => ({
  sessionDraftBlock: () => null,
  sessionWorkCwd: (session: { cwd: string }) => session.cwd,
}));
vi.mock("./useHistorySourceRegistration", () => ({ useHistorySourceRegistration: () => {} }));
vi.mock("../../../features/sessions/model/sessionsStore", () => ({ sessionsRef: { current: [] } }));
vi.mock("../../../features/source-control/model/worktrees", () => ({
  createWorktree: vi.fn(),
  listWorktrees: vi.fn(),
}));

import { useAppControlRequests } from "./useAppControlRequests";

function Probe() {
  const noop = useRef(vi.fn());
  useAppControlRequests({
    launchQuickSessionRef: noop as never,
    submitSessionRef: noop as never,
    ensureOpenSessionRef: noop as never,
    saveDraftRef: noop as never,
  });
  return null;
}

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("listens for control requests on this window only and replies once per request", async () => {
  let deliver!: (payload: unknown) => void;
  const release = vi.fn();
  mocks.listen.mockImplementation(
    async (_name: string, callback: (event: { payload: unknown }) => void) => {
      deliver = (payload) => callback({ payload });
      return release;
    },
  );
  await act(async () => root.render(createElement(Probe)));
  // Rust emits the request to the window holding the grant; a process-wide
  // listener handled it (and replied) once per open window.
  expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(
    "bycoda-control-request",
    expect.any(Function),
    { target: "workspace-9" },
  );
  await act(async () => {
    deliver({
      id: "grant-1",
      namespace: "control",
      sessionId: "session-1",
      requestId: "request-1",
      action: "status",
      input: { verbose: true },
    });
  });
  expect(mocks.handle).toHaveBeenCalledExactlyOnceWith("session-1", "request-1", "status", {
    verbose: true,
  });
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("control_reply", {
    id: "grant-1",
    response: { ok: true, result: { accepted: true } },
  });
  await act(async () => root.unmount());
  expect(release).toHaveBeenCalledOnce();
  root = createRoot(container);
});

it("releases a registration that resolves only after the workspace unmounted", async () => {
  let resolve!: (release: () => void) => void;
  const release = vi.fn();
  mocks.listen.mockReturnValue(new Promise<() => void>((done) => (resolve = done)));
  await act(async () => root.render(createElement(Probe)));
  await act(async () => root.unmount());
  resolve(release);
  await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
  root = createRoot(container);
});
