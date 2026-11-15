// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { markTurnInterrupted } from "../../../features/sessions/model/inFlight";
import { newTab } from "../../../features/workspace/model/layout";
import { collectWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import { captureSessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import { useRecoveryAutoResolve, type RecoveryAutoResolveDeps } from "./useRecoveryAutoResolve";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/sessions/data/sessionStore")>()),
  getSession: api.read,
}));

let root: Root;
let deps: RecoveryAutoResolveDeps;
let session: Session;
let finish: (saved: Session | null) => void;
let fail: (error: Error) => void;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.read.mockReset().mockImplementation(
    () =>
      new Promise<Session | null>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  session = newSession("codex", "/recovery-project");
  session.blocks = [{ id: "prompt", role: "user", text: "Work" }];
  const tab = newTab(session.id);
  deps = {
    enabled: true,
    sessionRecovery: captureSessionRecovery(
      null,
      collectWorkspaceSnapshot([tab], [session], tab.id, session.cwd, new Map()),
      100,
    ),
    sessions: [],
    remoteSessions: [],
    lockSnapshot: { lockedProjectKeys: new Set(), lockedGroupIds: new Set() },
    removeRecoveredSessions: vi.fn(async () => {}),
    setRecoveryOpen: vi.fn(),
  };
  function Probe() {
    useRecoveryAutoResolve(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  expect(api.read).toHaveBeenCalledExactlyOnceWith(session.id);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["done", "idle"])(
  "resolves asynchronously loaded %s entries with stable props",
  async (status) => {
    session.blocks = status === "done" ? [{ ...session.blocks[0], durationMs: 10 }] : [];
    await act(async () => finish(session));
    expect(deps.removeRecoveredSessions).toHaveBeenCalledExactlyOnceWith([session.id]);
    expect(deps.setRecoveryOpen).not.toHaveBeenCalled();
    expect(api.read).toHaveBeenCalledOnce();
  },
);

it("opens attention after an interrupted local read settles without any parent update", async () => {
  await act(async () => finish(markTurnInterrupted(session)));
  expect(deps.removeRecoveredSessions).not.toHaveBeenCalled();
  expect(deps.setRecoveryOpen).toHaveBeenCalledExactlyOnceWith(true);
  expect(api.read).toHaveBeenCalledOnce();
});

it.each(["missing", "error", "loading", "read-error", "unknown"])(
  "keeps an asynchronously loaded %s entry unresolved",
  async (status) => {
    await act(async () => {
      if (status === "error") fail(new Error("Read unavailable"));
      else
        finish(
          status === "missing"
            ? null
            : {
                ...session,
                ...(status === "loading" ? { historyLoading: true } : {}),
                ...(status === "read-error" ? { historyLoadError: "Read unavailable" } : {}),
              },
        );
    });
    expect(deps.removeRecoveredSessions).not.toHaveBeenCalled();
    if (status === "loading") expect(deps.setRecoveryOpen).not.toHaveBeenCalled();
    else expect(deps.setRecoveryOpen).toHaveBeenCalledExactlyOnceWith(true);
    expect(api.read).toHaveBeenCalledOnce();
  },
);
