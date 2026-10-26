// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSessionModelActions } from "../useSessionModelActions";
import { prepareSubmitPreflight } from "./submitPreflight";
import { prepareSubmittedTurn } from "./submitTurnSetup";
import { startSubmittedTurn } from "./submitTurnRun";
import type { SubmitDeps, SubmitInput } from "./submitTypes";
import { newSession, type Session } from "../../../../features/sessions/model/session";
import {
  getSessions,
  resetSessionsStore,
  setSessions,
} from "../../../../features/sessions/model/sessionsStore";
import { applyHarnessEvents, stopStreaming } from "../../../../integrations/harness/core/apply";
import {
  registerHarness,
  resetHarnessIdlePark,
  type HarnessAdapter,
} from "../../../../integrations/harness/core/registry";
import type { HarnessEvent, SendTurnInput } from "../../../../integrations/harness/core/types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => false }));
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

let root: Root;
let actions: ReturnType<typeof useSessionModelActions>;
let ctx: SubmitDeps;
let events: Map<string, HarnessEvent[]>;
const sends: Array<{ harness: string; input: SendTurnInput }> = [];
const stoppedSessions: string[] = [];

function adapter(id: "codex" | "antigravity"): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(input) {
      sends.push({ harness: id, input });
      if (id === "codex") {
        // The outgoing live native thread must never receive the incoming model.
        if (input.model !== "codex:gpt-6.1-sol") throw new Error("Codex received a foreign model");
        input.onEvent({
          type: "message.delta",
          text: "Earlier SKY-7421 parser contract was edited and verified. Preserve its original attachment.",
        });
        input.onEvent({ type: "message.completed" });
      } else {
        input.onAccepted?.();
        input.onEvent({ type: "session.started" });
        input.onEvent({ type: "message.delta", text: "Continued SKY-7421 through Gemini" });
        input.onEvent({ type: "message.completed" });
        input.onEvent({ type: "session.ended", code: 0 });
      }
    },
    async cancelTurn() {},
    async stopSession(sessionId) {
      stoppedSessions.push(sessionId);
    },
    async forgetSession() {},
    respondApproval() {},
    respondQuestion() {},
    bindSession() {},
  };
}

function initialSession(): Session {
  return {
    ...newSession("codex", "/repo"),
    title: "Parser investigation",
    model: "codex:gpt-6.1-sol",
    providerSessionId: "codex-existing-thread",
    blocks: [
      {
        id: "original-user",
        role: "user",
        text: "Keep SKY-7421 and the parser contract",
        attachments: [
          {
            id: "original-file",
            name: "design.txt",
            path: "/repo/design.txt",
            mimeType: "text/plain",
            kind: "file",
            size: 12,
          },
        ],
      },
      {
        id: "original-edit",
        role: "tool",
        text: "Edit parser.ts",
        tool: {
          callId: "edit-1",
          title: "Edit parser.ts",
          kind: "edit",
          status: "completed",
        },
      },
      { id: "original-answer", role: "assistant", text: "The parser contract was verified" },
    ],
  };
}

beforeEach(async () => {
  sends.length = 0;
  stoppedSessions.length = 0;
  events = new Map();
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "handoff_history_save") return { path: "/isolated/handoff-history.json" };
    return null;
  });
  registerHarness(adapter("codex"));
  registerHarness(adapter("antigravity"));
  resetSessionsStore([initialSession()]);
  ctx = {
    refs: {
      editedResends: { isActive: () => false, finish: () => {}, start: () => {} },
      removingSessionIds: { current: new Set() },
      switchingWorktrees: { current: new Map() },
      removingWorktreePaths: { current: new Set() },
      retiringTurns: { current: new Map() },
      turnGen: { current: new Map() },
      workspacePins: { current: new Map() },
      activeSessionIdRef: { current: getSessions()[0].id },
    },
    workspaceNavigation: { isSwitching: () => false },
    dismissNoticesForContinuedSession: () => {},
    enqueueHarnessEvent: (id: string, event: HarnessEvent) =>
      events.set(id, [...(events.get(id) ?? []), event]),
    flushHarnessEvents: () => {
      setSessions((all) =>
        all.map((session) => {
          const pending = events.get(session.id) ?? [];
          events.delete(session.id);
          return applyHarnessEvents(session, pending);
        }),
      );
    },
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
  document.body.innerHTML = "";
});

async function submit(
  status = "completed",
  overrides: Partial<SubmitInput["options"]> = {},
): Promise<void> {
  const settled = vi.fn();
  const input: SubmitInput = {
    sessionId: getSessions()[0].id,
    text: "Continue our earlier work without repeating the context",
    attachments: [],
    options: { ...overrides, onSettled: settled },
  };
  const preflight = prepareSubmitPreflight(ctx, input);
  if (preflight.settled) throw new Error("Preflight rejected the request");
  const preparation = prepareSubmittedTurn(ctx, input, preflight.pre);
  if (preparation.settled) throw new Error("Turn preparation rejected the request");
  startSubmittedTurn(ctx, input, preflight.pre, preparation.setup);
  await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
  expect(settled.mock.calls[0][0]).toMatchObject({ status });
}

it("admits a managed native provider only after its accepted boundary is durable, and ends the same run", async () => {
  const original = {
    ...getSessions()[0],
    workspaceId: "managed",
    workspaceRevision: 7,
    worktreeCwd: "/owned/worktree",
  };
  resetSessionsStore([original]);
  native.invoke.mockImplementation(async (command: string, args: Record<string, any>) => {
    if (command === "session_upsert")
      return { ...args.session, createdAt: 1, updatedAt: 2, transcriptRevision: 1 };
    if (command === "managed_turn_begin") {
      expect(sends).toHaveLength(0);
      expect(args.userBlockId).not.toBe("original-user");
    }
    if (command === "managed_turn_end") {
      expect(sends).toHaveLength(1);
      expect(stoppedSessions).toContain(original.id);
    }
    return null;
  });
  await submit();
  const saved = native.invoke.mock.calls.find(([command]) => command === "session_upsert");
  expect(saved?.[1].session).toMatchObject({ workspaceId: "managed", workspaceRevision: 7 });
  const began = native.invoke.mock.calls.find(([command]) => command === "managed_turn_begin");
  expect(began?.[1]).toMatchObject({
    sessionId: original.id,
    userBlockId: expect.any(String),
    runId: expect.any(String),
  });
  expect(
    saved?.[1].session.blocks.some((block: { id: string }) => block.id === began?.[1].userBlockId),
  ).toBe(true);
  expect(native.invoke).toHaveBeenCalledWith("managed_turn_end", began?.[1]);
  expect(sends[0].input.cwd).toBe("/owned/worktree");
});

it("does not invoke a managed provider when native admission has an unknown outcome", async () => {
  resetSessionsStore([
    { ...getSessions()[0], workspaceId: "managed", worktreeCwd: "/owned/worktree" },
  ]);
  native.invoke.mockImplementation(async (command: string, args: Record<string, any>) => {
    if (command === "session_upsert")
      return { ...args.session, createdAt: 1, updatedAt: 2, transcriptRevision: 1 };
    if (command === "managed_turn_begin")
      throw new Error("Capture outcome is unknown; recover first");
    return null;
  });
  await submit("failed");
  expect(sends).toHaveLength(0);
  expect(native.invoke.mock.calls.some(([command]) => command === "managed_turn_end")).toBe(false);
});

it("refuses opaque managed edited-resend before native capture or provider rewind", async () => {
  const original = {
    ...getSessions()[0],
    workspaceId: "managed",
    worktreeCwd: "/owned/worktree",
    blocks: getSessions()[0].blocks.map((block) =>
      block.id === "original-user" ? { ...block, providerTurnId: "original-provider-turn" } : block,
    ),
  };
  resetSessionsStore([original]);
  const rejected = vi.fn();
  await submit("failed", { resendEdited: true, onResendRejected: rejected });
  expect(sends).toHaveLength(0);
  expect(native.invoke.mock.calls.some(([command]) => command === "managed_turn_begin")).toBe(
    false,
  );
  expect(rejected).toHaveBeenCalledWith({ providerRewound: false });
  expect(getSessions()[0].blocks.slice(0, 3)).toEqual(original.blocks);
});

describe("actual desktop model-picker to submit routing", () => {
  it("keeps a late Codex binding on the outgoing turn after selecting Gemini, then dispatches the correct pair", async () => {
    const original = { ...getSessions()[0], busy: true, providerSessionId: undefined };
    resetSessionsStore([original]);
    await act(async () =>
      actions.onModelChange(original.id, "antigravity", "antigravity:gemini-3.8-flash-high"),
    );
    expect(getSessions()[0].runningModelTarget?.harness).toBe("codex");
    ctx.enqueueHarnessEvent(original.id, {
      type: "session.providerBound",
      providerSessionId: "late-codex-thread",
    });
    ctx.enqueueHarnessEvent(original.id, {
      type: "session.configChanged",
      model: "codex:gpt-6.1-sol",
      modelSettings: { reasoningEffort: "high" },
    });
    ctx.flushHarnessEvents();
    const switched = getSessions()[0];
    expect(switched.harness).toBe("antigravity");
    expect(switched.model).toBe("antigravity:gemini-3.8-flash-high");
    expect(switched.providerSessionId).toBeUndefined();
    expect(switched.pendingSwitch?.fromProviderSessionId).toBe("late-codex-thread");
    expect(switched.pendingSwitch?.fromModel).toBe("codex:gpt-6.1-sol");
    // The previous turn settles through the application's normal state reducer.
    setSessions((all) =>
      all.map((session) => (session.id === original.id ? stopStreaming(session) : session)),
    );
    await submit();
    expect(sends.map(({ harness, input }) => [harness, input.model])).toEqual([
      ["codex", "codex:gpt-6.1-sol"],
      ["antigravity", "antigravity:gemini-3.8-flash-high"],
    ]);
    expect(sends[1].input.text).toContain("SKY-7421");
    expect(sends[1].input.text).toContain("/isolated/handoff-history.json");
    expect(getSessions()[0].id).toBe(original.id);
    expect(getSessions()[0].blocks.slice(0, 3)).toEqual(original.blocks);
  });
  it("uses outgoing GPT for the edit recap and incoming Gemini for the user turn in the same chat", async () => {
    const original = getSessions()[0];
    await act(async () =>
      actions.onModelChange(original.id, "antigravity", "antigravity:gemini-3.8-flash-high"),
    );
    expect(getSessions()[0].pendingSwitch?.fromModel).toBe(original.model);
    await submit();
    expect(sends.map(({ harness, input }) => [harness, input.model])).toEqual([
      ["codex", "codex:gpt-6.1-sol"],
      ["antigravity", "antigravity:gemini-3.8-flash-high"],
    ]);
    expect(sends[1].input.text).toContain("SKY-7421");
    expect(sends[1].input.text).toContain("/isolated/handoff-history.json");
    expect(native.invoke).toHaveBeenCalledWith("handoff_history_save", {
      history: expect.objectContaining({
        sessionId: original.id,
        messages: expect.arrayContaining([
          { id: "original-user", role: "user", text: original.blocks[0].text },
          { id: "original-answer", role: "assistant", text: original.blocks[2].text },
        ]),
      }),
    });
    const finished = getSessions()[0];
    expect(finished.id).toBe(original.id);
    expect(finished.blocks.slice(0, 3)).toEqual(original.blocks);
    expect(finished.harness).toBe("antigravity");
  });
  it("repairs the observed Codex/Gemini record and never asks Codex to recap with the foreign model", async () => {
    const original = { ...getSessions()[0], model: "antigravity:gemini-3.8-flash-high" };
    resetSessionsStore([original]);
    await submit();
    expect(sends.map(({ harness, input }) => [harness, input.model])).toEqual([
      ["antigravity", "antigravity:gemini-3.8-flash-high"],
    ]);
    expect(sends[0].input.text).toContain("SKY-7421");
    expect(sends[0].input.text).toContain("/isolated/handoff-history.json");
    expect(getSessions()[0].id).toBe(original.id);
    expect(getSessions()[0].blocks.slice(0, 3)).toEqual(original.blocks);
  });
});
