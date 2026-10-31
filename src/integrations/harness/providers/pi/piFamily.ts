import {
  queueProviderOperation,
  assertProviderOperation,
  observeProviderProcess,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  type HarnessOperationContext,
  capturePiTurnWriter,
  piTurnWriter,
  type PiRpcWriterView,
} from "../turnWriter";

import { killChild } from "../../core/child";
import {
  assertOptionalProviderProbeError,
  createProviderRetirementLedger,
  preserveProviderFailure,
  settleProviderRetirements,
  observeProviderProbeCleanup,
} from "../../core/providerRetirement";
import {
  createApprovalOccurrenceId,
  isApprovalOccurrenceId,
} from "../../../../shared/model/approvalOccurrence";
import {
  captureNativeOutputWorkEvent,
  captureNativeOutputWork,
  joinNativeOutputWorks,
  retainNativeOutputEventOrigin,
  runWithoutNativeOutputOrigin,
  runNativeOutputWork,
  nativeOutputSink,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import { continueAfterFailure } from "../../../../shared/lib/promiseQueue";
import {
  deliverQuestionReply,
  showNextQueuedQuestion,
  type QuestionDelivery,
} from "../questionDelivery";
import { TurnLatch } from "../../../../shared/lib/turnLatch";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { taskListFromToolInput } from "../../../../features/sessions/model/taskList";
import { normalizeProjectPath } from "../../../../features/projects/model/recents";
import type { UserQuestionReply } from "../../../../features/sessions/model/userQuestion";
import type {
  CommandContext,
  NativeCommand,
  NativeCommandProvider,
} from "../../core/nativeCommands";
import { allowedPiSkillPaths, discoverOmpCommands, ompCommandsFromRpcData } from "./piSkills";
import { OMP_FLAVOR } from "./piFlavor";
import { spawnChild, watchChild, writeChild } from "../../core/child";
import type { PiFlavor } from "./piFlavor";
import { PiRpc } from "./piClient";
import { piSubagentEvents } from "./piSubagents";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  buildPiSteer,
  contextFromSessionStats,
  contextFromUsage,
  turnMetricsFromUsage,
  extensionUiResponse,
  extensionUiTitle,
  forkMessagesFromRpcData,
  isAgentSettled,
  isPiThinkingLevel,
  mergeToolInput,
  needsExtensionUiReply,
  parseExtensionUiRequest,
  parsePiModelRef,
  piNativeId,
  previewFromTool,
  providerSessionIdFromState,
  sessionFromState,
  statusFromPiEvent,
  stringField,
  summarizeToolRequest,
  toolCallDeltaFromEvent,
  toolCallEndFromEvent,
  toolCallStartFromEvent,
  toolExecutionEndFromEvent,
  toolExecutionStartFromEvent,
  toolExecutionUpdateFromEvent,
  toolKindFromName,
  toolTitle,
  tryParseJsonRecord,
  turnErrorFromEvent,
  type PiExtensionUiRequest,
} from "./piProtocol";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  RewindLastTurnInput,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";
import {
  COMPACTED_TEXT,
  COMPACTING_TEXT,
  COMPACTION_STATUS_KEY,
} from "../../../../features/sessions/model/compactionStatus";

type PendingApproval = {
  occurrenceId: string;
  request: PiExtensionUiRequest;
  resolve: (decision: ApprovalDecision) => void;
};

type InFlightTool = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  partialJson: string;
  partialJsonWork?: NativeOutputWork | null;
  partialJsonTracked?: boolean;
  title: string;
  /** Set on `tool_execution_end`; later progress updates are stale. */
  finished?: boolean;
};

import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const operationTailsBySession = new Map<string, Promise<unknown>>();

function retirementsFor(flavor: PiFlavor) {
  return createProviderRetirementLedger(`${flavor.id}.main`, killChild);
}

type Live = {
  operation?: object;
  handle: ChildProcessHandle;
  bindingWork?: NativeOutputWork | null;
  bindingTracked?: boolean;
  bindingRetired?: boolean;
  skillPolicyKey?: string;
  rpc: PiRpc;
  cwd: string;
  providerSessionId: string;
  contextWindow?: number;
  nativeModel: string;
  thinking: string;
  fastModeEnabled?: boolean;
  fastModeRequested?: boolean;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<
    number,
    QuestionDelivery & {
      id: string;
      providerCancelled?: boolean;
      resolve: (reply: UserQuestionReply) => void;
    }
  >;
  visibleQuestionId?: number;
  availableCommands?: NativeCommand[];
  promptId: string | null;
  nextApprovalUiId: number;
  toolsByIndex: Map<number, InFlightTool>;
  toolsById: Map<string, InFlightTool>;
  cancelled: boolean;
  muteUpdates: boolean;
  compacting: boolean;
  retrying: boolean;
  settling: boolean;
  settleToken: number;
  cancelGeneration: number;
  turns: Promise<void>;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  activeTurn: boolean;
  emittedAssistant: string;
  emittedReasoning: string;
  /** Reason the turn failed, held until we know it is not being retried. */
  turnError: string | null;
};

type Resume = {
  sessionId: string;
  cwd: string;
};

type Startup = {
  operation?: object;
  handle?: ChildProcessHandle;
  cleanupOwnedBySetup?: ChildProcessHandle;
  key: string;
  controller: AbortController;
  promise: Promise<Live>;
  live?: Live;
  skillProbe?: Promise<string[]>;
};

function startupWait<T>(attempt: Startup, pending: Promise<T>): Promise<T> {
  const signal = attempt.controller.signal;
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(signal.reason);
    if (signal.aborted) cancelled();
    else signal.addEventListener("abort", cancelled, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", cancelled);
        if (signal.aborted) cancelled();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancelled);
        reject(signal.aborted ? signal.reason : error);
      },
    );
  });
}

const INIT_TIMEOUT_MS = 45_000;
const STATS_TIMEOUT_MS = 4_000;
const COMPACT_TIMEOUT_MS = 30 * 60_000;

type FlavorState = {
  liveByThread: Map<string, Live>;
  startingByThread: Map<string, Startup>;
  stoppingByThread: Map<string, Promise<void>>;
  resumeByThread: Map<string, Resume>;
  cancelledThreads: Set<string>;
  resolveBinary: () => Promise<{ path: string }>;
  commandListeners: Map<string, Set<(commands: NativeCommand[]) => void>>;
};

/**
 * Pi and omp each get their own child processes and resume tables, so a live
 * session on one never collides with the other.
 */
const stateByFlavor = new Map<string, FlavorState>();

function stateFor(flavor: PiFlavor): FlavorState {
  let state = stateByFlavor.get(flavor.id);
  if (!state) {
    state = {
      liveByThread: new Map(),
      startingByThread: new Map(),
      stoppingByThread: new Map(),
      resumeByThread: new Map(),
      cancelledThreads: new Set(),
      resolveBinary: flavor.resolveBinary,
      commandListeners: new Map(),
    };
    stateByFlavor.set(flavor.id, state);
  }
  return state;
}

function commandContextKey(context: CommandContext): string {
  return `${context.sessionId ?? ""}\0${normalizeProjectPath(context.cwd)}`;
}

export const ompCommandProvider: NativeCommandProvider = {
  rawSlashCommands: true,
  async discover(context) {
    const live = context.sessionId
      ? stateFor(OMP_FLAVOR).liveByThread.get(context.sessionId)
      : undefined;
    if (!live || normalizeProjectPath(live.cwd) !== normalizeProjectPath(context.cwd)) {
      return discoverOmpCommands(context.cwd);
    }
    if (live.availableCommands) return live.availableCommands;
    const response = await live.rpc.request({ type: "get_available_commands" }, INIT_TIMEOUT_MS);
    return live.availableCommands ?? ompCommandsFromRpcData(response.data);
  },
  subscribe(context, onCommands) {
    const state = stateFor(OMP_FLAVOR);
    const key = commandContextKey(context);
    let listeners = state.commandListeners.get(key);
    if (!listeners) state.commandListeners.set(key, (listeners = new Set()));
    listeners.add(onCommands);
    const live = context.sessionId ? state.liveByThread.get(context.sessionId) : undefined;
    if (
      live?.availableCommands &&
      normalizeProjectPath(live.cwd) === normalizeProjectPath(context.cwd)
    ) {
      onCommands(live.availableCommands);
    }
    return () => {
      listeners.delete(onCommands);
      if (!listeners.size) state.commandListeners.delete(key);
    };
  },
};

/** Test seam. */
export function setPiBinaryResolver(flavor: PiFlavor, fn: () => Promise<{ path: string }>): void {
  stateFor(flavor).resolveBinary = fn;
}

/**
 * Live Pi adapter. Spawns `pi --mode rpc` with the user's config and extensions
 * loaded (no `--no-extensions`). Todos/subagents packages in `~/.pi/agent`
 * keep working; TUI-only widgets do not appear in Bycoda.
 */
export async function sendTurn(flavor: PiFlavor, input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);
  stateFor(flavor).cancelledThreads.delete(input.sessionId);

  input = { ...input };

  try {
    const state = stateFor(flavor);
    const original =
      state.liveByThread.get(input.sessionId) ?? state.startingByThread.get(input.sessionId);
    const originalHandle = original?.handle;
    if (originalHandle) observeProviderProcess(input, originalHandle);
    return await queueProviderOperation(
      operationTailsBySession,
      `${flavor.id}\0${input.sessionId}`,
      input.operationContext,
      async () => {
        const { cancelledThreads } = stateFor(flavor);
        let live: Live;
        try {
          live = await ensureLive(flavor, input);
        } catch (error) {
          cancelledThreads.delete(input.sessionId);
          throw error;
        }
        if (cancelledThreads.delete(input.sessionId)) {
          input.onEvent({ type: "status", text: "The message was stopped before it was sent." });
          return;
        }

        observeProviderProcess(input, live.handle);
        const bindWriter = capturePiTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        );
        live.turns = continueAfterFailure(live.turns, async () => {
          const rpc = await bindWriter();
          live.onEvent = input.onEvent;
          live.cancelled = false;
          live.muteUpdates = false;
          try {
            await runTurn(flavor, live, input, rpc);
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

export async function compactContext(flavor: PiFlavor, input: CompactContextInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  try {
    const state = stateFor(flavor);
    const original =
      state.liveByThread.get(input.sessionId) ?? state.startingByThread.get(input.sessionId);
    const queuedLive = state.liveByThread.get(input.sessionId);
    const cancellationToken = queuedLive?.cancelGeneration;
    const cancelledAtStart = queuedLive?.cancelled ?? false;
    const originalHandle = original?.handle;
    if (originalHandle) observeProviderProcess(input, originalHandle);
    return await queueProviderOperation(
      operationTailsBySession,
      `${flavor.id}\0${input.sessionId}`,
      input.operationContext,
      async () => {
        const state = stateFor(flavor);
        let live = state.liveByThread.get(input.sessionId);
        if (queuedLive && live === queuedLive && live.cancelGeneration !== cancellationToken)
          return;
        if (!live || live.cwd !== input.cwd) {
          live = await ensureLive(flavor, input);
        }
        if (state.cancelledThreads.delete(input.sessionId)) return;

        observeProviderProcess(input, live.handle);
        const bindWriter = capturePiTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        );
        live.turns = continueAfterFailure(live.turns, async () => {
          if (
            state.cancelledThreads.delete(input.sessionId) ||
            (queuedLive === live &&
              cancellationToken !== undefined &&
              live.cancelGeneration !== cancellationToken)
          )
            return;
          const rpc = await bindWriter();
          live.onEvent = input.onEvent;
          await applyModel(flavor, live, input, rpc);
          if (cancelledAtStart) live.cancelled = false;
          live.muteUpdates = false;
          const response = await rpc.request({ type: "compact" }, COMPACT_TIMEOUT_MS);
          const data = asRecord(response.data);
          const used = data?.estimatedTokensAfter;
          if (typeof used === "number" && Number.isFinite(used) && used > 0) {
            live.onEvent({
              type: "context",
              used,
              ...(live.contextWindow ? { window: live.contextWindow } : {}),
            });
          }
        });
        await live.turns;
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function rewindLastTurn(
  flavor: PiFlavor,
  input: RewindLastTurnInput,
): Promise<{ submitted: boolean }> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  try {
    const state = stateFor(flavor);
    const original =
      state.liveByThread.get(input.sessionId) ?? state.startingByThread.get(input.sessionId);
    const originalHandle = original?.handle;
    if (originalHandle) observeProviderProcess(input, originalHandle);
    return await queueProviderOperation(
      operationTailsBySession,
      `${flavor.id}\0${input.sessionId}`,
      input.operationContext,
      async () => {
        const state = stateFor(flavor);
        let live = state.liveByThread.get(input.sessionId);
        const cancelledAtStart = live?.cancelled ?? false;
        const cancellationToken = live?.cancelGeneration;
        if (!live || live.cwd !== input.cwd) {
          live = await ensureLive(flavor, input);
        }
        if (live.activeTurn) {
          throw new Error("Stop the current turn before editing the last message");
        }

        if (
          state.cancelledThreads.delete(input.sessionId) ||
          (cancellationToken !== undefined && live.cancelGeneration !== cancellationToken)
        ) {
          throw new Error("Edit cancelled");
        }
        if (cancelledAtStart) live.cancelled = false;
        observeProviderProcess(input, live.handle);
        const rpc = await capturePiTurnWriter(
          live.handle,
          live.rpc,
          input.nativeControlTurn,
          input.operationContext,
        )();
        live.onEvent = input.onEvent;
        await applyModel(flavor, live, input, rpc);
        const forkMessages = await rpc.request({ type: "get_fork_messages" });
        const messages = forkMessagesFromRpcData(forkMessages.data);
        const last = messages[messages.length - 1];
        if (!last) throw new Error("No user message to edit");

        if (
          state.cancelledThreads.delete(input.sessionId) ||
          (cancellationToken !== undefined && live.cancelGeneration !== cancellationToken)
        ) {
          throw new Error("Edit cancelled");
        }
        const fork = await rpc.request({ type: "fork", entryId: last.entryId });
        if (asRecord(fork.data)?.cancelled === true) {
          throw new Error("Edit cancelled");
        }
        const forkState = await rpc.request({ type: "get_state" });
        const providerSessionId = providerSessionIdFromState(forkState.data);
        if (!providerSessionId) {
          throw new Error("Pi did not expose the forked session");
        }
        bindState(flavor, input.sessionId, live, forkState.data);
        live.onEvent({ type: "session.providerBound", providerSessionId });
        return { submitted: false };
      },
    );
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function steerTurn(flavor: PiFlavor, input: SteerTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  const live = stateFor(flavor).liveByThread.get(input.sessionId);
  if (!live?.activeTurn) throw new Error("The previous turn has finished. Send this follow-up as a new message.");
  if (!ownsOperation(input.operationContext, live.handle, live.operation))
    throw new Error("Provider operation replaced before steer");
  const rpc = await piTurnWriter(
    live.handle,
    live.rpc,
    input.nativeControlTurn,
    input.operationContext,
  );
  const message = input.text.trim();
  const buildCommand =
    flavor.id === "omp" && message.startsWith("/")
      ? (input: Parameters<typeof buildPiPrompt>[0]) => buildPiPrompt({ ...input, streaming: true })
      : buildPiSteer;
  const command = buildCommand({
    text: message,
    attachments: input.attachments,
  });
  if (!command.message && !Array.isArray(command.images)) return;
  await rpc.request(command);
}

export function respondApproval(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  approvalOccurrenceId?: string,
): void {
  const live = stateFor(flavor).liveByThread.get(sessionId);
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

export function respondQuestion(
  flavor: PiFlavor,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  const live = stateFor(flavor).liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  if (!live || !pending) return;
  deliverQuestionReply(
    pending,
    requestId,
    reply,
    live.onEvent,
    () => live.questions.get(requestId) === pending && !live.cancelled && !live.muteUpdates,
    () => pending.resolve(reply),
  );
}

export async function cancelTurn(
  flavor: PiFlavor,
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const { liveByThread, startingByThread } = stateFor(flavor);
  if (startingByThread.has(sessionId)) {
    await stopSession(flavor, sessionId, context);
    return;
  }
  const live = liveByThread.get(sessionId);
  // A captured cancellation must not affect a newer operation.
  if (!ownsOperation(context, live?.handle, live?.operation)) return;
  if (!live) {
    return;
  }
  const rpc = context
    ? await piTurnWriter(live.handle, live.rpc, context.nativeControlTurn, context, "control")
    : live.rpc;
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.cancelled = true;
  retireToolFragments(live, "pi-fragment-cancelled");
  live.cancelGeneration += 1;
  live.muteUpdates = true;
  live.settleToken += 1;
  for (const [, pending] of live.approvals) pending.resolve("deny");
  live.approvals.clear();
  for (const question of live.questions.values()) {
    // Release extension dialogs before aborting their workflow. Never overwrite an
    // answer whose delivery is already in flight or uncertain.
    if (!question.sending) await question.deliver?.({ kind: "skipped" }).catch(() => undefined);
    if (!ownsOperation(context, live.handle, live.operation)) return;
    question.resolve({ kind: "skipped" });
  }
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.questions.clear();
  await rpc.request({ type: "abort" }, 5_000).catch(() => undefined);
  if (!ownsOperation(context, live.handle, live.operation)) return;
  finishActiveTurn(live, [{ type: "message.completed" }, { type: "reasoning.completed" }]);
}

function captureStop(flavor: PiFlavor, sessionId: string) {
  const state = stateFor(flavor);
  return {
    starting: state.startingByThread.get(sessionId),
    live: state.liveByThread.get(sessionId),
    pending: state.stoppingByThread.get(sessionId),
    cohort: retirementsFor(flavor).cohort(sessionId),
  };
}
export function stopSession(
  flavor: PiFlavor,
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return Promise.resolve();

  return stopCaptured(flavor, sessionId, captureStop(flavor, sessionId), context);
}
function stopCaptured(
  flavor: PiFlavor,
  sessionId: string,
  captured: ReturnType<typeof captureStop>,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return Promise.resolve();

  const { liveByThread, startingByThread, stoppingByThread, cancelledThreads } = stateFor(flavor);
  const starting = ownsOperation(context, captured.starting?.handle, captured.starting?.operation)
    ? captured.starting
    : undefined;
  const live = ownsOperation(context, captured.live?.handle, captured.live?.operation)
    ? captured.live
    : undefined;
  if (context && !starting && !live) return Promise.resolve();
  const pending = captured.pending;
  cancelledThreads.delete(sessionId);
  if (startingByThread.get(sessionId) === starting) startingByThread.delete(sessionId);
  starting?.controller.abort(new Error(`${flavor.label} startup cancelled`));
  if (liveByThread.get(sessionId) === live) liveByThread.delete(sessionId);
  if (live) closeLive(live);
  if (starting?.live && starting.live !== live) closeLive(starting.live);
  const handles = new Set([live?.handle, starting?.handle, starting?.live?.handle]);
  const stopping = settleProviderRetirements([
    ...(pending ? [pending] : []),
    ...(context ? [] : [captured.cohort.retire()]),
    retirementsFor(flavor).retire(handles),
    ...(starting?.skillProbe ? [observeProviderProbeCleanup(starting.skillProbe)] : []),
  ]).finally(() => {
    if (stoppingByThread.get(sessionId) === stopping) stoppingByThread.delete(sessionId);
  });
  stoppingByThread.set(sessionId, stopping);
  // A superseding start may abort before reaching its captured wait; the exact
  // failure remains in the retirement ledger and this is only an observer.
  void stopping.catch(() => {});
  return stopping;
}

function closeLive(live: Live): void {
  if (live) {
    live.bindingRetired = true;
    retirePiBinding(live, "pi-binding-session-retired");
    retireToolFragments(live, "pi-fragment-session-retired");
    live.cancelled = true;
    live.muteUpdates = true;
    live.settleToken += 1;
    for (const [, pending] of live.approvals) pending.resolve("deny");
    live.approvals.clear();
    for (const question of live.questions.values()) question.resolve({ kind: "skipped" });
    live.questions.clear();
    live.activeTurn = false;
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
    live.rpc.close();
  }
}

export async function forgetSession(
  flavor: PiFlavor,
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  // Delete/switch must end the process: clear resume state first and stop by
  // session when the context no longer owns it.
  const state = stateFor(flavor);
  state.resumeByThread.delete(sessionId);
  const queuedOnly = cancelQueuedOperation(context);
  const original = state.liveByThread.get(sessionId) ?? state.startingByThread.get(sessionId);
  const owned =
    !queuedOnly && (!original || ownsOperation(context, original.handle, original.operation));
  await stopSession(flavor, sessionId, owned ? context : undefined);
}

export function bindSession(
  flavor: PiFlavor,
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const sessionId = providerSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  stateFor(flavor).resumeByThread.set(threadId, { sessionId, cwd });
}

async function ensureLive(
  flavor: PiFlavor,
  input: HarnessSessionInput,
  retriedSharedStartup = false,
): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const state = stateFor(flavor);
  const { resumeByThread, startingByThread } = state;
  const key = JSON.stringify([
    input.cwd,
    input.intent,
    input.model,
    input.modelSettings,
    input.skillPolicy,
  ]);
  const captured = captureStop(flavor, input.sessionId);
  const { starting, live: existing } = captured;
  if (starting?.key === key) {
    let live: Live;
    try {
      live = await starting.promise;
    } catch (error) {
      // The shared startup was cancelled by another caller; start a fresh one
      // once instead of inheriting that cancellation.
      if (retriedSharedStartup || !starting.controller.signal.aborted) throw error;
      return ensureLive(flavor, input, true);
    }
    observeProviderProcess(input, live.handle);
    return live;
  }
  const wantPlanning = input.intent === "plan";
  if (
    !starting &&
    existing &&
    existing.cwd === input.cwd &&
    existing.planning === wantPlanning &&
    existing.skillPolicyKey === JSON.stringify(input.skillPolicy)
  ) {
    observeProviderProcess(input, existing.handle);
    return existing;
  }
  const handle = retirementsFor(flavor).admitPending(
    createChildProcessHandle(input.sessionId, input.nativeControlTurn),
  );
  observeProviderProcess(input, handle, "starting");
  const attempt: Startup = {
    key,
    handle,
    operation: input.operationContext?.operation,
    controller: new AbortController(),
    promise: undefined!,
  };
  startingByThread.set(input.sessionId, attempt);
  if (existing && existing.cwd !== input.cwd) resumeByThread.delete(input.sessionId);
  const stopping =
    captured.cohort.size || captured.starting || captured.live || captured.pending
      ? stopCaptured(flavor, input.sessionId, captured)
      : undefined;
  attempt.promise = Promise.resolve()
    .then(async () => {
      attempt.controller.signal.throwIfAborted();
      if (stopping) await startupWait(attempt, stopping);
      attempt.controller.signal.throwIfAborted();
      const resume = resumeByThread.get(input.sessionId);
      const canResume = resume != null && resume.cwd === input.cwd;
      if (resume && !canResume) resumeByThread.delete(input.sessionId);
      try {
        return await startLive(flavor, input, canResume ? resume?.sessionId : undefined, attempt);
      } catch (error) {
        attempt.controller.signal.throwIfAborted();
        assertOptionalProviderProbeError(error);
        if (!canResume) throw error;
        resumeByThread.delete(input.sessionId);
        attempt.handle = retirementsFor(flavor).admit(
          createChildProcessHandle(input.sessionId, input.nativeControlTurn),
        );
        observeProviderProcess(input, attempt.handle, "starting");
        return startLive(flavor, input, undefined, attempt);
      }
    })
    .catch((error) => {
      if (attempt.cleanupOwnedBySetup === attempt.handle) throw error;
      return preserveProviderFailure(error, retirementsFor(flavor).retire([attempt.handle]));
    })
    .finally(() => {
      if (startingByThread.get(input.sessionId) === attempt)
        startingByThread.delete(input.sessionId);
    });
  return attempt.promise;
}

async function startLive(
  flavor: PiFlavor,
  input: HarnessSessionInput,
  resume: string | undefined,
  attempt: Startup,
): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const state = stateFor(flavor);
  const { liveByThread } = state;
  attempt.controller.signal.throwIfAborted();
  const handle = attempt.handle;
  if (!handle) throw new Error("Provider startup has no original reserved construction");
  const liveRef: { current: Live | null } = { current: null };
  attempt.cleanupOwnedBySetup = handle;
  try {
    attempt.handle = handle;
    const { path } = await startupWait(attempt, state.resolveBinary());
    attempt.controller.signal.throwIfAborted();
    const native = nativeModelId(input.model);
    const modelRef = parsePiModelRef(native);

    const rpc = new PiRpc(
      handle,
      (rec) => {
        const current = liveRef.current;
        if (!current) return;
        handleFrame(flavor, input.sessionId, current, rec);
      },
      flavor.label,
    );

    const live: Live = {
      operation: input.operationContext?.operation,
      handle,
      skillPolicyKey: JSON.stringify(input.skillPolicy),
      rpc,
      cwd: input.cwd,
      providerSessionId: resume ?? "",
      nativeModel: native,
      thinking: input.modelSettings?.thinking ?? "",
      fastModeEnabled: undefined,
      fastModeRequested: undefined,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      questions: new Map(),
      promptId: null,
      nextApprovalUiId: 1,
      toolsByIndex: new Map(),
      toolsById: new Map(),
      cancelled: false,
      muteUpdates: false,
      compacting: false,
      retrying: false,
      settling: false,
      settleToken: 0,
      cancelGeneration: 0,
      turns: Promise.resolve(),
      turnDone: null,
      turnFailed: null,
      turnEndPending: false,
      activeTurn: false,
      emittedAssistant: "",
      emittedReasoning: "",
      turnError: null,
    };
    attempt.live = live;
    liveRef.current = live;
    let skillPaths: string[] | undefined;
    if (
      input.skillPolicy &&
      (input.skillPolicy.disabledNames.length || input.skillPolicy.disabledPaths.length)
    ) {
      attempt.skillProbe = allowedPiSkillPaths(
        flavor,
        input.cwd,
        input.skillPolicy,
        attempt.controller.signal,
        input.sessionId,
      );
      skillPaths = await startupWait(attempt, attempt.skillProbe);
    }
    attempt.controller.signal.throwIfAborted();
    watchChild(
      handle,
      (line) => rpc.pushLine(line),
      (code) => {
        live.bindingRetired = true;
        retirePiBinding(live, "pi-binding-process-exited");
        retireToolFragments(live, "pi-fragment-process-exited");
        rpc.close(new Error(`${flavor.label} exited`));
        if (liveByThread.get(input.sessionId) === live) liveByThread.delete(input.sessionId);
        const current = liveRef.current;
        if (!current?.muteUpdates) {
          (current?.onEvent ?? input.onEvent)({ type: "session.ended", code });
        }
        if (current) {
          for (const question of current.questions.values()) question.resolve({ kind: "skipped" });
          for (const approval of current.approvals.values()) approval.resolve("deny");
        }
        current?.turnFailed?.(new Error(`${flavor.label} exited`));
        if (current) {
          current.turnDone = null;
          current.turnFailed = null;
        }
      },
      (line) => {
        console.debug(`[${flavor.id}]`, line);
      },
    );

    await startupWait(
      attempt,
      spawnChild(
        handle,
        path,
        buildPiSpawnArgs(flavor, {
          resume,
          model: modelRef ? native : undefined,
          plan: input.intent === "plan",
          ...(skillPaths ? { skillPaths } : {}),
        }),
        input.cwd,
        undefined,
        flavor.id,
      ),
    );
    attempt.controller.signal.throwIfAborted();

    liveByThread.set(input.sessionId, live);

    const startupRpc = await startupWait(
      attempt,
      piTurnWriter(handle, rpc, input.nativeControlTurn, input.operationContext),
    );
    await startupWait(
      attempt,
      startupRpc.request({ type: "get_state" }, INIT_TIMEOUT_MS, (stateFrame, work) => {
        attempt.controller.signal.throwIfAborted();
        return consumePiBindingResponse(live, stateFrame, work, () =>
          bindState(flavor, input.sessionId, live, stateFrame.data),
        );
      }),
    );
    attempt.controller.signal.throwIfAborted();
    await startupWait(attempt, applyModel(flavor, live, input, startupRpc));
    attempt.controller.signal.throwIfAborted();
    if (live.providerSessionId) {
      emitPiBindingEvent(live, {
        type: "session.providerBound",
        providerSessionId: live.providerSessionId,
      });
    }
    emitPiBindingEvent(live, { type: "session.started" });
    return live;
  } catch (error) {
    const live = liveRef.current;
    if (live) closeLive(live);
    // Physical cleanup stays on this attempt even after a successor owns the slot.
    if (live && liveByThread.get(input.sessionId) === live) liveByThread.delete(input.sessionId);
    return preserveProviderFailure(error, retirementsFor(flavor).retire([handle]));
  }
}

async function runTurn(
  flavor: PiFlavor,
  live: Live,
  input: SendTurnInput,
  rpc: PiRpcWriterView,
): Promise<void> {
  await applyModel(flavor, live, input, rpc);
  live.emittedAssistant = "";
  live.emittedReasoning = "";
  live.turnError = null;
  retireToolFragments(live, "pi-fragment-turn-replaced");
  live.toolsByIndex.clear();
  live.toolsById.clear();
  live.compacting = false;
  live.retrying = false;
  live.settleToken += 1;
  live.settling = false;
  const promptId = `mc_turn_${crypto.randomUUID()}`;
  live.promptId = promptId;

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  live.activeTurn = true;
  settlePendingTurn(live);

  try {
    const response = await Promise.race([
      rpc.request(
        {
          ...buildPiPrompt({
            text: input.text,
            attachments: input.attachments,
          }),
          id: promptId,
        },
        flavor.id === "omp" ? COMPACT_TIMEOUT_MS : 15_000,
      ),
      turnPromise.then(() => null),
    ]);
    input.onAccepted?.();
    if (flavor.id === "omp" && asRecord(response?.data)?.agentInvoked === false) {
      finishActiveTurn(live, [{ type: "message.completed" }, { type: "reasoning.completed" }]);
    }
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    live.onEvent({
      type: "session.error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    retireToolFragments(live, "pi-fragment-turn-retired");
    live.activeTurn = false;
    live.promptId = null;
    rpc.cancelRequest(promptId);
    live.turnDone = null;
    live.turnFailed = null;
  }
}

/**
 * OMP's advisor and extensions interject mid-turn. Frames marked display:true
 * exist so clients can show them: structured advisor notes replace the raw
 * advisory envelope when present, and even a blank body stays a labeled
 * boundary so the segments around it never silently merge.
 */
function customMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}

function interjectionFromCustomMessage(
  message: Record<string, unknown>,
): Extract<HarnessEvent, { type: "interjection" }> | undefined {
  if (message.display !== true) return undefined;
  const customType = stringField(message, "customType") ?? "custom";
  if (customType === "advisor") {
    const notes = asRecord(message.details)?.notes;
    const bodies: string[] = [];
    let severity: Extract<HarnessEvent, { type: "interjection" }>["severity"];
    if (Array.isArray(notes)) {
      for (const raw of notes) {
        const note = asRecord(raw);
        const body = stringField(note, "note");
        if (!body) continue;
        bodies.push(body);
        // Keep the highest severity the retained notes actually carry.
        const level = note?.severity;
        if (level === "blocker") severity = "blocker";
        else if (level === "concern" && severity !== "blocker") {
          severity = "concern";
        } else if (level === "nit" && !severity) severity = "nit";
      }
    }
    if (bodies.length > 0) {
      return {
        type: "interjection",
        text: bodies.join("\n\n"),
        customType,
        ...(severity ? { severity } : {}),
      };
    }
  }
  return {
    type: "interjection",
    text: customMessageText(message.content),
    customType,
  };
}

function handleFrame(
  flavor: PiFlavor,
  sessionId: string,
  live: Live,
  rec: Record<string, unknown>,
): void {
  if (flavor.id === "omp" && rec.type === "available_commands_update") {
    try {
      live.availableCommands = ompCommandsFromRpcData(rec);
      const listeners = stateFor(flavor).commandListeners.get(
        commandContextKey({ sessionId, cwd: live.cwd }),
      );
      for (const listener of listeners ?? []) listener(live.availableCommands);
    } catch {
      // Preserve the last valid inventory when a runtime emits a malformed update.
    }
    return;
  }
  if (flavor.id === "omp" && rec.type === "extension_ui_request" && rec.method === "cancel") {
    for (const question of live.questions.values()) {
      if (question.id === rec.id) {
        question.providerCancelled = true;
        question.resolve({ kind: "skipped" });
      }
    }
    return;
  }
  const ui = parseExtensionUiRequest(rec);
  if (ui) {
    void handleExtensionUi(flavor, sessionId, live, ui);
    return;
  }
  if (live.muteUpdates) return;

  const type = stringField(rec, "type");
  if (flavor.id === "omp") {
    // OMP emits persisted custom_message entries on the live RPC stream as a
    // message_start/message_end pair. Render the start once; consume the end
    // and hidden custom messages so none can leak through a generic path.
    if (type === "message_start" || type === "message_end") {
      const message = asRecord(rec.message);
      if (message?.role === "custom") {
        if (type === "message_start") {
          const interjection = interjectionFromCustomMessage(message);
          if (interjection) live.onEvent(interjection);
        }
        return;
      }
    }
    if (type === "advisor_yielded") {
      live.onEvent({ type: "status", text: "Advisor reviewed this turn" });
      return;
    }
    if (type === "session_info_update") {
      const providerSessionId = stringField(rec, "sessionId");
      if (providerSessionId) {
        const work = captureNativeOutputWork();
        try {
          rememberPiBindingInput(live, work);
          bindState(flavor, sessionId, live, { sessionId: providerSessionId });
          emitPiBindingEvent(live, { type: "session.providerBound", providerSessionId });
        } finally {
          work?.finish();
        }
      }
      return;
    }
    if (type === "config_update") {
      const work = captureNativeOutputWork();
      try {
        rememberPiBindingInput(live, work);
        const model = asRecord(rec.model);
        const provider = stringField(model, "provider");
        const modelId = stringField(model, "id");
        const thinking = stringField(rec, "thinkingLevel");
        const fastModeEnabled =
          typeof rec.fastModeEnabled === "boolean" ? rec.fastModeEnabled : undefined;
        const native = provider && modelId ? piNativeId(provider, modelId) : undefined;
        if (native && native !== live.nativeModel) {
          live.nativeModel = native;
          // Capacity belongs to the active model, never the previous model.
          const capacity = model?.contextWindow;
          live.contextWindow =
            typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0
              ? capacity
              : undefined;
        }
        if (isPiThinkingLevel(thinking)) live.thinking = thinking;
        if (fastModeEnabled != null) {
          live.fastModeEnabled = fastModeEnabled;
          live.fastModeRequested = fastModeEnabled;
        }
        emitPiBindingEvent(live, {
          type: "session.configChanged",
          ...(native ? { model: `${flavor.id}:${native}` } : {}),
          ...(isPiThinkingLevel(thinking) || fastModeEnabled != null
            ? {
                modelSettings: {
                  ...(isPiThinkingLevel(thinking) ? { thinking } : {}),
                  ...(fastModeEnabled != null ? { fast: String(fastModeEnabled) } : {}),
                },
              }
            : {}),
        });
      } finally {
        work?.finish();
      }
      return;
    }
    if (type === "command_output") {
      const text = stringField(rec, "text");
      if (text)
        live.onEvent({
          type: "status",
          text: extensionUiTitle({
            id: "output",
            method: "notify",
            title: text,
          }),
        });
      return;
    }
    if (type === "prompt_result") {
      if (live.activeTurn && rec.id === live.promptId && rec.agentInvoked === false) {
        finishActiveTurn(live, [{ type: "message.completed" }, { type: "reasoning.completed" }]);
      }
      return;
    }
    // OMP can acknowledge a prompt and later report an asynchronous error.
    if (
      type === "response" &&
      rec.command === "prompt" &&
      rec.id === live.promptId &&
      rec.success === false
    ) {
      live.turnFailed?.(new Error(stringField(rec, "error") ?? "OMP command failed"));
      return;
    }
    if (type === "agent_end" && rec.isTerminal === false) return;
  }
  if (type === "compaction_start") live.compacting = true;
  if (type === "compaction_end") live.compacting = false;
  if (type === "auto_retry_start") live.retrying = true;
  if (type === "auto_retry_end") live.retrying = false;

  // One keyed row follows the compaction: running, then settled or closed.
  if (type === "compaction_start") {
    live.onEvent({
      type: "status",
      key: COMPACTION_STATUS_KEY,
      running: true,
      text: COMPACTING_TEXT,
    });
  } else if (type === "compaction_end") {
    const failed = rec.aborted === true || !!stringField(rec, "errorMessage");
    live.onEvent({
      type: "status",
      key: COMPACTION_STATUS_KEY,
      running: false,
      text: failed ? "" : COMPACTED_TEXT,
    });
    const reason = stringField(rec, "errorMessage");
    if (reason) live.onEvent({ type: "status", text: `Could not compact context: ${reason}` });
  } else {
    const status = statusFromPiEvent(rec);
    if (status) live.onEvent({ type: "status", text: status });
  }

  const turnError = turnErrorFromEvent(rec);
  if (turnError !== null) live.turnError = turnError;

  const context = contextFromUsage(rec, live.contextWindow);
  if (context) emitPiBindingEvent(live, { type: "context", ...context });
  const metrics = turnMetricsFromUsage(rec);
  if (metrics) live.onEvent({ type: "turn.metrics", ...metrics });

  const delta = assistantDeltaFromEvent(rec);
  if (delta) {
    if (delta.kind === "text") {
      live.emittedAssistant += delta.text;
      live.onEvent({ type: "message.delta", text: delta.text });
    } else {
      live.emittedReasoning += delta.text;
      live.onEvent({ type: "reasoning.delta", text: delta.text });
    }
  }

  const started = toolCallStartFromEvent(rec);
  if (started) {
    upsertTool(live, started.id, started.name, {}, started.index);
  }

  const jsonDelta = toolCallDeltaFromEvent(rec);
  if (jsonDelta) {
    const tool = live.toolsByIndex.get(jsonDelta.index);
    if (tool) {
      const current = captureNativeOutputWork({ label: "pi-tool-json-fragment" });
      if (tool.partialJsonTracked === undefined) tool.partialJsonTracked = current !== null;
      if (!current || !tool.partialJsonTracked) {
        tool.partialJsonWork?.fail("pi-fragment-untracked");
        current?.fail("pi-fragment-untracked");
        tool.partialJsonWork = null;
        tool.partialJsonTracked = false;
      } else if (tool.partialJsonWork) {
        const previous = tool.partialJsonWork;
        const joined = joinNativeOutputWorks([previous, current], sessionId);
        if (joined) {
          previous.finish();
          current.finish();
        } else {
          previous.fail("pi-fragment-join-failed");
          current.fail("pi-fragment-join-failed");
        }
        tool.partialJsonWork = joined;
        tool.partialJsonTracked = joined !== null;
      } else tool.partialJsonWork = current;
      tool.partialJson += jsonDelta.delta;
      const parsed = tryParseJsonRecord(tool.partialJson);
      if (parsed) {
        if (tool.partialJsonWork) tool.partialJsonWork.run(() => updateTool(live, tool, parsed));
        else runWithoutNativeOutputOrigin(() => updateTool(live, tool, parsed));
      }
    }
  }

  const ended = toolCallEndFromEvent(rec);
  if (ended) {
    upsertTool(live, ended.id, ended.name, ended.input);
    const tool = live.toolsById.get(ended.id);
    if (tool) retireToolFragment(tool, "pi-fragment-incomplete-final");
  }

  const execStart = toolExecutionStartFromEvent(rec);
  if (execStart) {
    upsertTool(live, execStart.id, execStart.name, execStart.input);
    const tool = live.toolsById.get(execStart.id);
    if (tool) {
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: "running",
        preview: previewFromTool(tool.name, tool.input),
      });
    }
  }

  const execUpdate = toolExecutionUpdateFromEvent(rec);
  if (execUpdate) {
    const tool = live.toolsById.get(execUpdate.id);
    // omp can deliver an update after the tool's end (omp#12875, steer during
    // bash); replaying it would flip the finished card back to "running".
    if (tool && !tool.finished) {
      if (Object.keys(execUpdate.input).length > 0) {
        tool.input = mergeToolInput(tool.input, execUpdate.input);
        tool.title = toolTitle(tool.name, tool.input);
      }
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: "running",
        detail: execUpdate.detail,
        preview: previewFromTool(tool.name, tool.input, execUpdate.detail),
      });
      if (toolKindFromName(tool.name) === "agent") {
        for (const event of piSubagentEvents(tool.id, tool.input, rec.partialResult, false))
          live.onEvent(event);
      }
    }
  }

  const execEnd = toolExecutionEndFromEvent(rec);
  if (execEnd) {
    const tool = live.toolsById.get(execEnd.id);
    if (tool) {
      tool.finished = true;
      live.onEvent({
        type: "tool.updated",
        callId: tool.id,
        title: tool.title,
        kind: toolKindFromName(tool.name),
        status: execEnd.isError ? "failed" : "completed",
        detail: execEnd.detail,
        preview: previewFromTool(tool.name, tool.input, execEnd.detail),
      });
      if (toolKindFromName(tool.name) === "agent") {
        for (const event of piSubagentEvents(
          tool.id,
          tool.input,
          rec.result,
          true,
          execEnd.isError,
        ))
          live.onEvent(event);
      }
    }
  }

  if (isAgentSettled(rec)) {
    flushTurnError(flavor, live);
    void settleTurn(live);
    return;
  }
  const willRetry = agentEndWillRetry(rec);
  // The retry carries the real answer, so the attempt it replaces stays quiet.
  if (willRetry === true) live.turnError = null;
  if (willRetry === false && !live.compacting && !live.retrying) {
    flushTurnError(flavor, live);
    void settleTurn(live);
  }
}

function flushTurnError(flavor: PiFlavor, live: Live): void {
  const message = live.turnError;
  if (message === null) return;
  live.turnError = null;
  live.onEvent({
    type: "session.error",
    message: message || `${flavor.label} turn failed`,
  });
}

async function settleTurn(live: Live): Promise<void> {
  return runNativeOutputWork(async (outputWork) => {
    if (live.settling || live.cancelled || live.muteUpdates) return;
    if (!live.activeTurn && !live.turnDone) return;
    live.settling = true;
    const token = live.settleToken;
    try {
      await live.rpc.request({ type: "get_session_stats" }, STATS_TIMEOUT_MS, (stats, work) => {
        if (live.settleToken === token && !live.cancelled) {
          const context = contextFromSessionStats(stats.data);
          if (context)
            nativeOutputSink(work, () => live.onEvent({ type: "context", ...context }))();
        }
        return stats;
      });
    } catch {
      // meter stays on the last streamed usage
    }
    if (live.settleToken === token && !live.cancelled) {
      nativeOutputSink(outputWork, finishActiveTurn)(live, [
        { type: "message.completed" },
        { type: "reasoning.completed" },
      ]);
    }
    if (live.settleToken === token) live.settling = false;
  });
}

async function handleExtensionUi(
  flavor: PiFlavor,
  _sessionId: string,
  live: Live,
  request: PiExtensionUiRequest,
): Promise<void> {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
      if (!needsExtensionUiReply(request)) {
        const text = request.title ? extensionUiTitle(request) : "";
        if (request.method === "setStatus" && request.statusKey)
          emitNative({ type: "status", key: request.statusKey, text });
        else if (text.trim()) emitNative({ type: "status", text });
        return;
      }

      if (live.cancelled || live.muteUpdates) {
        await nativeOutputSink(outputWork, writeChild)(
          live.handle,
          JSON.stringify(extensionUiResponse(request, "deny")),
        ).catch(() => undefined);
        return;
      }

      if (
        flavor.id === "omp" &&
        (request.method === "select" || request.method === "input" || request.method === "editor")
      ) {
        const uiId = live.nextApprovalUiId++;
        const replyPromise = new Promise<UserQuestionReply>((resolve) => {
          live.questions.set(uiId, {
            id: request.id,
            resolve,
            deliver: async (reply) => {
              let value: string | undefined;
              if (reply.kind === "answered") {
                if (request.method === "select") {
                  const selected = reply.answers[request.id]?.[0];
                  if (selected !== undefined && /^\d+$/.test(selected))
                    value = request.options[Number(selected)];
                } else value = reply.custom?.[request.id];
              }
              await nativeOutputSink(outputWork, writeChild)(
                live.handle,
                JSON.stringify({
                  type: "extension_ui_response",
                  id: request.id,
                  ...(value === undefined ? { cancelled: true } : { value }),
                }),
              );
            },
          });
        });
        const event: Extract<HarnessEvent, { type: "question.asked" }> = {
          type: "question.asked",
          requestId: uiId,
          title: extensionUiTitle(request),
          behavior: "blocking",
          dismissAction: "cancel",
          questions: [
            {
              id: request.id,
              prompt: extensionUiTitle(request),
              multiSelect: false,
              allowCustom: request.method !== "select",
              options:
                request.method === "select"
                  ? request.options.map((label, index) => ({
                      id: String(index),
                      label: extensionUiTitle({
                        id: request.id,
                        method: "notify",
                        title: label,
                      }),
                    }))
                  : [],
            },
          ],
        };
        captureNativeOutputWorkEvent(outputWork, event);
        live.questions.get(uiId)!.event = event;
        showNextQueuedQuestion(live);
        const reply = await replyPromise;
        const providerCancelled = live.questions.get(uiId)?.providerCancelled;
        live.questions.delete(uiId);
        let value: string | undefined;
        if (reply.kind === "answered") {
          if (request.method === "select") {
            const selected = reply.answers[request.id]?.[0];
            if (selected !== undefined && /^\d+$/.test(selected))
              value = request.options[Number(selected)];
          } else {
            value = reply.custom?.[request.id];
          }
        }
        emitNative({
          type: "question.resolved",
          requestId: uiId,
          decision:
            live.cancelled || live.muteUpdates || providerCancelled
              ? "cancelled"
              : value === undefined
                ? "skipped"
                : "answered",
          ...(value !== undefined && reply.kind === "answered" ? { reply } : {}),
        });
        showNextQueuedQuestion(live);
        return;
      }

      const uiId = live.nextApprovalUiId++;
      const occurrenceId = createApprovalOccurrenceId();
      const pending = new Promise<ApprovalDecision>((resolve) => {
        live.approvals.set(uiId, { request, occurrenceId, resolve });
      });
      emitNative({
        type: "approval.requested",
        requestId: uiId,
        occurrenceId,
        title: extensionUiTitle(request),
        kind: "other",
      });
      const decision = await pending;
      if (live.approvals.get(uiId)?.occurrenceId === occurrenceId) live.approvals.delete(uiId);
      emitNative({ type: "approval.resolved", requestId: uiId, occurrenceId, decision });
      if (!Array.from(stateFor(flavor).liveByThread.values()).includes(live)) return;
      await nativeOutputSink(outputWork, writeChild)(
        live.handle,
        JSON.stringify(extensionUiResponse(request, decision)),
      ).catch(() => undefined);
    },
    { additionalInput: true },
  );
}

async function applyModel(
  flavor: PiFlavor,
  live: Live,
  input: HarnessSessionInput,
  rpc: PiRpcWriterView,
): Promise<void> {
  const native = nativeModelId(input.model);
  const ref = parsePiModelRef(native);
  if (ref && native !== live.nativeModel) {
    await rpc.request(
      {
        type: "set_model",
        provider: ref.provider,
        modelId: ref.modelId,
      },
      undefined,
      (result, work) =>
        consumePiBindingResponse(live, result, work, () => {
          live.nativeModel = native;
          const model = asRecord(result.data);
          const window =
            model && typeof model.contextWindow === "number" ? model.contextWindow : undefined;
          if (window && window > 0) live.contextWindow = window;
        }),
    );
  } else if (ref) {
    live.nativeModel = native;
  }

  const thinking = input.modelSettings?.thinking;
  if (isPiThinkingLevel(thinking) && thinking !== live.thinking) {
    await rpc
      .request({ type: "set_thinking_level", level: thinking }, undefined, (result, work) =>
        consumePiBindingResponse(live, result, work, () => {
          live.thinking = thinking;
        }),
      )
      .catch(() => {
        retirePiBinding(live, "pi-binding-configuration-failed");
        live.thinking = thinking;
      });
  }

  const fast = input.modelSettings?.fast;
  if (
    flavor.id === "omp" &&
    (fast === "true" || fast === "false") &&
    (fast === "true") !== live.fastModeRequested
  ) {
    const enabled = fast === "true";
    live.fastModeRequested = enabled;
    try {
      await rpc.request(
        {
          type: "set_fast_mode",
          enabled,
        },
        undefined,
        (response, work) =>
          consumePiBindingResponse(live, response, work, () => {
            const data = asRecord(response.data);
            live.fastModeEnabled = typeof data?.enabled === "boolean" ? data.enabled : enabled;
          }),
      );
    } catch (error) {
      retirePiBinding(live, "pi-binding-configuration-failed");
      if (enabled) {
        live.fastModeEnabled = false;
        emitPiBindingEvent(live, {
          type: "session.configChanged",
          modelSettings: { fast: "false" },
        });
        emitPiBindingEvent(live, {
          type: "status",
          text:
            error instanceof Error
              ? error.message
              : "Fast mode is unavailable for the current model.",
        });
      }
    }
  }

  if (
    flavor.id === "pi" &&
    parsePiModelRef(live.nativeModel) &&
    input.model !== `pi:${live.nativeModel}` &&
    stateFor(flavor).liveByThread.get(input.sessionId) === live &&
    !live.muteUpdates
  ) {
    emitPiBindingEvent(live, { type: "session.configChanged", model: `pi:${live.nativeModel}` });
  }
}

function retirePiBinding(live: Live, reason: string): void {
  live.bindingWork?.fail(reason);
  live.bindingWork = null;
  live.bindingTracked = false;
}
/** Private retained state ancestry. A bare promise result cannot enter here as
 * an original; only the actual PiRpc consumer's authentic active work can. */
function rememberPiBindingInput(live: Live, work: NativeOutputWork | null): void {
  if (live.bindingRetired || !work || live.bindingTracked === false) {
    retirePiBinding(live, "pi-binding-input-untracked");
    work?.fail(live.bindingRetired ? "pi-binding-consumer-retired" : "pi-binding-input-untracked");
    return;
  }
  const previous = live.bindingWork;
  const retained = previous
    ? joinNativeOutputWorks([previous, work])
    : retainNativeOutputEventOrigin(work.origin);
  if (!retained) {
    retirePiBinding(live, "pi-binding-join-failed");
    work.fail("pi-binding-join-failed");
    return;
  }
  previous?.finish();
  live.bindingWork = retained;
  live.bindingTracked = true;
}
function consumePiBindingResponse(
  live: Live,
  response: Record<string, unknown>,
  work: NativeOutputWork | null,
  consume: () => void,
): Record<string, unknown> {
  rememberPiBindingInput(live, work);
  if (live.bindingRetired) return response;
  if (live.bindingWork) live.bindingWork.run(consume);
  else runWithoutNativeOutputOrigin(consume);
  return response;
}
/** Dependent events join the actual current frame, if any, with all retained
 * binding/configuration responses. Deferred callbacks use their explicit sink. */
function emitPiBindingEvent(live: Live, event: HarnessEvent): void {
  const current = captureNativeOutputWork();
  const joined =
    live.bindingWork && current ? joinNativeOutputWorks([live.bindingWork, current]) : null;
  try {
    if (live.bindingWork && (!current || joined))
      (joined ?? live.bindingWork).run(() => live.onEvent(event));
    else runWithoutNativeOutputOrigin(() => live.onEvent(event));
  } finally {
    joined?.finish();
    current?.finish();
  }
}

function bindState(flavor: PiFlavor, sessionId: string, live: Live, data: unknown): void {
  const state = sessionFromState(data);
  const providerSessionId = providerSessionIdFromState(data);
  if (state.contextWindow) live.contextWindow = state.contextWindow;
  if (providerSessionId) {
    live.providerSessionId = providerSessionId;
    stateFor(flavor).resumeByThread.set(sessionId, {
      sessionId: providerSessionId,
      cwd: live.cwd,
    });
  }
  const model = asRecord(asRecord(data)?.model);
  const provider = stringField(model, "provider");
  const modelId = stringField(model, "id");
  if (provider && modelId && (flavor.id === "pi" || !live.nativeModel)) {
    live.nativeModel = piNativeId(provider, modelId);
  }
  const fastModeEnabled = asRecord(data)?.fastModeEnabled;
  if (flavor.id === "omp" && typeof fastModeEnabled === "boolean") {
    live.fastModeEnabled = fastModeEnabled;
    live.fastModeRequested = fastModeEnabled;
  }
}

function upsertTool(
  live: Live,
  id: string,
  name: string,
  input: Record<string, unknown>,
  index?: number,
): void {
  if (index != null && index >= 0) {
    const previous = live.toolsByIndex.get(index);
    if (previous && previous.id !== id) retireToolFragment(previous, "pi-fragment-index-replaced");
  }
  let tool = live.toolsById.get(id);
  if (!tool) {
    tool = {
      id,
      name,
      input,
      partialJson: "",
      title: toolTitle(name, input),
    };
    live.toolsById.set(id, tool);
    live.onEvent({
      type: "tool.started",
      callId: id,
      title: tool.title,
      kind: toolKindFromName(name),
      status: "pending",
      preview: previewFromTool(name, input),
    });
    emitTaskListIfNeeded(live, tool);
  } else if (Object.keys(input).length > 0) {
    updateTool(live, tool, input);
  }
  if (index != null && index >= 0) live.toolsByIndex.set(index, tool);
}
function retireToolFragment(tool: InFlightTool, reason: string): void {
  if (tool.partialJson && !tryParseJsonRecord(tool.partialJson)) tool.partialJsonWork?.fail(reason);
  else tool.partialJsonWork?.finish();
  tool.partialJsonWork = null;
  tool.partialJsonTracked = undefined;
  tool.partialJson = "";
}
function retireToolFragments(live: Live, reason: string): void {
  for (const tool of live.toolsById.values()) retireToolFragment(tool, reason);
}

function updateTool(live: Live, tool: InFlightTool, input: Record<string, unknown>): void {
  tool.input = mergeToolInput(tool.input, input);
  tool.title = toolTitle(tool.name, tool.input);
  live.onEvent({
    type: "tool.updated",
    callId: tool.id,
    title: tool.title,
    kind: toolKindFromName(tool.name),
    status: "pending",
    detail: summarizeToolRequest(tool.name, tool.input),
    preview: previewFromTool(tool.name, tool.input),
  });
  emitTaskListIfNeeded(live, tool);
}

function emitTaskListIfNeeded(live: Live, tool: InFlightTool): void {
  const items = taskListFromToolInput(tool.name, tool.input);
  if (items) live.onEvent({ type: "tasks.updated", items });
}

function finishActiveTurn(live: Live, extraEvents: HarnessEvent[] = []): void {
  if (!live.activeTurn && !live.turnDone) return;
  retireToolFragments(live, "pi-fragment-incomplete-final");
  live.turnEndPending = false;
  live.activeTurn = false;
  TurnLatch.finish(live, extraEvents);
}

function settlePendingTurn(live: Live): void {
  TurnLatch.settle(live, () => finishActiveTurn(live));
}
