// @vitest-environment happy-dom
// Synthetic provider adapters exercise the real desktop picker/submit/context
// pipeline. Windows process retirement itself has separate native job tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSessionModelActions } from "../useSessionModelActions";
import { prepareSubmitPreflight } from "./submitPreflight";
import { prepareSubmittedTurn } from "./submitTurnSetup";
import { startSubmittedTurn } from "./submitTurnRun";
import type { SubmitDeps, SubmitInput } from "./submitTypes";
import {
  newSession,
  type Attachment,
  type Session,
} from "../../../../features/sessions/model/session";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../../features/sessions/model/sessionsStore";
import { isPreparingHandoff, lastHandoffBlock } from "../../../../features/sessions/model/handoff";
import type { HandoffHistory } from "../../../../features/sessions/model/handoffBudget";
import { failedTurnRetry } from "../../../../features/sessions/ui/RetryFailedTurn";
import { sanitizeSessionForPersist } from "../../../../features/sessions/data/sessionStore";
import {
  newProviderAccount,
  saveProviderAccount,
} from "../../../../features/providers/model/providerAccounts";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../../../features/sessions/model/models";
import { applyHarnessEvents } from "../../../../integrations/harness/core/apply";
import {
  registerHarness,
  resetHarnessIdlePark,
  type HarnessAdapter,
} from "../../../../integrations/harness/core/registry";
import type { HarnessEvent, SendTurnInput } from "../../../../integrations/harness/core/types";
import {
  getWorkspaceCapabilities,
  workspaceRequest,
} from "../../../../features/workspaces/model/workspaceClient";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => false }));
vi.mock("../../../../features/settings/model/exactGitRewind", () => ({
  getExactGitRewindEnabled: vi.fn(async () => false),
}));
vi.mock("../../../../features/workspaces/model/workspaceClient", () => ({
  getWorkspaceCapabilities: vi.fn(),
  resolveWorkspaceContext: vi.fn(async () => ({
    cwd: "/repo",
    projectId: "project",
    environmentId: "environment",
    machineId: "machine",
  })),
  requireWorkspaceCapability: vi.fn(async () => {}),
  workspaceRequest: vi.fn(),
}));
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

type Provider = "claude" | "codex" | "grok";
const model = {
  claude: "claude:sonnet-4.6",
  codex: "codex:gpt-6.1-sol",
  grok: "grok:grok-4.6",
} as const;
const sourceAttachment: Attachment = {
  id: "original-contract",
  name: "contract.txt",
  path: "/repo/contract.txt",
  mimeType: "text/plain",
  kind: "file",
  size: 64,
};
const currentAttachment: Attachment = {
  id: "current-evidence",
  name: "trace.txt",
  path: "/repo/trace.txt",
  mimeType: "text/plain",
  kind: "file",
  size: 96,
};
const oldestDecision = "ARCHIVE-ONLY-DECISION: keep the original signing boundary. ".repeat(600);
let root: Root;
let actions: ReturnType<typeof useSessionModelActions>;
let ctx: SubmitDeps;
let pendingEvents: Map<string, HarnessEvent[]>;
let original: Session;
let claudeAccount: string;
let codexAccount: string;
let cleanupError: Error | undefined;
const sends: Array<{ harness: Provider; recap: boolean; input: SendTurnInput }> = [];
const forgets: Provider[] = [];
const timeline: string[] = [];
const archives: HandoffHistory[] = [];

function adapter(id: Provider): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(input) {
      expect(input.model).toBe(model[id]);
      const recap = input.text.includes("Write a short recap of this conversation");
      sends.push({ harness: id, recap, input });
      if (recap) {
        // An unavailable outgoing recap uses the existing deterministic packet;
        // it must not require a second paid provider response for context safety.
        input.onEvent({ type: "message.completed" });
        return;
      }
      timeline.push(`send:${id}`);
      input.onAccepted?.();
      input.onEvent({ type: "session.started" });
      input.onEvent({ type: "session.providerBound", providerSessionId: `${id}-accepted-thread` });
      input.onEvent({
        type: "message.delta",
        text: `${id.toUpperCase()}-RESULT: preserve parser contract and signing boundary.`,
      });
      input.onEvent({ type: "message.completed" });
      input.onEvent({ type: "session.ended", code: 0 });
    },
    async cancelTurn() {},
    async stopSession() {},
    async forgetSession() {
      forgets.push(id);
      if (id === "claude" && cleanupError) {
        timeline.push("cleanup:claude:rejected");
        throw cleanupError;
      }
      timeline.push(`cleanup:${id}:verified`);
    },
    respondApproval() {},
    respondQuestion() {},
    bindSession() {},
  };
}

beforeEach(async () => {
  sends.length = 0;
  forgets.length = 0;
  timeline.length = 0;
  archives.length = 0;
  cleanupError = undefined;
  pendingEvents = new Map();
  const sourceAccount = newProviderAccount("claude", "Original Claude account");
  const targetAccount = newProviderAccount("codex", "Target Codex account");
  saveProviderAccount(sourceAccount);
  saveProviderAccount(targetAccount);
  claudeAccount = sourceAccount.id;
  codexAccount = targetAccount.id;
  for (const id of ["claude", "codex", "grok"] as const) {
    registerHarness(adapter(id));
    setHarnessModels(id, [{ id: model[id], harness: id, name: id, contextWindow: 4096 }]);
  }
  native.invoke
    .mockReset()
    .mockImplementation(async (command: string, args?: { history?: HandoffHistory }) => {
      if (command === "handoff_history_save") {
        archives.push(structuredClone(args!.history!));
        return { path: `/isolated/handoff-history-${archives.length}.json` };
      }
      return null;
    });
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
    ...newSession("claude", "/repo"),
    title: "Signing parser contract",
    model: model.claude,
    modelSettings: { effort: "high" },
    providerAccountId: claudeAccount,
    providerSessionId: "claude-original-thread",
    workspaceMode: "current",
    blocks: [
      { id: "oldest-user", role: "user", text: oldestDecision, attachments: [sourceAttachment] },
      {
        id: "oldest-answer",
        role: "assistant",
        text: "ORIGINAL-ANSWER: signing stays in the trusted boundary.",
      },
      {
        id: "recent-user",
        role: "user",
        text: "Keep CONTRACT-7421 and the parser implementation.",
      },
      {
        id: "original-edit",
        role: "tool",
        text: "Edit src/parser.ts",
        tool: { callId: "edit-1", title: "Edit src/parser.ts", kind: "edit", status: "completed" },
      },
      {
        id: "recent-answer",
        role: "assistant",
        text: "CLAUDE-RESULT: parser contract was edited and verified.",
      },
    ],
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
    enqueueHarnessEvent: (id: string, event: HarnessEvent) =>
      pendingEvents.set(id, [...(pendingEvents.get(id) ?? []), event]),
    flushHarnessEvents: () =>
      setSessions((all) =>
        all.map((session) => {
          const queued = pendingEvents.get(session.id) ?? [];
          pendingEvents.delete(session.id);
          return applyHarnessEvents(session, queued);
        }),
      ),
    deferWorkspaceWork: () => {},
    setProviderAccountRecovery: () => {},
  } as unknown as SubmitDeps;
  function CaptureActions() {
    actions = useSessionModelActions({
      isMovingPane: () => false,
      removingSessionIds: ctx.refs.removingSessionIds,
      enqueueHarnessEvent: ctx.enqueueHarnessEvent,
      flushHarnessEvents: ctx.flushHarnessEvents,
      promptProviderAccountSignIn: () => {},
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(CaptureActions)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessIdlePark();
  resetHarnessModelOverlays();
  document.body.innerHTML = "";
});

async function choose(id: Provider, accountId?: string) {
  await act(async () => actions.onModelChange(original.id, id, model[id], accountId));
}

async function submit(text: string, attachments: Attachment[], status: "completed" | "failed") {
  const settled = vi.fn();
  const input: SubmitInput = {
    sessionId: original.id,
    text,
    attachments,
    options: { onSettled: settled },
  };
  const preflight = prepareSubmitPreflight(ctx, input);
  if (preflight.settled) throw new Error("Actual submit preflight rejected the recovery");
  const preparation = prepareSubmittedTurn(ctx, input, preflight.pre);
  if (preparation.settled) throw new Error("Actual submit preparation rejected the recovery");
  startSubmittedTurn(ctx, input, preflight.pre, preparation.setup);
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  expect(settled.mock.calls[0][0]).toMatchObject({ status });
}

function assertOriginalContext() {
  const state = getSessions()[0];
  expect(state.id).toBe(original.id);
  expect(state.cwd).toBe(original.cwd);
  for (const block of original.blocks) {
    expect(state.blocks.find((retained) => retained.id === block.id)).toMatchObject(block);
  }
}

function assertFullArchive(history: HandoffHistory) {
  expect(history.sessionId).toBe(original.id);
  for (const block of original.blocks.filter((block) => block.role !== "tool")) {
    expect(history.messages).toContainEqual(
      expect.objectContaining({
        id: block.id,
        role: block.role,
        text: block.text,
      }),
    );
  }
  expect(history.messages.find((message) => message.id === "oldest-user")).toMatchObject({
    attachments: [
      expect.objectContaining({ name: sourceAttachment.name, path: sourceAttachment.path }),
    ],
  });
}

describe("provider switch context and failed retirement recovery", () => {
  it("continues Claude → Codex → Grok with one conversation, exact models/accounts and complete saved history", async () => {
    await choose("codex", codexAccount);
    const codexRequest = "CODEX-NEXT-REQUEST: continue CONTRACT-7421 using this trace.";
    await submit(codexRequest, [currentAttachment], "completed");
    const codexSend = sends.find((send) => send.harness === "codex" && !send.recap)!;
    expect(codexSend.input.providerAccountId).toBe(codexAccount);
    expect(codexSend.input.attachments).toEqual([currentAttachment]);
    expect(codexSend.input.text.split(codexRequest)).toHaveLength(2);
    expect(codexSend.input.text).toContain("handed off from Claude");
    expect(codexSend.input.text).toContain("src/parser.ts");
    expect(codexSend.input.text).toContain("/isolated/handoff-history-1.json");
    expect(codexSend.input.text).not.toContain(oldestDecision);
    expect(timeline.indexOf("cleanup:claude:verified")).toBeLessThan(
      timeline.indexOf("send:codex"),
    );
    const outgoingClaude = sends.find((send) => send.harness === "claude" && send.recap)!;
    expect(outgoingClaude.input.providerAccountId).toBe(claudeAccount);
    expect(outgoingClaude.input.modelSettings).toEqual(original.modelSettings);
    assertFullArchive(archives[0]);
    expect(archives[0].messages.some((message) => message.text === codexRequest)).toBe(false);
    assertOriginalContext();

    await choose("grok");
    expect(getSessions()[0].pendingSwitch).toMatchObject({
      from: "codex",
      fromModel: model.codex,
      fromProviderAccountId: codexAccount,
      fromProviderSessionId: "codex-accepted-thread",
    });
    const grokRequest =
      "GROK-NEXT-REQUEST: retain the exact Codex result and original signing decision.";
    await submit(grokRequest, [], "completed");
    const grokSend = sends.find((send) => send.harness === "grok" && !send.recap)!;
    expect(grokSend.input.text).toContain("handed off from Codex");
    expect(grokSend.input.text).toContain("CODEX-RESULT");
    expect(grokSend.input.text).toContain("/isolated/handoff-history-2.json");
    expect(grokSend.input.text.split(grokRequest)).toHaveLength(2);
    expect(grokSend.input.providerAccountId).toBeUndefined();
    assertFullArchive(archives[1]);
    expect(archives[1].messages).toContainEqual(
      expect.objectContaining({ role: "user", text: codexRequest }),
    );
    expect(archives[1].messages.some((message) => message.text.includes("CODEX-RESULT"))).toBe(
      true,
    );
    expect(archives[1].messages.some((message) => message.text === grokRequest)).toBe(false);
    expect(timeline.indexOf("cleanup:codex:verified")).toBeLessThan(timeline.indexOf("send:grok"));
    expect(getSessions()[0]).toMatchObject({ harness: "grok", model: model.grok, busy: false });
    expect(isPreparingHandoff(getSessions()[0])).toBe(false);
    expect(getSessions()[0].pendingSwitch).toBeUndefined();
    assertOriginalContext();
  });

  it("keeps Grok selectable after failed Claude retirement and never dispatches while that same cleanup remains unverified", async () => {
    cleanupError = new Error("Owned process job retirement unknown");
    await choose("codex", codexAccount);
    const request = "PRESERVED-REQUEST: keep these files and continue the original task.";
    await submit(request, [currentAttachment], "failed");
    let state = getSessions()[0];
    expect(sends.some((send) => send.harness === "codex")).toBe(false);
    expect(lastHandoffBlock(state.blocks)?.handoff?.status).toBe("failed");
    expect(isPreparingHandoff(state)).toBe(false);
    expect(state.pendingSwitch).toMatchObject({
      from: "claude",
      fromModel: model.claude,
      fromSettings: original.modelSettings,
      fromProviderSessionId: "claude-original-thread",
      fromProviderAccountId: claudeAccount,
    });
    expect(failedTurnRetry(state)).toMatchObject({
      text: request,
      attachments: [currentAttachment],
    });
    assertOriginalContext();

    await choose("grok");
    state = getSessions()[0];
    expect(state).toMatchObject({ harness: "grok", model: model.grok });
    expect(state.pendingSwitch?.from).toBe("claude");
    const retry = failedTurnRetry(state)!;
    await submit(retry.text, retry.attachments, "failed");
    expect(sends.some((send) => send.harness === "grok")).toBe(false);
    expect(forgets).toEqual(["claude", "claude"]);
    expect(getSessions()[0].pendingSwitch?.from).toBe("claude");
    expect(lastHandoffBlock(getSessions()[0].blocks)?.handoff?.status).toBe("failed");
    expect(isPreparingHandoff(getSessions()[0])).toBe(false);
    assertOriginalContext();
  });

  it("retains original Claude provenance through persistence and delivers the preserved request exactly once when verified cleanup later succeeds", async () => {
    cleanupError = new Error("Owned process job retirement unknown");
    await choose("codex", codexAccount);
    const request = "RECOVERED-REQUEST: resolve CONTRACT-7421 with the attached trace.";
    await submit(request, [currentAttachment], "failed");
    const failed = getSessions()[0];
    const saved = JSON.parse(JSON.stringify(sanitizeSessionForPersist(failed)));
    // Rehydrate from persisted data and fresh defaults, never from the live
    // session's in-memory pendingSwitch. The persisted divider owns provenance.
    resetSessionsStore([
      {
        ...newSession(failed.harness, failed.cwd),
        ...saved,
        pendingSwitch: undefined,
        busy: false,
      },
    ]);
    expect(lastHandoffBlock(getSessions()[0].blocks)?.handoff?.status).toBe("failed");
    await choose("grok");
    expect(getSessions()[0].pendingSwitch).toMatchObject({
      from: "claude",
      fromProviderSessionId: "claude-original-thread",
      fromProviderAccountId: claudeAccount,
    });
    const retry = failedTurnRetry(getSessions()[0])!;
    expect(retry).toMatchObject({ text: request, attachments: [currentAttachment] });
    // This fixture now reports an independently verified original cleanup. The
    // production retirement ledger must never convert its retained failure to success.
    cleanupError = undefined;
    await submit(retry.text, retry.attachments, "completed");
    const target = sends.find((send) => send.harness === "grok" && !send.recap)!;
    expect(sends.some((send) => send.harness === "codex" && !send.recap)).toBe(false);
    expect(target.input.text).toContain("handed off from Claude");
    expect(target.input.text).not.toContain("handed off from Codex");
    expect(target.input.text).toContain("src/parser.ts");
    expect(target.input.text).toContain("/isolated/handoff-history-1.json");
    expect(target.input.text.split(request)).toHaveLength(2);
    expect(target.input.attachments).toEqual([currentAttachment]);
    expect(forgets).toEqual(["claude", "claude"]);
    expect(timeline.indexOf("cleanup:claude:verified")).toBeLessThan(timeline.indexOf("send:grok"));
    assertFullArchive(archives[0]);
    expect(getSessions()[0].pendingSwitch).toBeUndefined();
    expect(isPreparingHandoff(getSessions()[0])).toBe(false);
    assertOriginalContext();
  });
});
