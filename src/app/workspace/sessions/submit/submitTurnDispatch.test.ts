// @vitest-environment happy-dom
// The real submit pipeline (preflight, setup, turn run) with a synthetic provider
// that refuses before any write. A queued row refused this way goes back to the
// head of its queue with the same id; it is a wait, never a session error.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { prepareSubmitPreflight } from "./submitPreflight";
import { prepareSubmittedTurn } from "./submitTurnSetup";
import { startSubmittedTurn } from "./submitTurnRun";
import type { SubmitDeps, SubmitInput } from "./submitTypes";
import { TurnNotReadyError } from "../../../../integrations/harness/core/types";
import { newSession, type Session } from "../../../../features/sessions/model/session";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../../features/sessions/model/sessionsStore";
import { applyHarnessEvents } from "../../../../integrations/harness/core/apply";
import {
  registerHarness,
  resetHarnessIdlePark,
  type HarnessAdapter,
} from "../../../../integrations/harness/core/registry";
import type { HarnessEvent } from "../../../../integrations/harness/core/types";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../../../features/sessions/model/models";
import {
  newProviderAccount,
  saveProviderAccount,
} from "../../../../features/providers/model/providerAccounts";
import {
  getWorkspaceCapabilities,
  workspaceRequest,
} from "../../../../features/workspaces/model/workspaceClient";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
const shared = vi.hoisted(() => ({
  wake: vi.fn((_ids?: string[]) => {}),
  requeue: vi.fn((_sessionId: string, _row: unknown) => false),
  kept: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => false }));
vi.mock("../../../../features/connections/model/sessionExecutionBinding", async (original) => ({
  ...(await original<
    typeof import("../../../../features/connections/model/sessionExecutionBinding")
  >()),
  flushHostSessionBindings: vi.fn(async () => {}),
}));
vi.mock("../../../../features/settings/model/exactGitRewind", () => ({
  getExactGitRewindEnabled: vi.fn(async () => false),
}));
vi.mock("../../../../features/workspaces/model/workspaceClient", () => {
  const getWorkspaceCapabilities = vi.fn();
  return {
    getWorkspaceCapabilities,
    // The per-send memoized lookup delegates, so each test controls the answer.
    getSendWorkspaceCapabilities: (context: unknown) => getWorkspaceCapabilities(context),
    resolveWorkspaceContext: vi.fn(async () => ({
      cwd: "/repo",
      projectId: "project",
      environmentId: "environment",
      machineId: "machine",
    })),
    requireWorkspaceCapability: vi.fn(async () => {}),
    workspaceRequest: vi.fn(),
  };
});
vi.mock("../../../../features/orchestration/model/orchestration", () => ({
  orchestrator: {
    submissionError: () => undefined,
    forSession: () => undefined,
    run: () => undefined,
    prompt: (_: string, text: string) => text,
    observe: () => {},
  },
  shellPath: (path: string) => path,
}));
vi.mock("../../../../features/sessions/model/checkpoint", () => ({
  beginSessionTurn: async () => {},
  finishSessionTurn: async () => {},
  flushSessionCheckpoint: async () => {},
  notifyReviewChanged: () => {},
}));
vi.mock("../../../../features/sessions/model/promptPreparation", () => ({
  preparePrompt: async (text: string) => text,
}));
vi.mock("../../../../features/connections/model/useSharedLocalQueues", () => ({
  markSharedProviderSend: () => {},
  wakeSharedLocalQueues: (ids?: string[]) => shared.wake(ids),
  requeueSharedLocalHead: (sessionId: string, row: unknown) => shared.requeue(sessionId, row),
  sharedLocalQueueKept: () => shared.kept,
}));
vi.mock("../../../../features/notifications/model/dockBadge", () => ({ syncDockBadge: () => {} }));
vi.mock("../../../../features/notifications/model/notifications", () => ({
  announceSessionFinished: async () => {},
}));
vi.mock("../../helpers/workspaceNotify", () => ({
  notifyFinishedWorkspace: () => {},
  nudgeOpenEditors: () => {},
  trackSessionEdits: () => {},
}));
vi.mock("../../../../integrations/harness/core/runtimeGuidance", async (original) => ({
  ...(await original<typeof import("../../../../integrations/harness/core/runtimeGuidance")>()),
  harnessRuntimeHints: async () => "",
}));

const model = "codex:gpt-6.1-sol";
const refusals = vi.hoisted(() => ({ left: 0 }));
let root: Root;
let ctx: SubmitDeps;
let events: { sessionId: string; event: HarnessEvent }[];
let original: Session;

const adapter: HarnessAdapter = {
  id: "codex",
  live: true,
  async sendTurn(input) {
    // Refused before the provider writes anything: nothing was accepted.
    if (refusals.left > 0) {
      refusals.left -= 1;
      throw new TurnNotReadyError("The original turn ended");
    }
    input.onAccepted?.();
    input.onEvent({ type: "session.started" });
    input.onEvent({ type: "message.completed" });
    input.onEvent({ type: "session.ended", code: 0 });
  },
  async cancelTurn() {},
  async stopSession() {},
  async forgetSession() {},
  respondApproval() {},
  respondQuestion() {},
  bindSession() {},
};

beforeEach(async () => {
  refusals.left = 0;
  shared.wake.mockReset();
  shared.requeue.mockReset().mockReturnValue(false);
  shared.kept = false;
  events = [];
  const account = newProviderAccount("codex", "Codex account");
  saveProviderAccount(account);
  registerHarness(adapter);
  setHarnessModels("codex", [{ id: model, harness: "codex", name: "codex", contextWindow: 4096 }]);
  vi.mocked(getWorkspaceCapabilities)
    .mockReset()
    .mockResolvedValue(["workspaces.policy.v1", "sessions.desktop-writer-retirement.v1"]);
  vi.mocked(workspaceRequest)
    .mockReset()
    .mockResolvedValue({
      revision: 1,
      resolved: { policy: { defaultMode: "current" }, appliedScopes: ["host"] },
    } as never);
  original = {
    ...newSession("codex", "/repo"),
    model,
    providerAccountId: account.id,
    workspaceMode: "current",
    blocks: [{ id: "earlier", role: "user", text: "Earlier question" }],
    queueStatus: "active",
    queuedMessages: [{ id: "row-1", text: "Queued task", attachments: [] }],
  };
  resetSessionsStore([original]);
  ctx = {
    refs: {
      editedResends: { isActive: () => false, finish: () => {}, start: () => {} },
      removingSessionIds: { current: new Set() },
      switchingWorktrees: { current: new Map() },
      removingWorktreePaths: { current: new Set() },
      retiringTurns: { current: new Map() },
      turnGen: { current: new Map() },
      workspacePins: { current: new Map() },
      activeSessionIdRef: { current: original.id },
    },
    workspaceNavigation: { isSwitching: () => false },
    dismissNoticesForContinuedSession: () => {},
    enqueueHarnessEvent: (sessionId: string, event: HarnessEvent) => {
      events.push({ sessionId, event });
    },
    flushHarnessEvents: () =>
      setSessions((all) =>
        all.map((session) => {
          const queued = events.filter((item) => item.sessionId === session.id);
          events = events.filter((item) => item.sessionId !== session.id);
          return applyHarnessEvents(
            session,
            queued.map((item) => item.event),
          );
        }),
      ),
    deferWorkspaceWork: () => {},
    setProviderAccountRecovery: () => {},
  } as unknown as SubmitDeps;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessIdlePark();
  resetHarnessModelOverlays();
  document.body.innerHTML = "";
});

/** Sends the queued row the way the dispatcher does: the same id, the row's own text. */
function sendQueuedRow() {
  const input: SubmitInput = {
    sessionId: original.id,
    text: "Queued task",
    attachments: [],
    options: { queuedMessageId: "row-1" },
  };
  const preflight = prepareSubmitPreflight(ctx, input);
  if (preflight.settled) throw new Error("Submit preflight rejected the queued row");
  const preparation = prepareSubmittedTurn(ctx, input, preflight.pre);
  if (preparation.settled) throw new Error("Submit preparation rejected the queued row");
  startSubmittedTurn(ctx, input, preflight.pre, preparation.setup);
}

it("puts a refused queued row back at the head with its id, without a session error or a held queue", async () => {
  refusals.left = 1;
  sendQueuedRow();
  await vi.waitFor(() =>
    expect(getSessions()[0].queuedMessages?.map((row) => row.id)).toEqual(["row-1"]),
  );
  expect(getSessions()[0].queuedMessages?.[0]).toMatchObject({ text: "Queued task" });
  expect(getSessions()[0].queueStatus).toBe("active");
  expect(getSessions()[0].busy).toBeFalsy();
  // The provisional user turn is removed again; the row is the only copy.
  expect(getSessions()[0].blocks.map((block) => block.text)).toEqual(["Earlier question"]);
  expect(events.map((item) => item.event.type)).not.toContain("session.error");
});

it("wakes the shared queue so a refused row reaches its head there too", async () => {
  refusals.left = 1;
  shared.kept = true;
  sendQueuedRow();
  await vi.waitFor(() => expect(shared.wake).toHaveBeenCalledWith([original.id]));
  // This window keeps a shared queue: the row returns under a new id the Host admits.
  const restored = getSessions()[0].queuedMessages?.[0];
  expect(restored).toMatchObject({ text: "Queued task" });
  expect(restored?.id).not.toBe("row-1");
  expect(events.map((item) => item.event.type)).not.toContain("session.error");
});

it("leaves the restore to the shared queue when it takes the row back", async () => {
  refusals.left = 1;
  shared.kept = true;
  shared.requeue.mockImplementation((sessionId: string, row: unknown) => {
    expect(sessionId).toBe(original.id);
    expect(row).toMatchObject({ id: "row-1", text: "Queued task" });
    return true;
  });
  sendQueuedRow();
  await vi.waitFor(() => expect(shared.requeue).toHaveBeenCalledOnce());
  expect(events.map((item) => item.event.type)).not.toContain("session.error");
  expect(shared.wake).not.toHaveBeenCalled();
});
