import { resumeCodexThread } from "./codexThreadRecovery";
import {
  queueProviderOperation,
  retireProviderEpoch,
  assertProviderOperation,
  observeProviderProcess,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  processTarget,
  operationContext,
  type HarnessOperationContext,
  captureRpcTurnWriter,
  rpcTurnWriter,
  type JsonRpcWriterView,
} from "../turnWriter";

import { killChild } from "../../core/child";
import {
  createProviderRetirementLedger,
  preserveProviderFailure,
} from "../../core/providerRetirement";
import {
  createApprovalOccurrenceId,
  isApprovalOccurrenceId,
} from "../../../../shared/model/approvalOccurrence";
import {
  captureNativeOutputWorkEvent,
  runNativeOutputWork,
  nativeOutputSink,
  captureNativeOutputEvent,
  captureNativeOutputWork,
  trackNativeOutputWork,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import { continueAfterFailure } from "../../../../shared/lib/promiseQueue";
import {
  deliverQuestionReply,
  QuestionReplyValidationError,
  type QuestionDelivery,
} from "../questionDelivery";
import { TurnLatch } from "../../../../shared/lib/turnLatch";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { t } from "../../../../shared/i18n/core";
import { PRODUCT_IDENTITY } from "../../../../shared/lib/productIdentity";
import { sameProviderAccountId } from "../../../../features/providers/model/providerAccounts";
import {
  exhaustedWindowResetAt,
  parseCodexRateLimits,
} from "../../../../features/providers/model/rateLimits";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import {
  questionPromptTitle,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";
import { resolveCodexBinary, spawnChild, watchChild } from "../../core/child";
import { additionalDirsFor } from "../../core/additionalDirs";
import { forgetSessionCommands, reportSessionCommands } from "../../core/reportedCommands";
import { skillDisabled, skillPathKey } from "../../core/skillPolicy";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  buildTurnSteerParams,
  codexMode,
  codexSkillsFromList,
  codexSkillStatesFromList,
  mapApprovalRequest,
  codexSubagentStates,
  codexSubagentThreadIds,
  mapCodexNotification,
  mapCodexSubagentSteps,
  stringField,
  toCodexApprovalDecision,
  type CodexApprovalKind,
  type CodexCommandOutputState,
  type CodexTurnUsageState,
} from "./codexProtocol";
import { JsonRpcClient, JsonRpcResponseError, type JsonRpcId } from "../../core/jsonRpc";
import {
  deleteHarnessGeneratedImages as deleteGeneratedImages,
  saveHarnessGeneratedImage as saveGeneratedImage,
} from "../../core/generatedImages";
import {
  codexAsyncQuestions,
  codexAsyncQuestionResponse,
  codexQuestions,
  codexQuestionResponse,
} from "./codexQuestions";
import {
  codexMcpConfirmation,
  codexMcpForm,
  codexMcpFormResponse,
  type CodexMcpForm,
} from "./codexElicitation";
import { parseCodexGoalCommand, codexGoalRequest, codexGoalSummary } from "./codexGoal";
import { trackAgentRow } from "./codexAgentRows";
import { codexThreadConfig } from "./codexSubagentLimits";
import { snapshotRemainder } from "../../core/streamText";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

type ApprovalOutcome = ApprovalDecision | "cancelled";

type PendingApproval = {
  occurrenceId: string;
  rpcId: JsonRpcId;
  threadId: string;
  kind: CodexApprovalKind;
  resolve: (decision: ApprovalOutcome) => void;
};

type PendingQuestion = QuestionDelivery & {
  /** Async agentMessage questions have no pending server request. */
  rpcId: JsonRpcId | null;
  threadId: string;
  turnId?: string;
  sending?: boolean;
  event: Extract<HarnessEvent, { type: "question.asked" }>;
  isBlocking: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (reply: UserQuestionReply | "cancelled") => void;
};

import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const operationTailsBySession = new Map<string, Promise<unknown>>();

const retirements = createProviderRetirementLedger("codex.main", killChild);

type Live = {
  operation?: object;
  handle: ChildProcessHandle;
  sessionId: string;
  rpc: JsonRpcClient;
  threadId: string;
  model?: string;
  cwd: string;
  providerAccountId?: string;
  /** Thread-level network policy used when this app-server opened the thread. */
  controlsAgents: boolean;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<number, PendingQuestion>;
  visibleQuestionId: number | null;
  nextApprovalUiId: number;
  cancelled: boolean;
  muteUpdates: boolean;
  activeTurnId: string | null;
  /** The parent ended while its children still own this run. */
  parentCompleted: boolean;
  pendingParentErrors: HarnessEvent[];
  backgroundKey: string;
  completedParentTurns: Set<string>;
  turnInput: SendTurnInput | null;
  childTurns: Map<string, string>;
  terminalChildren: Set<string>;
  completedChildTurns: Set<string>;
  childOutcomes: Map<string, string>;
  agentTitles: Map<string, string>;
  /** A successful provider turn ended, but its async questions still need replies. */
  awaitingAsyncAnswers: boolean;
  asyncAnswerTexts: string[];
  queuedAsyncAnswers: Map<number, { pending: PendingQuestion; reply: UserQuestionReply }>;
  turnUsage: CodexTurnUsageState;
  /** Running command output by item id; see `CodexCommandOutputState`. */
  commandOutput: CodexCommandOutputState;
  /** A written turn/start still needs its response/notification turn identity. */
  pendingTurnStart: boolean;
  turns: Promise<void>;
  /** Resolves when the current turn completes (or is cancelled). */
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  /** turn/completed arrived before runTurn registered turnDone. */
  turnEndPending: boolean;
  /** Completed snapshots describe one item, not all text in the turn. */
  emittedAssistantByItem: Map<string, string>;
  emittedReasoningByItem: Map<string, string>;
  emittedGeneratedImages: Set<string>;
  emittedAsyncQuestions: Set<string>;
  turnGeneration: number;
  notificationQueue: Promise<void> | null;
  /** Child thread id -> the agent tool row that spawned it. */
  subagentThreads: Map<string, string>;
  /** Child notifications that arrived before their row was known. */
  pendingSubagent: Map<
    string,
    Array<{ method: string; params: unknown; work: NativeOutputWork | null }>
  >;
  /** Agent rows still running, by call id, with the name to settle them under. */
  openAgentRows: Map<string, string>;
  /** Latest rate-limit windows by limit id, merged from sparse updates. */
  rateLimits: Map<string, Record<string, unknown>>;
  /** The active turn failed on a spent usage limit. */
  usageLimited: boolean;
  /** Skill name to SKILL.md path, so a `$name` can be sent as a skill input. */
  skills: Map<string, string>;
  skillPolicyKey?: string;
  skillPolicy?: HarnessSessionInput["skillPolicy"];
  skillsLoading?: Promise<void>;
};

function trackNotificationQueue(live: Live, queued: Promise<void>): void {
  live.notificationQueue = queued;
  void queued.then(() => {
    if (live.notificationQueue === queued) live.notificationQueue = null;
  });
}

type Resume = {
  threadId: string;
  cwd: string;
  providerAccountId?: string;
};

const liveByThread = new Map<string, Live>();
const startingByThread = new Map<
  string,
  { handle: ChildProcessHandle; operation?: object; rpc?: JsonRpcClient }
>();
const resumeByThread = new Map<string, Resume>();
const cancellationEpoch = new Map<string, number>();

let resolveCodexBinaryImpl: () => Promise<{ path: string }> = resolveCodexBinary;

/** Test seam. */
export function setCodexBinaryResolver(fn: () => Promise<{ path: string }>): void {
  resolveCodexBinaryImpl = fn;
}

export async function sendCodexTurn(input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;

  try {
    const original = liveByThread.get(input.sessionId) ?? startingByThread.get(input.sessionId);
    if (original) observeProviderProcess(input, original.handle);
    return await queueProviderOperation(
      operationTailsBySession,
      input.sessionId,
      input.operationContext,
      async () => {
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;
        let live: Live;
        try {
          live = await ensureLive(input);
        } catch (error) {
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;
          throw error;
        }
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;

        observeProviderProcess(input, live.handle);
        const bindWriter = captureRpcTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        );
        live.turns = continueAfterFailure(live.turns, async () => {
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;
          const rpc = await bindWriter();
          live.onEvent = input.onEvent;
          live.runtimeMode = input.runtimeMode;
          live.planning = input.intent === "plan";
          live.cancelled = false;
          live.muteUpdates = false;
          try {
            const goal = parseCodexGoalCommand(input.text);
            if (goal) {
              const request = codexGoalRequest(goal, live.threadId);
              const response = await rpc.request(request.method, request.params);
              if (live.cancelled || live.muteUpdates) return;
              if (goal.action === "set") {
                await runTurn(live, { ...input, text: goal.objective }, rpc);
              } else if (goal.action === "resume") {
                await runTurn(
                  live,
                  {
                    ...input,
                    text: "Continue working toward the active goal.",
                  },
                  rpc,
                );
              } else {
                input.onAccepted?.();
                live.onEvent({
                  type: "message.delta",
                  text:
                    goal.action === "clear" ? "Codex goal cleared." : codexGoalSummary(response),
                });
                live.onEvent({ type: "message.completed" });
              }
              return;
            }
            await runTurn(live, input, rpc);
          } catch (error) {
            if (live.cancelled) return;
            // Rejected/completed turns leave a reusable app-server. A transport
            // timeout has unknown acceptance state, so recycle it to isolate late events.
            if (error instanceof Error && /timed out/i.test(error.message)) {
              return preserveProviderFailure(error, stopCodexSession(input.sessionId, live.handle));
            }
            throw error;
          }
        });
        await live.turns;
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function compactCodexContext(input: CompactContextInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;

  try {
    const original = liveByThread.get(input.sessionId) ?? startingByThread.get(input.sessionId);
    if (original) observeProviderProcess(input, original.handle);
    return await queueProviderOperation(
      operationTailsBySession,
      input.sessionId,
      input.operationContext,
      async () => {
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;
        const live = await ensureLive(input);
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;

        observeProviderProcess(input, live.handle);
        const bindWriter = captureRpcTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        );
        live.turns = continueAfterFailure(live.turns, async () => {
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return;
          const rpc = await bindWriter();
          live.onEvent = input.onEvent;
          live.cancelled = false;
          live.muteUpdates = false;
          try {
            await runCompaction(live, rpc);
          } catch (error) {
            if (live.cancelled) return;
            throw error;
          }
        });
        await live.turns;
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function rewindCodexLastTurn(
  input: RewindLastTurnInput,
): Promise<RewindLastTurnResult> {
  assertProviderOperation(input.operationContext);

  input = { ...input };
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;

  try {
    const original = liveByThread.get(input.sessionId) ?? startingByThread.get(input.sessionId);
    if (original) observeProviderProcess(input, original.handle);
    return await queueProviderOperation(
      operationTailsBySession,
      input.sessionId,
      input.operationContext,
      async () => {
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return { submitted: false };
        const live = await ensureLive(input);
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return { submitted: false };

        observeProviderProcess(input, live.handle);
        const bindWriter = captureRpcTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        );
        await live.turns;
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch) return { submitted: false };
        if (live.activeTurnId) {
          throw new Error("Stop the current turn before editing the last message");
        }

        const rpc = await bindWriter();
        live.onEvent = input.onEvent;
        const beforeTurnId = await lastUserTurnId(live, input.providerTurnId, rpc);
        await rpc.request("thread/revert", {
          threadId: live.threadId,
          beforeTurnId,
        });
        return { submitted: false };
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

async function lastUserTurnId(
  live: Live,
  providerTurnId: string | undefined,
  rpc: JsonRpcWriterView,
): Promise<string> {
  const exact = providerTurnId?.trim();
  if (exact) return exact;

  const page = await rpc.request<{ data?: unknown[] }>("thread/turns/list", {
    threadId: live.threadId,
    limit: 100,
    sortDirection: "desc",
    itemsView: "summary",
  });
  const turns = Array.isArray(page.data) ? page.data : [];
  const userTurn = turns.find((candidate) => {
    const turn = asRecord(candidate);
    return (
      Array.isArray(turn?.items) &&
      turn.items.some((item) => stringField(asRecord(item), "type") === "userMessage")
    );
  });
  const latest = asRecord(userTurn);
  const turnId = stringField(latest, "id");
  if (!turnId) throw new Error("Codex did not expose a user turn id to edit");
  return turnId;
}

export async function steerCodexTurn(input: SteerTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  const live = liveByThread.get(input.sessionId);
  if (!live) throw new Error("No active Codex session");
  if (!ownsOperation(input.operationContext, live.handle, live.operation))
    throw new Error("Provider operation replaced before steer");
  const turnId = live.activeTurnId;
  const originalLatch = live.turnDone;
  const continueParent =
    !turnId &&
    live.parentCompleted &&
    !live.awaitingAsyncAnswers &&
    live.turnDone &&
    live.openAgentRows.size > 0;
  if (!turnId && !continueParent)
    throw new Error("The previous turn has finished. Send this follow-up as a new message.");

  const rpc = await rpcTurnWriter(
    live.handle,
    live.rpc,
    input.nativeControlTurn,
    input.operationContext,
  );
  if (/(?:^|\s)\$[A-Za-z0-9]/.test(input.text)) await loadCodexSkills(live, input.sessionId, rpc);
  if (live.cancelled) throw new Error("Follow-up cancelled because the turn was stopped");
  if (
    live.turnDone !== originalLatch ||
    !originalLatch ||
    (continueParent
      ? !live.parentCompleted || !!live.activeTurnId || live.pendingTurnStart
      : live.activeTurnId !== turnId)
  )
    throw new Error(
      "The previous turn changed before this follow-up was sent. Send it as a new message.",
    );

  if (continueParent) {
    const previous = live.turnInput;
    if (!previous) throw new Error("No original Codex turn for this follow-up");
    await startParentTurn(
      live,
      {
        ...previous,
        ...input,
        onEvent: previous.onEvent,
        runtimeInstructions: undefined,
        onAccepted: undefined,
      },
      rpc,
    );
    return;
  }

  const params = buildTurnSteerParams({
    threadId: live.threadId,
    expectedTurnId: turnId!,
    prompt: input.text.trim() || undefined,
    attachments: input.attachments,
    skills: live.skills,
  });
  if (!params.input || (Array.isArray(params.input) && params.input.length === 0)) {
    return;
  }

  await rpc.requestWithNativeOutput("turn/steer", params, (result, work) => {
    nativeOutputSink(work, () => live.onEvent({ type: "turn.started", providerTurnId: turnId! }))();
    return result;
  });
}

export function respondCodexApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  approvalOccurrenceId?: string,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (
    !live ||
    live.cancelled ||
    live.muteUpdates ||
    !pending ||
    !isApprovalOccurrenceId(approvalOccurrenceId) ||
    pending.occurrenceId !== approvalOccurrenceId
  )
    return;
  pending.resolve(decision);
}

export function respondCodexQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): boolean {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!live || !pending) return false;
  // Already being delivered: the first answer stands.
  if (pending.sending) return true;
  if (pending.rpcId !== null) {
    deliverQuestionReply(
      pending,
      requestId,
      reply,
      live.onEvent,
      () => live.questions.get(requestId) === pending && !live.cancelled && !live.muteUpdates,
      () => pending.resolve(reply),
    );
    return true;
  }
  if (reply.kind === "skipped") {
    pending.resolve(reply);
    return true;
  }
  const text = codexAsyncQuestionResponse(pending.event.questions, reply);
  if (!text) {
    pending.resolve({ kind: "skipped" });
    return true;
  }
  if (live.awaitingAsyncAnswers) {
    // The provider turn has ended, so turn/steer would target a stale turn.
    // Collect explicit answers and continue under the same host run once all
    // queued questions have been answered or skipped.
    pending.sending = true;
    live.asyncAnswerTexts.push(text);
    live.queuedAsyncAnswers.set(requestId, { pending, reply });
    live.onEvent({ type: "question.updated", requestId, delivery: "queued" });
    showNextQuestion(live);
    settleAsyncAnswers(live);
    return true;
  }
  const turnId = pending.turnId;
  if (!turnId || live.activeTurnId !== turnId) {
    pending.resolve("cancelled");
    return true;
  }
  pending.sending = true;
  live.onEvent({ type: "question.updated", requestId, delivery: "sending" });
  keepCodexQuestionOpen(sessionId, requestId);
  void live.rpc
    .request(
      "turn/steer",
      buildTurnSteerParams({
        threadId: pending.threadId,
        expectedTurnId: turnId,
        prompt: text,
      }),
    )
    .then(() => {
      if (live.questions.get(requestId) === pending) pending.resolve(reply);
    })
    .catch((error: unknown) => {
      if (live.questions.get(requestId) !== pending) return;
      const rejected =
        error instanceof JsonRpcResponseError && [-32600, -32601, -32602].includes(error.code ?? 0);
      // Only a definitive rejection permits another answer.
      if (rejected) pending.sending = false;
      live.onEvent({
        type: "question.updated",
        requestId,
        delivery: rejected ? "failed" : "unknown",
        error: rejected
          ? "The provider rejected this answer. You can edit it and try again."
          : "Answer delivery could not be confirmed. Check the connection before continuing.",
      });
    });
  return true;
}

export function keepCodexQuestionOpen(sessionId: string, requestId: number): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!live || !pending || pending.timer === undefined) return;
  clearTimeout(pending.timer);
  pending.timer = undefined;
  live.onEvent({ type: "question.updated", requestId });
}

function clearServerRequests(live: Live, preserveAsyncQuestions = false): void {
  for (const pending of live.approvals.values()) pending.resolve("cancelled");
  for (const [id, pending] of live.questions) {
    if (preserveAsyncQuestions && pending.rpcId === null) continue;
    clearTimeout(pending.timer);
    pending.resolve("cancelled");
    live.questions.delete(id);
    live.queuedAsyncAnswers.delete(id);
  }
  live.approvals.clear();
  if (live.visibleQuestionId !== null && !live.questions.has(live.visibleQuestionId))
    live.visibleQuestionId = null;
}

function settleAsyncAnswers(live: Live): void {
  if (
    live.awaitingAsyncAnswers &&
    Array.from(live.questions.keys()).every((id) => live.queuedAsyncAnswers.has(id))
  ) {
    // The completed provider turn is ready for one continuation with all explicit answers.
    // Keep submitted questions alive until that continuation has been accepted.
    live.turnEndPending = false;
    live.activeTurnId = null;
    live.awaitingAsyncAnswers = false;
    if (!live.asyncAnswerTexts.length && live.openAgentRows.size > 0) {
      maybeFinishBackgroundTurn(live);
      return;
    }
    live.parentCompleted = false;
    TurnLatch.finish(live);
  }
}

function showNextQuestion(live: Live): void {
  if (
    live.visibleQuestionId !== null &&
    live.questions.has(live.visibleQuestionId) &&
    !live.queuedAsyncAnswers.has(live.visibleQuestionId)
  )
    return;
  const next = Array.from(live.questions.entries()).find(
    ([id]) => !live.queuedAsyncAnswers.has(id),
  );
  live.visibleQuestionId = next?.[0] ?? null;
  if (next) {
    // Non-blocking means the agent can keep working, not that silence is a
    // request to skip. Wait for an explicit reply or provider cancellation.
    live.onEvent(next[1].event);
  }
}

export async function cancelCodexTurn(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const live = liveByThread.get(sessionId);
  const preparing = startingByThread.get(sessionId);
  // A captured stale control cannot cancel a newer operation on a warm process.
  if (
    !ownsOperation(
      context,
      live?.handle ?? preparing?.handle,
      live?.operation ?? preparing?.operation,
    )
  )
    return;
  cancellationEpoch.set(sessionId, (cancellationEpoch.get(sessionId) ?? 0) + 1);
  if (!live) {
    if (preparing) await stopCodexSession(sessionId, context ?? preparing.handle);
    return;
  }
  const turnId = live.activeTurnId;
  let rpc;
  try {
    rpc =
      context && turnId
        ? await rpcTurnWriter(live.handle, live.rpc, context.nativeControlTurn, context, "control")
        : live.rpc;
  } catch (error) {
    console.warn("[codex] Control writer unavailable; stopping process", error);
    await stopCodexSession(sessionId, live.handle);
    return;
  }
  if (!ownsOperation(context, live.handle, live.operation)) return;
  if (live.openAgentRows.size > 0) {
    // Keep the root latch and rows until physical retirement is confirmed.
    // A failed stop remains observable and can be retried against this owner.
    live.cancelled = true;
    live.muteUpdates = true;
    try {
      await retirements.retire([live.handle]);
    } catch (error) {
      if (liveByThread.get(sessionId) === live) {
        live.cancelled = false;
        live.muteUpdates = false;
        live.onEvent({
          type: "status",
          text: "Could not confirm that the subagents stopped. Retry Stop to verify their outcome.",
        });
      }
      throw error;
    }
    closeOpenAgentRows(live);
    if (live.backgroundKey) {
      live.backgroundKey = "";
      live.onEvent({ type: "background.updated", tasks: [], agents: 0 });
    }
    await stopCodexSession(sessionId, live.handle);
    return;
  }
  live.cancelled = true;
  live.muteUpdates = true;
  clearServerRequests(live);
  if (live.pendingTurnStart && !turnId) {
    // No interrupt target exists yet. Retire this transport so the pending
    // request cannot start work or accept the prompt after Stop returns.
    await stopCodexSession(sessionId, live.handle);
  } else if (turnId) {
    await rpc
      .request(
        "turn/interrupt",
        {
          threadId: live.threadId,
          turnId,
        },
        5_000,
      )
      .catch(async (error: unknown) => {
        console.warn("[codex] Interrupt failed; stopping process", error);
        await stopCodexSession(sessionId, live.handle);
      });
  }
  if (!ownsOperation(context, live.handle, live.operation)) return;
  finishActiveTurn(live, [{ type: "message.completed" }, { type: "reasoning.completed" }]);
}

export async function stopCodexSession(
  sessionId: string,
  target?: ChildProcessHandle | HarnessOperationContext,
): Promise<void> {
  const context = operationContext(target);
  if (cancelQueuedOperation(context)) return;
  const expectedHandle = processTarget(target);

  const candidate = liveByThread.get(sessionId);
  const live =
    (!expectedHandle || candidate?.handle === expectedHandle) &&
    ownsOperation(context, candidate?.handle, candidate?.operation)
      ? candidate
      : undefined;
  const preparing = startingByThread.get(sessionId);
  const startup =
    (!expectedHandle || preparing?.handle === expectedHandle) &&
    ownsOperation(context, preparing?.handle, preparing?.operation)
      ? preparing
      : undefined;
  if (live) liveByThread.delete(sessionId);
  if (startup) startingByThread.delete(sessionId);
  if (live) {
    live.muteUpdates = true;
    live.turnGeneration += 1;
    for (const backlog of live.pendingSubagent.values())
      for (const step of backlog) step.work?.fail("codex-backlog-retired");
    live.pendingSubagent.clear();
    clearServerRequests(live);
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
    live.rpc.close();
  }
  startup?.rpc?.close();
  const handles = new Set([live?.handle, startup?.handle, ...(!context ? [expectedHandle] : [])]);
  await (context || expectedHandle
    ? retirements.retire(handles)
    : retirements.retireOwner(sessionId, handles));
}

/** Host-to-desktop ownership transfer is stricter than delete/provider switch.
 * A stale operation must never fall back to the latest session writer, and an
 * empty stop target is not evidence that the original writer was retired. */
export async function retireOriginalCodexWriter(
  sessionId: string,
  context: HarnessOperationContext,
): Promise<void> {
  const live = liveByThread.get(sessionId);
  const startup = startingByThread.get(sessionId);
  if (
    !context?.operation ||
    !live ||
    startup ||
    !ownsOperation(context, live.handle, live.operation)
  )
    throw new Error("The original Codex writer cannot be verified; continuation remains guarded.");
  if (live.activeTurnId || live.pendingTurnStart)
    throw new Error(
      "The original Codex writer still has active work; continuation remains guarded.",
    );
  // stopCodexSession captures the matching handle synchronously, before waiting
  // for retirement. Unlike forget, it preserves the persisted resume identity.
  await stopCodexSession(sessionId, context);
}

export async function forgetCodexSession(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  // Delete/switch must always end the process: clear resume state first and
  // fall back to a by-session stop when the context no longer owns it.
  resumeByThread.delete(sessionId);
  const queuedOnly = cancelQueuedOperation(context);
  const original = liveByThread.get(sessionId) ?? startingByThread.get(sessionId);
  const owned =
    !queuedOnly && (!original || ownsOperation(context, original.handle, original.operation));
  forgetSessionCommands(sessionId);
  await stopCodexSession(sessionId, owned ? context : undefined);
  retireProviderEpoch(cancellationEpoch, operationTailsBySession, sessionId);
}

export function bindCodexSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
): void {
  const providerThreadId = providerSessionId.trim();
  if (!threadId || !providerThreadId || !cwd.trim()) return;
  resumeByThread.set(threadId, {
    threadId: providerThreadId,
    cwd,
    providerAccountId,
  });
}

async function ensureLive(input: HarnessSessionInput): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const existing = liveByThread.get(input.sessionId);
  const controlsAgents = input.controlsAgents === true;
  if (
    existing &&
    existing.cwd === input.cwd &&
    sameProviderAccountId(existing.providerAccountId, input.providerAccountId) &&
    existing.controlsAgents === controlsAgents &&
    existing.skillPolicyKey === JSON.stringify(input.skillPolicy)
  ) {
    observeProviderProcess(input, existing.handle);
    return existing;
  }
  const handle = retirements.admit(
    createChildProcessHandle(input.sessionId, input.nativeControlTurn),
  );
  const startup: { handle: ChildProcessHandle; operation?: object; rpc?: JsonRpcClient } = {
    handle,
    operation: input.operationContext?.operation,
  };
  startingByThread.set(input.sessionId, startup);
  try {
    observeProviderProcess(input, handle, "starting");
    if (existing) {
      // Codex may retain the thread's sandbox network policy across turns.
      // Switch it when this session gains /operator access or loses agent
      // control, so its local CLI socket matches the current policy.
      if (
        existing.cwd !== input.cwd ||
        !sameProviderAccountId(existing.providerAccountId, input.providerAccountId)
      ) {
        resumeByThread.delete(input.sessionId);
      }
      await stopCodexSession(input.sessionId, existing.handle);
      if (startingByThread.get(input.sessionId) !== startup)
        throw new Error("Provider startup cancelled");
    }

    const resume = resumeByThread.get(input.sessionId);
    const canResume =
      resume != null &&
      resume.cwd === input.cwd &&
      sameProviderAccountId(resume.providerAccountId, input.providerAccountId);
    if (
      resume &&
      (resume.cwd !== input.cwd ||
        !sameProviderAccountId(resume.providerAccountId, input.providerAccountId))
    ) {
      resumeByThread.delete(input.sessionId);
    }

    const { path } = await resolveCodexBinaryImpl();
    if (startingByThread.get(input.sessionId) !== startup)
      throw new Error("Provider startup cancelled");
    const liveRef: { current: Live | null } = { current: null };

    const rpc = new JsonRpcClient(
      handle,
      {
        onNotification: (method, params, work) => {
          const live = liveRef.current;
          if (!live || live.muteUpdates) {
            work?.fail("codex-notification-retired");
            return;
          }
          if (live.notificationQueue) {
            const turnGeneration = live.turnGeneration;
            const queued = live.notificationQueue
              .catch(() => undefined)
              .then(
                nativeOutputSink(work ?? null, () => {
                  if (
                    live.muteUpdates ||
                    live.cancelled ||
                    turnGeneration !== live.turnGeneration
                  ) {
                    work?.fail("codex-notification-retired");
                    return;
                  }
                  return handleNotification(live, method, params, work ?? null);
                }),
              );
            trackNotificationQueue(
              live,
              queued.catch(() => undefined),
            );
            return queued;
          }
          const result = handleNotification(live, method, params, work ?? null);
          if (!result) return;
          trackNotificationQueue(
            live,
            result.catch(() => undefined),
          );
          return result;
        },
        onRequest: (id, method, params, work) => {
          const live = liveRef.current;
          const turn = live?.turnDone;
          // The external clock can be requested before thread/start or resume
          // returns, so it must not depend on the live session being bound.
          const response =
            method === "currentTime/read"
              ? rpc.respond(id, { currentTimeAt: Math.floor(Date.now() / 1000) })
              : live
                ? handleServerRequest(live, id, method, params)
                : undefined;
          return response?.catch(
            nativeOutputSink(work ?? null, (error: unknown) => {
              if (live?.muteUpdates || (live && live.turnDone !== turn)) return;
              const failure = error instanceof Error ? error : new Error(String(error));
              rpc.close(failure);
              if (live?.turnFailed) {
                live.turnFailed(failure);
              } else {
                (live?.onEvent ?? input.onEvent)({
                  type: "session.error",
                  message: failure.message,
                });
              }
            }),
          );
        },
      },
      { includeJsonrpc: false, label: "codex", defaultRequestTimeoutMs: 60_000 },
    );

    startup.rpc = rpc;
    watchChild(
      handle,
      (line) => rpc.pushLine(line),
      (code, reason) => {
        const error = new Error(
          reason ?? `Codex app-server exited${code == null ? "" : ` (exit code ${code})`}`,
        );
        rpc.close(error);
        if (liveByThread.get(input.sessionId)?.handle === handle)
          liveByThread.delete(input.sessionId);
        const live = liveRef.current;
        if (!live?.muteUpdates) {
          (live?.onEvent ?? input.onEvent)({ type: "session.ended", code });
        }
        live?.turnFailed?.(error);
        if (live) {
          clearServerRequests(live);
          live.turnDone = null;
          live.turnFailed = null;
        }
      },
    );

    await spawnChild(
      handle,
      path,
      ["app-server"],
      input.cwd,
      {
        provider: "codex",
        id: input.providerAccountId ?? "default",
      },
      "codex",
    );

    const startupRpc = await rpcTurnWriter(
      handle,
      rpc,
      input.nativeControlTurn,
      input.operationContext,
    );
    await startupRpc.request("initialize", {
      clientInfo: {
        name: "bycoda",
        title: PRODUCT_IDENTITY.displayName,
        version: "0.1.0",
      },
      capabilities: {
        // Required by collaborationMode (including Plan); currentTime/read is
        // handled above even while the thread is starting or resuming.
        experimentalApi: true,
      },
    });
    await startupRpc.notify("initialized", undefined);

    let skillConfig: Record<string, unknown> | undefined;
    if (input.skillPolicy) {
      const effective = asRecord(await startupRpc.request("config/read", { includeLayers: false }));
      const configured = asRecord(asRecord(effective?.config)?.skills)?.config;
      const entries = Array.isArray(configured) ? [...configured] : [];
      const inventory = await startupRpc.request("skills/list", {
        cwds: [input.cwd],
        forceReload: true,
      });
      for (const path of input.skillPolicy.disabledPaths) {
        if (!entries.some((entry) => asRecord(entry)?.path === path))
          entries.push({ path, enabled: false });
      }
      for (const skill of codexSkillStatesFromList(inventory)) {
        if (!skillDisabled(input.skillPolicy, skill)) continue;
        const existingIndex = entries.findIndex((entry) => {
          const path = asRecord(entry)?.path;
          return typeof path === "string" && skillPathKey(path) === skillPathKey(skill.path);
        });
        const override = { path: skill.path, enabled: false };
        if (existingIndex < 0) entries.push(override);
        else entries[existingIndex] = override;
      }
      skillConfig = { "skills.config": entries };
    }

    const model = nativeModelId(input.model);
    const serviceTier = input.modelSettings?.serviceTier;
    const threadConfig = codexThreadConfig(skillConfig, input.modelSettings);

    let threadId: string | undefined;
    let threadModel = model;
    let didResume = false;

    if (canResume && resume) {
      const opened = await resumeCodexThread<{ thread?: { id?: string }; model?: string }>(
        startupRpc,
        resume.threadId,
        {
          threadId: resume.threadId,
          // Bycoda already owns the transcript. Avoid retransmitting the
          // full history (including base64 images); Codex keeps its context.
          excludeTurns: true,
          ...(threadConfig ? { config: threadConfig } : {}),
          ...buildThreadStartParams({
            cwd: input.cwd,
            ...codexMode(input),
            model,
            serviceTier,
            additionalDirs: additionalDirsFor(input.sessionId),
          }),
        },
        120_000,
      );
      threadId = opened.thread?.id;
      threadModel = opened.model?.trim() || model;
      didResume = true;
    }

    if (!threadId) {
      const opened = await startupRpc.request<{ thread?: { id?: string }; model?: string }>(
        "thread/start",
        {
          ...(threadConfig ? { config: threadConfig } : {}),
          ...buildThreadStartParams({
            cwd: input.cwd,
            ...codexMode(input),
            model,
            serviceTier,
            additionalDirs: additionalDirsFor(input.sessionId),
          }),
        },
      );
      threadId = opened.thread?.id?.trim();
      threadModel = opened.model?.trim() || model;
    }

    if (!threadId) throw new Error("Codex did not return a thread id");

    if (startingByThread.get(input.sessionId) !== startup)
      throw new Error("Provider startup cancelled");
    const live: Live = {
      operation: input.operationContext?.operation,
      handle,
      sessionId: input.sessionId,
      rpc,
      threadId,
      model: threadModel,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
      controlsAgents,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      questions: new Map(),
      visibleQuestionId: null,
      nextApprovalUiId: 1,
      cancelled: false,
      muteUpdates: didResume,
      activeTurnId: null,
      parentCompleted: false,
      pendingParentErrors: [],
      backgroundKey: "",
      completedParentTurns: new Set(),
      turnInput: null,
      childTurns: new Map(),
      terminalChildren: new Set(),
      completedChildTurns: new Set(),
      childOutcomes: new Map(),
      agentTitles: new Map(),
      awaitingAsyncAnswers: false,
      asyncAnswerTexts: [],
      queuedAsyncAnswers: new Map(),
      turnUsage: {},
      commandOutput: new Map(),
      pendingTurnStart: false,
      turns: Promise.resolve(),
      turnDone: null,
      turnFailed: null,
      turnEndPending: false,
      emittedAssistantByItem: new Map(),
      emittedReasoningByItem: new Map(),
      emittedGeneratedImages: new Set(),
      emittedAsyncQuestions: new Set(),
      turnGeneration: 0,
      notificationQueue: null,
      subagentThreads: new Map(),
      pendingSubagent: new Map(),
      openAgentRows: new Map(),
      rateLimits: new Map(),
      usageLimited: false,
      skills: new Map(),
      skillPolicy: input.skillPolicy,
      skillPolicyKey: JSON.stringify(input.skillPolicy),
    };
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    resumeByThread.set(input.sessionId, {
      threadId,
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: threadId,
    });
    live.onEvent({ type: "session.started" });
    void loadCodexSkills(live, input.sessionId, startupRpc);
    return live;
  } catch (error) {
    startup.rpc?.close(error instanceof Error ? error : new Error(String(error)));
    return preserveProviderFailure(error, stopCodexSession(input.sessionId, handle));
  } finally {
    if (startingByThread.get(input.sessionId) === startup) startingByThread.delete(input.sessionId);
  }
}

/** Ask Codex which skills it sees for this thread; the `$` menu lists them. */
function loadCodexSkills(
  live: Live,
  sessionId: string,
  rpc: JsonRpcWriterView = live.rpc,
): Promise<void> {
  if (live.skillsLoading) return live.skillsLoading;
  const loading = refreshCodexSkills(live, sessionId, rpc).finally(() => {
    if (live.skillsLoading === loading) live.skillsLoading = undefined;
  });
  live.skillsLoading = loading;
  return loading;
}

async function refreshCodexSkills(
  live: Live,
  sessionId: string,
  rpc: JsonRpcWriterView = live.rpc,
): Promise<void> {
  try {
    const response = await rpc.request("skills/list", {
      cwds: [live.cwd],
      forceReload: true,
    });
    const skills = codexSkillsFromList(response).filter(
      (skill) => !live.skillPolicy || !skillDisabled(live.skillPolicy, skill),
    );
    live.skills = new Map(skills.map((skill) => [skill.name, skill.path]));
    reportSessionCommands(
      sessionId,
      codexSkillStatesFromList(response).map((skill) => ({
        ...skill,
        kind: "skill" as const,
        enabled: skill.enabled && (!live.skillPolicy || !skillDisabled(live.skillPolicy, skill)),
        disabledBy:
          live.skillPolicy && skillDisabled(live.skillPolicy, skill)
            ? ("bycoda" as const)
            : !skill.enabled
              ? ("provider" as const)
              : undefined,
      })),
    );
  } catch {
    // The menu falls back to skills found on disk.
  }
}

async function runTurn(live: Live, input: SendTurnInput, rpc: JsonRpcWriterView): Promise<void> {
  // The first skill-bearing turn must wait for discovery; later turns refresh
  // so skills created or edited in this session are available immediately.
  if (/(?:^|\s)\$[A-Za-z0-9]/.test(input.text)) await loadCodexSkills(live, input.sessionId, rpc);
  if (live.cancelled) return;
  live.turnInput = input;
  live.parentCompleted = false;
  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    await startParentTurn(live, input, rpc);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    // These answers have not crossed the continuation's acceptance boundary.
    for (const [requestId, { pending }] of live.queuedAsyncAnswers) {
      if (live.questions.get(requestId) !== pending) continue;
      live.onEvent({
        type: "question.updated",
        requestId,
        delivery: "unknown",
        error: "Answer delivery could not be confirmed. Check the connection before continuing.",
      });
    }
    live.onEvent({
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    live.pendingTurnStart = false;
    live.turnDone = null;
    live.turnFailed = null;
  }
  if (!live.cancelled && !live.muteUpdates && live.asyncAnswerTexts.length) {
    const text = live.asyncAnswerTexts.join("\n\n");
    const queued = new Map(live.queuedAsyncAnswers);
    await runTurn(
      live,
      {
        ...input,
        text,
        attachments: [],
        runtimeInstructions: undefined,
        onAccepted: () => {
          for (const [id, { pending, reply }] of queued) {
            if (live.questions.get(id) === pending) pending.resolve(reply);
            live.queuedAsyncAnswers.delete(id);
          }
        },
      },
      rpc,
    );
  }
}

/** Starts a provider parent turn without replacing the execution's latch or children. */
async function startParentTurn(
  live: Live,
  input: SendTurnInput,
  rpc: JsonRpcWriterView,
): Promise<void> {
  const model = (live.model = nativeModelId(input.model) || live.model); // sticks to the thread
  const effort = input.modelSettings?.reasoningEffort;
  const serviceTier = input.modelSettings?.serviceTier;

  const params = buildTurnStartParams({
    threadId: live.threadId,
    ...codexMode(input),
    prompt:
      [input.runtimeInstructions, input.text].filter(Boolean).join("\n\n").trim() || undefined,
    attachments: input.attachments,
    skills: live.skills,
    model,
    effort,
    serviceTier,
    intent: input.intent,
    additionalDirs: additionalDirsFor(input.sessionId),
  });

  if (Array.isArray(params.input) && params.input.length === 0) {
    if (!live.openAgentRows.size) TurnLatch.finish(live);
    return;
  }

  const previous = {
    emittedAssistantByItem: live.emittedAssistantByItem,
    emittedReasoningByItem: live.emittedReasoningByItem,
    emittedAsyncQuestions: live.emittedAsyncQuestions,
    asyncAnswerTexts: live.asyncAnswerTexts,
    turnUsage: live.turnUsage,
    commandOutput: live.commandOutput,
  };
  live.emittedAssistantByItem = new Map();
  live.asyncAnswerTexts = [];
  live.turnUsage = {};
  live.commandOutput = new Map();
  live.emittedReasoningByItem = new Map();
  live.emittedAsyncQuestions = new Set();
  const previousCompleted = live.parentCompleted;
  live.parentCompleted = false;
  try {
    live.pendingTurnStart = true;
    await rpc.requestWithNativeOutput<{ turn?: { id?: string } }>(
      "turn/start",
      params,
      (response, work) =>
        nativeOutputSink(work, () => {
          live.pendingTurnStart = false;
          // Natural completion may arrive before this response. Still acknowledge it,
          // but never accept a stopped turn or an old transport's late response.
          if (live.cancelled || live.muteUpdates) return response;
          input.onAccepted?.();
          const turnId = response.turn?.id ?? live.activeTurnId;
          // turn/completed can arrive before turn/start returns; don't resurrect a
          // finished turn's id after finishActiveTurn cleared activeTurnId.
          if (
            turnId &&
            live.turnDone &&
            !live.awaitingAsyncAnswers &&
            !live.completedParentTurns.has(turnId)
          ) {
            live.activeTurnId = live.activeTurnId ?? turnId;
            live.onEvent({ type: "turn.started", providerTurnId: turnId });
          }
          settlePendingTurn(live);
          return response;
        })(),
    );
  } catch (error) {
    // A protocol rejection is known not to have started a new parent. A lost
    // response is uncertain: keep the run owned and observable until recovery.
    if (error instanceof JsonRpcResponseError && !live.activeTurnId) {
      live.parentCompleted = previousCompleted;
      Object.assign(live, previous);
    }
    throw error;
  } finally {
    live.pendingTurnStart = false;
    syncBackgroundWait(live);
    maybeFinishBackgroundTurn(live);
  }
}

async function runCompaction(live: Live, rpc: JsonRpcWriterView): Promise<void> {
  live.emittedAssistantByItem.clear();
  live.emittedReasoningByItem.clear();
  live.emittedGeneratedImages.clear();
  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    await rpc.request("thread/compact/start", {
      threadId: live.threadId,
    });
    settlePendingTurn(live);
    await turnPromise;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

function handleNotification(
  live: Live,
  method: string,
  params: unknown,
  outputWork: NativeOutputWork | null = null,
): void | Promise<void> {
  if (live.muteUpdates || live.cancelled) return;
  if (method === "skills/changed") {
    return loadCodexSkills(live, live.sessionId);
  }
  const rec = asRecord(params);
  if (method === "serverRequest/resolved") {
    for (const pending of live.approvals.values()) {
      if (pending.rpcId === rec?.requestId && pending.threadId === rec?.threadId)
        pending.resolve("cancelled");
    }
    for (const pending of live.questions.values()) {
      if (pending.rpcId === rec?.requestId && pending.threadId === rec?.threadId)
        pending.resolve("cancelled");
    }
    return;
  }
  // Child threads share this connection. Their lifecycle must not touch the
  // parent's turn or clear its approvals, but what they do is the inside of a
  // subagent — mirror it onto the row that spawned them.
  const threadId =
    stringField(rec, "threadId") ??
    (method === "thread/started" ? stringField(asRecord(rec?.thread), "id") : undefined);
  if (threadId && threadId !== live.threadId) {
    return handleSubagentNotification(live, threadId, method, params);
  }
  const notifiedTurnId = stringField(asRecord(rec?.turn), "id") ?? stringField(rec, "turnId");
  const activityItem = asRecord(rec?.item);
  const childActivity =
    (method === "item/started" || method === "item/completed") &&
    (activityItem?.type === "subAgentActivity" || activityItem?.type === "collabAgentToolCall");
  // Child state may still be reported against the parent turn that spawned it.
  // Stale parent text/lifecycle must not interfere with its newer continuation.
  if (notifiedTurnId && live.completedParentTurns.has(notifiedTurnId) && !childActivity) return;
  if (
    (method === "turn/completed" || method === "turn/aborted") &&
    live.activeTurnId &&
    notifiedTurnId &&
    live.activeTurnId !== notifiedTurnId
  )
    return;
  // A Codex turn is a sequence of items. Completing an agentMessage does not
  // mean the turn is over — more tools and messages can still arrive. Only
  // turn/completed (and turn/aborted) settle sendCodexTurn, which is what the
  // UI uses for busy / stop / "Working for".
  const mapped = mapCodexNotification(method, params, live.turnUsage, live.commandOutput);
  if (mapped.diagnostic) {
    console.debug(`[bycoda] codex ${live.threadId} ${method}`, mapped.diagnostic);
  }
  // Codex describes one spawned agent through more than one item type. The
  // first row to name a child thread owns it; a later item for the same thread
  // would otherwise stand up a second agent that never does anything.
  const duplicate = bindSubagentThreads(live, method, rec);
  const snapshot = method === "item/completed";
  const itemId = snapshot ? stringField(asRecord(rec?.item), "id") : stringField(rec, "itemId");
  let pending: Promise<void> | undefined;
  for (const event of mapped.events) {
    if (event.type === "session.error" && live.openAgentRows.size > 0) {
      // session.error seals UI streaming. Report the failure immediately, but
      // retain execution ownership until its independently running children end.
      if (
        !live.pendingParentErrors.some(
          (pending) => pending.type === "session.error" && pending.message === event.message,
        )
      )
        live.pendingParentErrors.push(event);
      live.onEvent({ type: "status", key: "codex-parent-error", text: event.message });
      continue;
    }
    // A fast child may finish before its spawn call returns. That call's
    // stale running snapshot cannot reopen the child's settled row.
    if (
      (event.type === "tool.started" || event.type === "tool.updated") &&
      event.kind === "agent" &&
      ["pending", "in_progress", "running"].includes(event.status ?? "")
    ) {
      const children = [...live.subagentThreads].filter(([, owner]) => owner === event.callId);
      if (children.length && children.every(([id]) => live.terminalChildren.has(id))) continue;
    }
    if (
      duplicate &&
      event.type === "tool.updated" &&
      event.kind === "agent" &&
      event.status &&
      !["pending", "in_progress", "running"].includes(event.status)
    ) {
      for (const childId of codexSubagentThreadIds(asRecord(rec?.item) ?? {}))
        settleChild(live, childId, event.status);
    }
    if (duplicate && duplicateAgentRow(event)) {
      continue;
    }
    if (event.type === "image.generated") {
      if (live.emittedGeneratedImages.has(event.itemId)) continue;
      live.emittedGeneratedImages.add(event.itemId);
      if ("data" in event) {
        const save = nativeOutputSink(outputWork, () => materializeGeneratedImage(live, event));
        pending = pending ? pending.then(save) : save();
        continue;
      }
      live.onEvent(event);
      continue;
    }
    trackAgentRow(live, event, live.model);
    if (event.type === "message.delta") {
      publishCodexText(live, "assistant", event.text, snapshot, itemId);
      continue;
    }
    if (event.type === "reasoning.delta") {
      publishCodexText(live, "reasoning", event.text, snapshot, itemId);
      continue;
    }
    live.onEvent(event);
  }
  if (method === "item/completed") showCodexAsyncQuestion(live, rec);
  // Metadata and steps can arrive before the spawn. Create its row first.
  let replay: Promise<void> | undefined;
  for (const childId of codexSubagentThreadIds(asRecord(rec?.item) ?? {})) {
    const owner = live.subagentThreads.get(childId);
    if (!owner) continue;
    const backlog = live.pendingSubagent.get(childId);
    live.pendingSubagent.delete(childId);
    for (const pendingStep of backlog ?? []) {
      const emit = () => {
        try {
          const actual = nativeOutputSink(pendingStep.work, () =>
            emitSubagentNotification(live, childId, owner, pendingStep.method, pendingStep.params),
          )();
          if (actual) return trackNativeOutputWork(actual, pendingStep.work);
          pendingStep.work?.finish();
        } catch (error) {
          pendingStep.work?.fail("codex-backlog-replay-failed");
          throw error;
        }
      };
      if (replay) {
        replay = replay.then(emit);
      } else {
        const result = emit();
        if (result) replay = result;
      }
    }
  }
  const finish = nativeOutputSink(outputWork, () => {
    settleSubagentRows(live, rec);
    if (mapped.rateLimits) noteRateLimits(live, mapped.rateLimits);
    if (mapped.usageLimited) live.usageLimited = true;
    if (mapped.activeTurnId !== undefined) {
      live.activeTurnId = mapped.activeTurnId;
    }
    if (mapped.turnCompleted) {
      // Report the limit before the turn settles so queued follow-ups hold.
      if (live.usageLimited && !live.cancelled) {
        const resetsAt = usageLimitResetAt(live);
        live.onEvent({
          type: "usage.limited",
          ...(resetsAt != null ? { resetsAt } : {}),
        });
      }
      const keepQuestions =
        mapped.turnCompleted.status === "completed" &&
        !live.usageLimited &&
        Array.from(live.questions.values()).some((question) => question.rpcId === null);
      live.usageLimited = false;
      if (notifiedTurnId) live.completedParentTurns.add(notifiedTurnId);
      live.parentCompleted = true;
      syncBackgroundWait(live);
      if (keepQuestions) {
        live.awaitingAsyncAnswers = true;
        live.activeTurnId = null;
        if (!live.openAgentRows.size) clearServerRequests(live, true);
        return;
      }
      if (live.openAgentRows.size > 0) return;
      finishActiveTurn(live);
    } else {
      maybeFinishBackgroundTurn(live);
    }
  });
  const afterImages = nativeOutputSink(outputWork, () => {
    if (live.muteUpdates || live.cancelled) return;
    if (replay) return replay.then(finish);
    finish();
  });
  if (pending) return pending.then(afterImages);
  return afterImages();
}

function showCodexAsyncQuestion(live: Live, rec: Record<string, unknown> | null): void {
  const item = asRecord(rec?.item);
  const itemId = stringField(item, "id");
  const turnId = stringField(rec, "turnId") ?? live.activeTurnId;
  if (!itemId || !turnId || turnId !== live.activeTurnId || live.emittedAsyncQuestions.has(itemId))
    return;
  let questions;
  try {
    questions = codexAsyncQuestions(item);
  } catch (error) {
    live.onEvent({
      type: "status",
      text: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!questions.length) return;
  live.emittedAsyncQuestions.add(itemId);
  const uiId = live.nextApprovalUiId++;
  const event: Extract<HarnessEvent, { type: "question.asked" }> = {
    type: "question.asked",
    requestId: uiId,
    title: questionPromptTitle(questions),
    questions,
    callId: itemId,
    providerTurnId: turnId,
    behavior: "nonBlocking",
    dismissAction: "skip",
  };
  captureNativeOutputEvent(live.sessionId, event);
  const outcome = new Promise<UserQuestionReply | "cancelled">((resolve) => {
    live.questions.set(uiId, {
      rpcId: null,
      threadId: live.threadId,
      turnId,
      event,
      isBlocking: false,
      resolve,
    });
  }).finally(() => {
    clearTimeout(live.questions.get(uiId)?.timer);
    live.questions.delete(uiId);
  });
  showNextQuestion(live);
  void runNativeOutputWork(async (work) => {
    const reply = await outcome;
    nativeOutputSink(work, () => {
      live.onEvent({
        type: "question.resolved",
        requestId: uiId,
        decision:
          reply === "cancelled" ? "cancelled" : reply.kind === "answered" ? "answered" : "skipped",
        ...(reply !== "cancelled" && reply.kind === "answered" ? { reply } : {}),
      });
      showNextQuestion(live);
      settleAsyncAnswers(live);
    })();
  });
}

async function materializeGeneratedImage(
  live: Live,
  event: Extract<HarnessEvent, { type: "image.generated"; data: string }>,
): Promise<void> {
  return runNativeOutputWork(async (outputWork) => {
    const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
      live.onEvent(event),
    );
    const turnGeneration = live.turnGeneration;
    try {
      const asset = await saveGeneratedImage({
        data: event.data,
        name: event.name,
      });
      if (live.cancelled || live.muteUpdates || turnGeneration !== live.turnGeneration) {
        void nativeOutputSink(outputWork, () =>
          runNativeOutputWork(() => deleteGeneratedImages([asset.path])),
        )().catch(() => undefined);
        return;
      }
      emitNative({
        type: "image.generated",
        itemId: event.itemId,
        path: asset.path,
        name: event.name,
        mimeType: asset.mimeType,
        size: asset.size,
        ...(event.alt ? { alt: event.alt } : {}),
      });
    } catch (cause) {
      if (live.cancelled || live.muteUpdates || turnGeneration !== live.turnGeneration) {
        return;
      }
      emitNative({
        type: "session.error",
        message: `Could not save generated image: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
  });
}

/** Rate-limit updates are sparse: a missing window keeps its last reading. */
function noteRateLimits(live: Live, update: Record<string, unknown>): void {
  const id = stringField(update, "limitId") ?? "";
  const current = live.rateLimits.get(id) ?? {};
  live.rateLimits.set(id, {
    primary: update.primary ?? current.primary,
    secondary: update.secondary ?? current.secondary,
  });
}

function usageLimitResetAt(live: Live): number | null {
  let latest: number | null = null;
  for (const windows of live.rateLimits.values()) {
    const resetsAt = exhaustedWindowResetAt(parseCodexRateLimits(windows));
    if (resetsAt != null) latest = Math.max(latest ?? 0, resetsAt);
  }
  return latest;
}

/**
 * How many notifications a not-yet-identified child thread may bank. Codex can
 * stream a subagent's first calls before the spawn item reports which thread it
 * created, and those calls are the most interesting ones — but an unrecognised
 * thread must not be able to grow this without bound.
 */
const MAX_PENDING_SUBAGENT = 64;

/**
 * Learns which agent row a child thread belongs to.
 * Returns true when every thread this item names already belongs to another
 * row, which makes the item a second description of an agent we already show.
 */
function bindSubagentThreads(
  live: Live,
  method: string,
  rec: Record<string, unknown> | null,
): boolean {
  if (method !== "item/started" && method !== "item/completed") return false;
  const item = asRecord(rec?.item);
  if (!item) return false;
  const itemType = stringField(item, "type") ?? "";
  if (itemType !== "subAgentActivity" && itemType !== "collabAgentToolCall") {
    return false;
  }
  const callId = stringField(item, "id");
  if (!callId) return false;
  const children = codexSubagentThreadIds(item).filter((childId) => childId !== live.threadId);
  let claimed = 0;
  for (const childId of children) {
    const owner = live.subagentThreads.get(childId);
    if (owner) {
      if (
        live.terminalChildren.has(childId) &&
        (item.tool === "resumeAgent" ||
          (itemType === "subAgentActivity" && item.kind === "started"))
      ) {
        live.terminalChildren.delete(childId);
        live.subagentThreads.set(childId, callId);
        continue;
      }
      const model = stringField(item, "model");
      if (model && item.tool === "spawnAgent")
        live.onEvent({
          type: "tool.updated",
          callId: owner,
          kind: "agent",
          agentModel: model,
        });
      if (owner !== callId) claimed += 1;
      continue;
    }
    live.subagentThreads.set(childId, callId);
  }
  return children.length > 0 && claimed === children.length;
}

/**
 * An agent row for a child thread another row already owns. A failure still
 * gets its row — the reason a run died is the one thing worth a line of its
 * own — but a duplicate "running" or "done" is just noise.
 */
function duplicateAgentRow(event: HarnessEvent): boolean {
  if (event.type !== "tool.started" && event.type !== "tool.updated") {
    return false;
  }
  return event.kind === "agent" && event.status !== "failed";
}

/**
 * A child thread's notification. Until the spawn item says which row the thread
 * belongs to, keep it: dropping it loses the opening moves of the run.
 */
function handleSubagentNotification(
  live: Live,
  threadId: string,
  method: string,
  params: unknown,
): void | Promise<void> {
  const callId = live.subagentThreads.get(threadId);
  if (callId) {
    return emitSubagentNotification(live, threadId, callId, method, params);
  }
  if (!live.turnDone && !live.pendingTurnStart) return;
  if (
    method !== "item/started" &&
    method !== "item/completed" &&
    method !== "thread/started" &&
    method !== "thread/tokenUsage/updated" &&
    method !== "turn/started" &&
    method !== "turn/completed" &&
    method !== "turn/aborted" &&
    method !== "thread/closed"
  )
    return;
  const backlog = live.pendingSubagent.get(threadId) ?? [];
  if (backlog.length >= MAX_PENDING_SUBAGENT) {
    captureNativeOutputWork()?.fail("codex-backlog-capacity");
    return;
  }
  backlog.push({ method, params, work: captureNativeOutputWork() });
  live.pendingSubagent.set(threadId, backlog);
}

function emitSubagentNotification(
  live: Live,
  threadId: string,
  callId: string,
  method: string,
  params: unknown,
): void | Promise<void> {
  const rec = asRecord(params);
  const turn = asRecord(rec?.turn);
  const turnId = stringField(turn, "id") ?? stringField(rec, "turnId");
  const key = turnId ? `${threadId}:${turnId}` : undefined;
  if (key && live.completedChildTurns.has(key)) return;
  if (method === "turn/started" && turnId) {
    live.childTurns.set(threadId, turnId);
    if (live.terminalChildren.delete(threadId)) {
      live.childOutcomes.delete(callId);
      const title = live.agentTitles.get(callId) ?? "Subagent";
      live.openAgentRows.set(callId, title);
      live.onEvent({ type: "tool.updated", callId, title, kind: "agent", status: "in_progress" });
      syncBackgroundWait(live);
    }
  }
  if (method === "turn/completed" || method === "turn/aborted" || method === "thread/closed") {
    const current = live.childTurns.get(threadId);
    if (turnId && current && current !== turnId) return;
    const status =
      stringField(turn, "status") ??
      (method === "thread/closed"
        ? "interrupted"
        : method === "turn/aborted"
          ? "interrupted"
          : undefined);
    // Unknown/missing completion state is not proof of success.
    if (status && ["completed", "failed", "interrupted", "cancelled"].includes(status)) {
      if (key) live.completedChildTurns.add(key);
      settleChild(
        live,
        threadId,
        status === "completed" ? "completed" : status === "failed" ? "failed" : "interrupted",
        stringField(asRecord(turn?.error), "message"),
      );
    }
  }
  return emitSubagentSteps(live, callId, method, params);
}

function emitSubagentSteps(
  live: Live,
  callId: string,
  method: string,
  params: unknown,
): void | Promise<void> {
  const mapped = mapCodexNotification(method, params).events;
  for (const event of mapped) {
    if (event.type === "context" && event.used !== undefined) {
      live.onEvent({
        type: "agent.context",
        callId,
        used: event.used,
        ...(event.window ? { window: event.window } : {}),
      });
    }
  }
  const image = mapped.find(
    (event): event is Extract<HarnessEvent, { type: "image.generated" }> =>
      event.type === "image.generated",
  );
  if (image) {
    if (live.emittedGeneratedImages.has(image.itemId)) return;
    live.emittedGeneratedImages.add(image.itemId);
    if ("data" in image) return materializeGeneratedImage(live, image);
    live.onEvent(image);
    return;
  }
  for (const event of mapCodexSubagentSteps(callId, method, params)) {
    live.onEvent(event);
  }
}

/**
 * Settles spawned agents from the per-agent state a collab item reports. The
 * spawn call returns immediately; this is the first word on whether the agent
 * it started actually finished.
 */
function settleSubagentRows(live: Live, rec: Record<string, unknown> | null): void {
  const item = asRecord(rec?.item);
  if (!item) return;
  for (const state of codexSubagentStates(item)) {
    settleChild(live, state.threadId, state.status, state.message);
  }
}

function settleChild(live: Live, threadId: string, status: string, message?: string): void {
  live.terminalChildren.add(threadId);
  const callId = live.subagentThreads.get(threadId);
  const title = callId ? live.openAgentRows.get(callId) : undefined;
  if (!callId || !title) return;
  const previous = live.childOutcomes.get(callId);
  const severity = (value: string) =>
    value === "failed" ? 3 : value === "interrupted" || value === "stopped" ? 2 : 1;
  if (!previous || severity(status) > severity(previous)) live.childOutcomes.set(callId, status);
  // An activity row may represent more than one child.
  if (
    [...live.subagentThreads].some(
      ([id, owner]) => owner === callId && !live.terminalChildren.has(id),
    )
  )
    return;
  live.openAgentRows.delete(callId);
  // Children stay attributable after the row closes: a child that starts another turn
  // reopens it. The owner mapping is retired only when the spawn item itself completes.
  const rowStatus = live.childOutcomes.get(callId) ?? status;
  live.onEvent({
    type: "tool.updated",
    callId,
    title,
    kind: "agent",
    status: rowStatus,
    ...(message ? { detail: message } : {}),
  });
  syncBackgroundWait(live);
  maybeFinishBackgroundTurn(live);
}

/** Closing a parent never proves its unfinished children succeeded. */
function closeOpenAgentRows(live: Live): void {
  for (const [callId, title] of live.openAgentRows) {
    live.onEvent({
      type: "tool.updated",
      callId,
      title,
      kind: "agent",
      status: "interrupted",
    });
  }
  live.openAgentRows.clear();
}

function maybeFinishBackgroundTurn(live: Live): void {
  if (
    !live.parentCompleted ||
    live.pendingTurnStart ||
    live.awaitingAsyncAnswers ||
    live.activeTurnId ||
    live.openAgentRows.size ||
    !live.turnDone
  )
    return;
  finishActiveTurn(live);
}

function syncBackgroundWait(live: Live): void {
  // Before turn/start ACK the previous waiting state remains truthful. A
  // definitive rejection must not briefly erase it or its remaining children.
  if (live.pendingTurnStart || live.muteUpdates) return;
  const tasks = live.parentCompleted && !live.cancelled ? [...live.openAgentRows.values()] : [];
  const key = JSON.stringify(tasks);
  if (key === live.backgroundKey || (!tasks.length && !live.backgroundKey)) return;
  live.backgroundKey = tasks.length ? key : "";
  live.onEvent({ type: "background.updated", tasks, agents: tasks.length });
}

function publishCodexText(
  live: Live,
  role: "assistant" | "reasoning",
  text: string,
  snapshot: boolean,
  itemId: string | undefined,
): void {
  const emitted = role === "assistant" ? live.emittedAssistantByItem : live.emittedReasoningByItem;
  // Keep id-less notifications compatible without mixing them into known items.
  const key = itemId ?? "";
  const already = emitted.get(key) ?? "";
  const emit = snapshot ? snapshotRemainder(already, text) : text;
  if (!emit) return;
  // These are deltas (or a snapshot's missing suffix), so repeated tokens count.
  // Retain completed items until the turn ends to ignore repeated completions.
  emitted.set(key, already + emit);
  if (role === "assistant") {
    live.onEvent({ type: "message.delta", text: emit });
    return;
  }
  live.onEvent({ type: "reasoning.delta", text: emit });
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  live.awaitingAsyncAnswers = false;
  live.parentCompleted = false;
  syncBackgroundWait(live);
  live.turnInput = null;
  clearServerRequests(live);
  closeOpenAgentRows(live);
  live.turnEndPending = false;
  live.turnGeneration += 1;
  live.activeTurnId = null;
  live.emittedAssistantByItem.clear();
  live.emittedReasoningByItem.clear();
  live.emittedGeneratedImages.clear();
  live.emittedAsyncQuestions.clear();
  live.subagentThreads.clear();
  live.childTurns.clear();
  live.terminalChildren.clear();
  live.completedChildTurns.clear();
  live.childOutcomes.clear();
  live.agentTitles.clear();
  for (const backlog of live.pendingSubagent.values())
    for (const step of backlog) step.work?.fail("codex-backlog-retired");
  live.pendingSubagent.clear();
  const errors = live.pendingParentErrors;
  live.pendingParentErrors = [];
  TurnLatch.finish(live, [...extraEvents, ...errors]);
}

function settlePendingTurn(live: Live): void {
  TurnLatch.settle(live, () => finishActiveTurn(live));
}

async function handleServerRequest(
  live: Live,
  id: JsonRpcId,
  method: string,
  params: unknown,
): Promise<void> {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
      const threadId = stringField(asRecord(params), "threadId") ?? live.threadId;
      if (method === "item/tool/requestUserInput") {
        if (live.cancelled || live.muteUpdates) {
          await nativeOutputSink(outputWork, () => live.rpc.respond(id, { answers: {} }))();
          return;
        }
        let questions;
        try {
          questions = codexQuestions(params);
        } catch (error) {
          emitNative({
            type: "status",
            text: error instanceof Error ? error.message : String(error),
          });
          await nativeOutputSink(outputWork, () => live.rpc.respond(id, { answers: {} }))();
          return;
        }
        const uiId = live.nextApprovalUiId++;
        const event: Extract<HarnessEvent, { type: "question.asked" }> = {
          type: "question.asked",
          requestId: uiId,
          title: questionPromptTitle(questions),
          questions,
          callId: stringField(asRecord(params), "itemId"),
          providerTurnId: stringField(asRecord(params), "turnId"),
          behavior: asRecord(params)?.isBlocking === false ? "nonBlocking" : "blocking",
          dismissAction: "skip",
        };
        captureNativeOutputWorkEvent(outputWork, event);
        const outcome = new Promise<UserQuestionReply | "cancelled">((resolve) => {
          live.questions.set(uiId, {
            rpcId: id,
            threadId,
            event,
            resolve,
            deliver: (reply) =>
              nativeOutputSink(outputWork, () =>
                live.rpc.respond(id, codexQuestionResponse(questions, reply)),
              )(),
            // Older servers omit this field and must keep their blocking behavior.
            isBlocking: asRecord(params)?.isBlocking !== false,
          });
        }).finally(() => {
          clearTimeout(live.questions.get(uiId)?.timer);
          live.questions.delete(uiId);
        });
        nativeOutputSink(outputWork, showNextQuestion)(live);
        const reply = await outcome;
        emitNative({
          type: "question.resolved",
          requestId: uiId,
          decision:
            reply === "cancelled"
              ? "cancelled"
              : reply.kind === "answered"
                ? "answered"
                : "skipped",
          ...(reply !== "cancelled" && reply.kind === "answered" ? { reply } : {}),
        });
        nativeOutputSink(outputWork, showNextQuestion)(live);
        return;
      }

      if (method === "mcpServer/elicitation/request") {
        const confirmation = codexMcpConfirmation(params);
        const form = confirmation ? null : codexMcpForm(params);
        if (form && !live.cancelled && !live.muteUpdates) {
          await nativeOutputSink(outputWork, handleMcpForm)(live, id, threadId, form);
          return;
        }
        if (!confirmation || live.cancelled || live.muteUpdates) {
          if (!live.cancelled && !live.muteUpdates)
            emitNative({
              type: "status",
              text: `This MCP server requested a form or browser sign-in that ${PRODUCT_IDENTITY.displayName} does not support yet. Complete it in the server's own interface.`,
            });
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, {
              action: "cancel",
              content: null,
              _meta: null,
            }),
          )();
          return;
        }
        if (!live.planning && live.runtimeMode === "full-access") {
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, {
              action: "accept",
              content: confirmation.content,
              _meta: null,
            }),
          )();
          return;
        }
        const uiId = live.nextApprovalUiId++;
        const pending = nativeOutputSink(outputWork, waitApproval)(
          live,
          uiId,
          id,
          "permissions",
          threadId,
        );
        // MCP consent requires an explicit decision outside non-plan Full Access turns.
        emitNative({
          type: "approval.requested",
          requestId: uiId,
          occurrenceId: pending.occurrenceId,
          kind: "other",
          title: confirmation.title,
        });
        const decision = await pending;
        emitNative({
          type: "approval.resolved",
          requestId: uiId,
          occurrenceId: pending.occurrenceId,
          decision,
        });
        if (decision !== "cancelled" && Array.from(liveByThread.values()).includes(live))
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, {
              action: decision === "allow" ? "accept" : "decline",
              content: decision === "allow" ? confirmation.content : null,
              _meta: null,
            }),
          )();
        return;
      }

      const uiId = live.nextApprovalUiId++;
      const mapped = mapApprovalRequest(method, params, uiId);
      if (!mapped) {
        // An empty success or invented denial hides protocol incompatibility.
        emitNative({
          type: "status",
          text: `Unsupported Codex request: ${method}`,
        });
        await nativeOutputSink(outputWork, () =>
          live.rpc.respondError(id, {
            code: -32601,
            message: `Unsupported method: ${method}`,
          }),
        )();
        return;
      }

      if (live.planning || live.cancelled || live.muteUpdates) {
        // Plan turns run in a non-escalating read-only sandbox. If an older
        // app-server still asks for broader access, deny it silently instead of
        // leaking a Supervised approval prompt into the user's selected mode.
        if (method === "item/permissions/requestApproval") {
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, { permissions: {} }),
          )().catch(() => undefined);
        } else {
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, {
              decision: toCodexApprovalDecision("deny", mapped.kind),
            }),
          )().catch(() => undefined);
        }
        return;
      }

      if (method === "item/permissions/requestApproval") {
        // Auto-deny extra permission grants in supervised; allow in full-access.
        if (live.runtimeMode === "full-access") {
          const rec = asRecord(params);
          const permissions = rec?.permissions ?? {};
          await nativeOutputSink(outputWork, () =>
            live.rpc.respond(id, {
              scope: "session",
              permissions,
            }),
          )();
          return;
        }
        if (live.runtimeMode === "supervised") {
          const pending = nativeOutputSink(outputWork, waitApproval)(
            live,
            uiId,
            id,
            mapped.kind,
            threadId,
          );
          emitNative({ ...mapped.event, occurrenceId: pending.occurrenceId });
          const decision = await pending;
          emitNative({
            type: "approval.resolved",
            requestId: uiId,
            occurrenceId: pending.occurrenceId,
            decision,
          });
          if (decision === "cancelled" || !Array.from(liveByThread.values()).includes(live)) return;
          if (decision === "allow") {
            const rec = asRecord(params);
            await nativeOutputSink(outputWork, () =>
              live.rpc.respond(id, {
                scope: "turn",
                permissions: rec?.permissions ?? {},
              }),
            )();
          } else {
            await nativeOutputSink(outputWork, () => live.rpc.respond(id, { permissions: {} }))();
          }
          return;
        }
        // auto / auto-accept: grant requested permissions for the turn.
        const rec = asRecord(params);
        await nativeOutputSink(outputWork, () =>
          live.rpc.respond(id, {
            scope: "turn",
            permissions: rec?.permissions ?? {},
          }),
        )();
        return;
      }

      const auto = autoApproval(live.runtimeMode, mapped.kind);
      if (auto) {
        await nativeOutputSink(outputWork, () =>
          live.rpc.respond(id, {
            decision: toCodexApprovalDecision(auto, mapped.kind),
          }),
        )();
        return;
      }

      const pending = nativeOutputSink(outputWork, waitApproval)(
        live,
        uiId,
        id,
        mapped.kind,
        threadId,
      );
      emitNative({ ...mapped.event, occurrenceId: pending.occurrenceId });
      const decision = await pending;
      emitNative({
        type: "approval.resolved",
        requestId: uiId,
        occurrenceId: pending.occurrenceId,
        decision,
      });
      if (decision === "cancelled" || !Array.from(liveByThread.values()).includes(live)) return;
      await nativeOutputSink(outputWork, () =>
        live.rpc.respond(id, {
          decision: toCodexApprovalDecision(decision, mapped.kind),
        }),
      )();
    },
    { additionalInput: true },
  );
}

async function handleMcpForm(
  live: Live,
  rpcId: JsonRpcId,
  threadId: string,
  form: CodexMcpForm,
): Promise<void> {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
      // Forms require user-supplied data even in Full Access. Never invent a default.
      while (!live.cancelled && !live.muteUpdates) {
        const uiId = live.nextApprovalUiId++;
        const event: Extract<HarnessEvent, { type: "question.asked" }> = {
          type: "question.asked",
          requestId: uiId,
          title: form.title,
          questions: form.questions,
          behavior: "blocking",
          dismissAction: "decline",
        };
        captureNativeOutputWorkEvent(outputWork, event);
        const outcome = new Promise<UserQuestionReply | "cancelled">((resolve) => {
          live.questions.set(uiId, {
            rpcId,
            threadId,
            event,
            resolve,
            isBlocking: true,
            deliver: (reply) => {
              let response;
              try {
                response = codexMcpFormResponse(form, reply);
              } catch (error) {
                throw new QuestionReplyValidationError(
                  error instanceof Error ? error.message : t("Check the form values."),
                );
              }
              return nativeOutputSink(outputWork, () => live.rpc.respond(rpcId, response))();
            },
          });
        }).finally(() => {
          live.questions.delete(uiId);
        });
        nativeOutputSink(outputWork, showNextQuestion)(live);
        const reply = await outcome;
        emitNative({
          type: "question.resolved",
          requestId: uiId,
          decision:
            reply === "cancelled"
              ? "cancelled"
              : reply.kind === "answered"
                ? "answered"
                : "skipped",
          ...(reply !== "cancelled" && reply.kind === "answered" ? { reply } : {}),
        });
        nativeOutputSink(outputWork, showNextQuestion)(live);
        if (reply === "cancelled" || live.cancelled || live.muteUpdates) return;
        return;
      }
    },
    { additionalInput: true },
  );
}

function waitApproval(
  live: Live,
  uiId: number,
  rpcId: JsonRpcId,
  kind: CodexApprovalKind,
  threadId: string,
): Promise<ApprovalOutcome> & { occurrenceId: string } {
  const occurrenceId = createApprovalOccurrenceId();
  const promise = new Promise<ApprovalOutcome>((resolve) => {
    live.approvals.set(uiId, { rpcId, threadId, kind, occurrenceId, resolve });
  }).finally(() => {
    if (live.approvals.get(uiId)?.occurrenceId === occurrenceId) live.approvals.delete(uiId);
  });
  return Object.assign(promise, { occurrenceId });
}

function autoApproval(runtimeMode: RuntimeMode, kind: CodexApprovalKind): ApprovalDecision | null {
  if (runtimeMode === "supervised") return null;
  if (runtimeMode === "full-access") return "allow";
  if (runtimeMode === "auto") {
    // auto_review is set on the server; still prompt if Codex asks.
    return null;
  }
  // auto-accept-edits: auto file changes, ask for commands.
  if (kind === "file-change") return "allow";
  return null;
}

/** Exported for tests. */
export function __codexTestReset(): void {
  liveByThread.clear();
  resumeByThread.clear();
  cancellationEpoch.clear();
}

export function __codexTestResumeMap(): Map<string, Resume> {
  return resumeByThread;
}
