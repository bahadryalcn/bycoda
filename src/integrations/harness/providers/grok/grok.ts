import {
  assertProviderOperation,
  observeProviderProcess,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  processTarget,
  operationContext,
  type HarnessOperationContext,
  captureAcpTurnWriter,
  queueProviderOperation,
  acpTurnWriter,
  type AcpWriterView,
} from "../turnWriter";

import { killChild } from "../../core/child";
import { retireProviderEpoch } from "../turnWriter";
import {
  announceSlowProviderStartup,
  PROVIDER_STARTUP_TIMEOUT_MS,
} from "../../core/providerStartupStatus";
import {
  createProviderRetirementLedger,
  preserveProviderFailure,
} from "../../core/providerRetirement";
import {
  createPendingApproval,
  cancelPendingApprovals,
  observePendingApprovalWrite,
  type ApprovalActualWriteObserver,
  ownsPendingApproval,
  rejectOverlappingApproval,
  releasePendingApproval,
  type PendingApproval,
} from "../pendingApproval";
import { isApprovalOccurrenceId } from "../../../../shared/model/approvalOccurrence";
import {
  captureNativeOutputWorkEvent,
  runNativeOutputWork,
  nativeOutputSink,
  retainNativeOutputEventOrigin,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import {
  deliverQuestionReply,
  showNextQueuedQuestion,
  type QuestionDelivery,
} from "../questionDelivery";
import { nativeModelIdWithSettings } from "../../../../features/sessions/model/models";
import { AcpSubagents } from "../../core/acpSubagents";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import { AcpClient, type AcpHandlers } from "../../core/acp";
import { reportAcpStopReason } from "../../core/acpStopReason";
import { JsonRpcResponseError } from "../../core/jsonRpc";
import { resolveGrokBinary, spawnChild, watchChild } from "../../core/child";
import {
  AUTH_HELP,
  askQuestionResponse,
  askQuestionsFromAcp,
  asRecord,
  contextWindowFromSetup,
  currentModelId,
  eventsFromAcpUpdate,
  grokAuthError,
  grokAuthMethodId,
  grokEffort,
  grokPromptBlocks,
  grokSessionNewParams,
  grokSpawnArgs,
  permissionOptionId,
  permissionRequestFromAcp,
  pickAutoOption,
  planFromExitPlan,
  sessionIdFromResult,
  grokSpawnShape,
  sameGrokSpawn,
} from "./grokProtocol";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";
import {
  questionPromptTitle,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";

import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const retirements = createProviderRetirementLedger("grok.main", killChild);

type Live = {
  operation?: object;
  handle: ChildProcessHandle;
  subagents: AcpSubagents;
  acp: AcpClient;
  acpSessionId: string;
  cwd: string;
  modelId: string;
  contextWindow?: number;
  muteUpdates: boolean;
  cancelled: boolean;
  fullAccess: boolean;
  planning: boolean;
  noSubagents: boolean;
  runtimeMode: RuntimeMode;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  questions: Map<number, ((reply: UserQuestionReply) => void) & QuestionDelivery>;
  visibleQuestionId?: number;
};

type Resume = {
  acpSessionId: string;
  cwd: string;
};

const INIT_TIMEOUT_MS = PROVIDER_STARTUP_TIMEOUT_MS;
const AUTH_TIMEOUT_MS = 15_000;
const SESSION_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 15_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
};

const liveByThread = new Map<string, Live>();
const startingByThread = new Map<
  string,
  { handle: ChildProcessHandle; operation?: object; acp?: AcpClient }
>();
const resumeByThread = new Map<string, Resume>();
const turnsByThread = new Map<string, Promise<unknown>>();
const sourceEpochByThread = new Map<string, object>();

/**
 * Live Grok Build adapter. Spawns `grok agent stdio` and talks ACP.
 * Grok accepts ACP image blocks despite advertising image: false.
 */
export async function sendGrokTurn(input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  try {
    const epoch = sourceEpochByThread.get(input.sessionId);
    const cancelled = () => sourceEpochByThread.get(input.sessionId) !== epoch;
    let live: Live;
    const observed = liveByThread.get(input.sessionId) ?? startingByThread.get(input.sessionId);
    if (observed) observeProviderProcess(input, observed.handle);
    const run = queueProviderOperation(
      turnsByThread,
      input.sessionId,
      input.operationContext,
      async () => {
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        live = await ensureLive(input);
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        const acp = await captureAcpTurnWriter(
          live.handle,
          live.acp,
          input.nativeControlTurn,
          input.operationContext,
        )();
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        if (liveByThread.get(input.sessionId) !== live)
          throw new Error("Provider operation replaced before turn entry");
        live.onEvent = input.onEvent;
        live.runtimeMode = input.runtimeMode;
        live.planning = input.intent === "plan";
        live.cancelled = false;
        live.muteUpdates = false;
        try {
          await applyModelSelection(live, input, acp);
          if (live.cancelled) return;
          await prompt(live, input, acp);
        } catch (error) {
          if (live.cancelled) return;
          if (liveByThread.get(input.sessionId) === live)
            await stopGrokSession(input.sessionId, live.handle);
          throw error;
        }
      },
    );
    await run;
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function compactGrokContext(input: CompactContextInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };

  try {
    const epoch = sourceEpochByThread.get(input.sessionId);
    const cancelled = () => sourceEpochByThread.get(input.sessionId) !== epoch;
    let live: Live;
    const observed = liveByThread.get(input.sessionId) ?? startingByThread.get(input.sessionId);
    if (observed) observeProviderProcess(input, observed.handle);
    const run = queueProviderOperation(
      turnsByThread,
      input.sessionId,
      input.operationContext,
      async () => {
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        // Compaction reuses a same-cwd provider regardless of the UI's mode,
        // preserving the original compact behavior without an early teardown.
        const existing = liveByThread.get(input.sessionId);
        live = existing?.cwd === input.cwd ? existing : await ensureLive(input);
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        const acp = await captureAcpTurnWriter(
          live.handle,
          live.acp,
          input.nativeControlTurn,
          input.operationContext,
        )();
        if (cancelled()) return;
        assertProviderOperation(input.operationContext);
        if (liveByThread.get(input.sessionId) !== live)
          throw new Error("Provider operation replaced before compact entry");
        live.onEvent = input.onEvent;
        live.cancelled = false;
        live.muteUpdates = false;
        try {
          await acp.request(
            "_x.ai/compact_conversation",
            { sessionId: live.acpSessionId },
            PROMPT_TIMEOUT_MS,
          );
        } catch (error) {
          if (live.cancelled) return;
          throw error;
        }
      },
    );
    await run;
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function steerGrokTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Grok Build does not support steering an in-flight turn");
}

export function respondGrokApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  approvalOccurrenceId?: string,
) {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (
    !live ||
    live.cancelled ||
    live.muteUpdates ||
    !pending ||
    pending.invalidated ||
    !isApprovalOccurrenceId(approvalOccurrenceId) ||
    pending.occurrenceId !== approvalOccurrenceId
  )
    return;
  pending(decision);
}

export function respondGrokQuestion(
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): boolean {
  const live = liveByThread.get(sessionId);
  const pending = live?.questions.get(requestId);
  // Nothing is waiting for this answer (the question was resolved or the turn ended).
  if (!live || !pending) return false;
  deliverQuestionReply(
    pending,
    requestId,
    reply,
    live.onEvent,
    () => live.questions.get(requestId) === pending && !live.cancelled && !live.muteUpdates,
    () => pending(reply),
  );
  return true;
}

export async function cancelGrokTurn(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const live = liveByThread.get(sessionId);
  const preparing = startingByThread.get(sessionId);
  // A captured cancellation must not affect a newer operation.
  if (
    !ownsOperation(
      context,
      live?.handle ?? preparing?.handle,
      live?.operation ?? preparing?.operation,
    )
  )
    return;
  sourceEpochByThread.set(sessionId, {});
  if (!live) {
    if (preparing) await stopGrokSession(sessionId, context ?? preparing.handle);
    return;
  }
  const acp = context
    ? await acpTurnWriter(live.handle, live.acp, context.nativeControlTurn, context, "control")
    : live.acp;
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.cancelled = true;
  live.muteUpdates = true;
  cancelPendingApprovals(live.approvals);
  for (const [, resolve] of live.questions) resolve({ kind: "skipped" });
  live.questions.clear();
  await acp.notify("session/cancel", { sessionId: live.acpSessionId }).catch(() => undefined);
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.acp.rejectPending(new Error("cancelled"), { keepNativeOutput: true });
}

export async function stopGrokSession(
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
  if (context ? live || startup : !expectedHandle) sourceEpochByThread.set(sessionId, {});
  if (live) liveByThread.delete(sessionId);
  if (startup) startingByThread.delete(sessionId);
  if (live) {
    live.muteUpdates = true;
    cancelPendingApprovals(live.approvals);
    for (const [, resolve] of live.questions) resolve({ kind: "skipped" });
    live.questions.clear();
  }
  live?.acp.close();
  startup?.acp?.close();
  const handles = new Set([live?.handle, startup?.handle, ...(!context ? [expectedHandle] : [])]);
  await (context || expectedHandle
    ? retirements.retire(handles)
    : retirements.retireOwner(sessionId, handles));
}

export async function forgetGrokSession(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  // Delete/switch must end the process: a context that no longer owns it falls
  // back to a by-session stop instead of returning with the process alive.
  resumeByThread.delete(sessionId);
  const queuedOnly = cancelQueuedOperation(context);
  const original = liveByThread.get(sessionId) ?? startingByThread.get(sessionId);
  const owned =
    !queuedOnly && (!original || ownsOperation(context, original.handle, original.operation));
  await stopGrokSession(sessionId, owned ? context : undefined);
  retireProviderEpoch(sourceEpochByThread, turnsByThread, sessionId);
}

export function bindGrokSession(threadId: string, acpSessionId: string, cwd: string): void {
  const sessionId = acpSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  resumeByThread.set(threadId, { acpSessionId: sessionId, cwd });
}

async function ensureLive(input: HarnessSessionInput): Promise<Live> {
  const startupDone = announceSlowProviderStartup(input.onEvent, "Grok");
  try {
    return await ensureStartedLive(input);
  } finally {
    startupDone();
  }
}

async function ensureStartedLive(input: HarnessSessionInput): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const want = grokSpawnShape(input);
  const existing = liveByThread.get(input.sessionId);
  if (existing && existing.cwd === input.cwd && sameGrokSpawn(existing, want)) {
    observeProviderProcess(input, existing.handle);

    return existing;
  }
  const handle = retirements.admit(
    createChildProcessHandle(input.sessionId, input.nativeControlTurn),
  );
  const startup: { handle: ChildProcessHandle; operation?: object; acp?: AcpClient } = {
    handle,
    operation: input.operationContext?.operation,
  };
  startingByThread.set(input.sessionId, startup);
  try {
    observeProviderProcess(input, handle, "starting");
    if (existing) {
      await stopGrokSession(input.sessionId, existing.handle);
      if (startingByThread.get(input.sessionId) !== startup)
        throw new Error("Provider startup cancelled");
    }

    const resume = resumeByThread.get(input.sessionId);
    const canLoad = resume != null && resume.cwd === input.cwd;
    if (resume && resume.cwd !== input.cwd) {
      resumeByThread.delete(input.sessionId);
    }

    const { path } = await resolveGrokBinary();
    if (startingByThread.get(input.sessionId) !== startup)
      throw new Error("Provider startup cancelled");
    const handlers: AcpHandlers = {};
    const acp = new AcpClient(handle, handlers);
    startup.acp = acp;
    const liveRef: { current: Live | null } = { current: null };
    const muteGate = { current: false };

    handlers.onNotification = (method, params) => {
      if (muteGate.current) return;
      const live = liveRef.current;
      if (!live || live.muteUpdates) return;
      handleNotification(live, method, params);
    };
    handlers.onRequest = (id, method, params) => {
      const live = liveRef.current;
      if (!live) {
        void acp
          .respondError(id, {
            code: -32601,
            message: `Method not found: ${method}`,
          })
          .catch(() => undefined);
        return;
      }
      return handleRequest(live, id, method, params).catch(() => {
        console.warn("[bycoda] grok server request failed");
      });
    };

    const emit = (event: HarnessEvent) => {
      (liveRef.current?.onEvent ?? input.onEvent)(event);
    };

    watchChild(
      handle,
      (line) => acp.pushLine(line),
      (code) => {
        acp.close(new Error("Grok Build exited"));
        if (liveByThread.get(input.sessionId)?.handle === handle)
          liveByThread.delete(input.sessionId);
        emit({ type: "session.ended", code });
      },
      (line) => {
        console.debug("[bycoda] grok stderr", line);
        if (/not authenticated|Authentication required|XAI_API_KEY/i.test(line)) {
          emit({
            type: "session.error",
            message: `${line.trim()}\n\n${AUTH_HELP}`,
          });
        }
      },
    );

    await spawnChild(
      handle,
      path,
      grokSpawnArgs({
        model: nativeModelIdWithSettings(input.model, input.modelSettings),
        effort: grokEffort(input.modelSettings),
        fullAccess: want.fullAccess,
        plan: want.planning,
        noSubagents: want.noSubagents,
      }),
      input.cwd,
      undefined,
      "grok",
    );
    const startupAcp = await acpTurnWriter(
      handle,
      acp,
      input.nativeControlTurn,
      input.operationContext,
    );

    let init: unknown;
    try {
      init = await startupAcp.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: { name: "bycoda", version: "0.1.0" },
        },
        INIT_TIMEOUT_MS,
      );
    } catch (error) {
      throw grokAuthError(error);
    }

    const methodId = grokAuthMethodId(init);
    if (methodId) {
      await startupAcp
        .request("authenticate", { methodId, _meta: { headless: true } }, AUTH_TIMEOUT_MS)
        .catch((error: unknown) => {
          console.debug("[bycoda] grok authenticate", error);
        });
    }

    let setup: unknown;
    let acpSessionId: string | undefined;
    let didLoad = false;

    if (canLoad && resume) {
      try {
        setup = await startupAcp.request(
          "session/resume",
          { sessionId: resume.acpSessionId },
          SESSION_TIMEOUT_MS,
        );
        acpSessionId = sessionIdFromResult(setup) ?? resume.acpSessionId;
        didLoad = true;
      } catch (error) {
        // A timeout may still complete remotely. Only an answered failure can
        // safely try the alternate restoration method.
        if (!(error instanceof JsonRpcResponseError)) throw error;
        muteGate.current = true;
        try {
          setup = await startupAcp.request(
            "session/load",
            {
              sessionId: resume.acpSessionId,
              cwd: input.cwd,
              mcpServers: [],
            },
            SESSION_TIMEOUT_MS,
          );
          acpSessionId = sessionIdFromResult(setup) ?? resume.acpSessionId;
          didLoad = true;
        } catch (error) {
          if (!(error instanceof JsonRpcResponseError)) throw error;
          resumeByThread.delete(input.sessionId);
          input.onEvent({
            type: "status",
            text: "The saved provider conversation is unavailable. Starting a new session; the app will restore conversation context.",
          });
        } finally {
          muteGate.current = false;
        }
      }
    }

    if (!acpSessionId) {
      try {
        setup = await startupAcp.request(
          "session/new",
          grokSessionNewParams(input.cwd, input.runtimeMode),
          SESSION_TIMEOUT_MS,
        );
      } catch (error) {
        throw grokAuthError(error);
      }
      acpSessionId = sessionIdFromResult(setup);
    }
    if (!acpSessionId) throw new Error("Grok Build did not return a session id");

    if (startingByThread.get(input.sessionId) !== startup)
      throw new Error("Provider startup cancelled");
    const live: Live = {
      operation: input.operationContext?.operation,
      handle,
      subagents: new AcpSubagents(),
      acp,
      acpSessionId,
      cwd: input.cwd,
      modelId: currentModelId(setup) ?? nativeModelIdWithSettings(input.model, input.modelSettings),
      contextWindow: contextWindowFromSetup(setup) ?? contextWindowFromSetup(init),
      muteUpdates: didLoad,
      cancelled: false,
      ...want,
      runtimeMode: input.runtimeMode,
      onEvent: input.onEvent,
      approvals: new Map(),
      questions: new Map(),
    };
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    resumeByThread.set(input.sessionId, {
      acpSessionId,
      cwd: input.cwd,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: acpSessionId,
    });
    live.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    startup.acp?.close(error instanceof Error ? error : new Error(String(error)));
    return preserveProviderFailure(error, stopGrokSession(input.sessionId, handle));
  } finally {
    if (startingByThread.get(input.sessionId) === startup) startingByThread.delete(input.sessionId);
  }
}

async function applyModelSelection(
  live: Live,
  input: HarnessSessionInput,
  acp: AcpWriterView,
): Promise<void> {
  const base = nativeModelIdWithSettings(input.model, input.modelSettings);
  if (base && base !== live.modelId) {
    await acp
      .request(
        "session/set_model",
        { sessionId: live.acpSessionId, modelId: base },
        CONTROL_TIMEOUT_MS,
      )
      .then(() => {
        live.modelId = base;
      })
      .catch((error: unknown) => {
        ignoreUnsupportedControl("set_model", error);
      });
  }

  const effort = grokEffort(input.modelSettings);
  if (!effort) return;
  await acp
    .request(
      "session/set_mode",
      { sessionId: live.acpSessionId, modeId: effort },
      CONTROL_TIMEOUT_MS,
    )
    .catch((error: unknown) => {
      ignoreUnsupportedControl("set_mode", error);
    });
}

async function prompt(live: Live, input: SendTurnInput, acp: AcpWriterView): Promise<void> {
  const responseScope: { work: NativeOutputWork | null } = { work: null };
  const emitNative = (event: HarnessEvent) =>
    nativeOutputSink(responseScope.work, () => live.onEvent(event))();
  try {
    try {
      const blocks = grokPromptBlocks(input.text, input.attachments);
      if (blocks.length === 0) return;
      const result = await acp.request(
        "session/prompt",
        {
          sessionId: live.acpSessionId,
          prompt: blocks,
        },
        PROMPT_TIMEOUT_MS,
        (value, work) => {
          responseScope.work?.finish();
          responseScope.work = work ? retainNativeOutputEventOrigin(work.origin) : null;
          return value;
        },
      );
      if (live.cancelled) return;
      emitNative({ type: "message.completed" });
      emitNative({ type: "reasoning.completed" });
      reportAcpStopReason(result, emitNative);
    } catch (error) {
      if (live.cancelled) return;
      const detail = error instanceof Error ? error.message : String(error);
      emitNative({
        type: "session.error",
        message: /auth|login|credential|api key|XAI_API_KEY/i.test(detail)
          ? `${detail.trim()}\n\n${AUTH_HELP}`
          : detail,
      });
      throw error;
    }
  } finally {
    responseScope.work?.finish();
  }
}

function ignoreUnsupportedControl(method: string, error: unknown): void {
  console.debug(`[bycoda] grok ${method} failed`, error);
  const detail = error instanceof Error ? error.message : String(error);
  if (/timed out|not running|exited|closed|pipe/i.test(detail)) throw error;
}

function handleNotification(live: Live, method: string, params: unknown) {
  const updateParams =
    method === "session/update"
      ? params
      : method === "_x.ai/session_notification" || method === "x.ai/session_notification"
        ? unwrapSessionNotification(params)
        : null;
  if (!updateParams) return;
  for (const event of live.subagents.route(updateParams, eventsFromAcpUpdate(updateParams))) {
    if (event.type === "context" && event.window == null && live.contextWindow) {
      live.onEvent({ ...event, window: live.contextWindow });
    } else {
      live.onEvent(event);
    }
  }
}

function unwrapSessionNotification(params: unknown): unknown {
  const rec = asRecord(params);
  if (!rec) return params;
  if (rec.update != null || rec.sessionUpdate != null) return rec;
  const nested = asRecord(rec.notification) ?? asRecord(rec.payload);
  return nested ?? rec;
}

async function handleRequest(live: Live, id: number, method: string, params: unknown) {
  return runNativeOutputWork(async (outputWork) => {
    const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
      live.onEvent(event),
    );
    if (method === "session/request_permission") {
      await nativeOutputSink(outputWork, handlePermission)(live, id, params);
      return;
    }
    if (method === "_x.ai/ask_user_question" || method === "x.ai/ask_user_question") {
      await nativeOutputSink(outputWork, handleAskQuestion)(live, id, params);
      return;
    }
    if (method === "_x.ai/exit_plan_mode" || method === "x.ai/exit_plan_mode") {
      const plan = planFromExitPlan(params);
      if (plan) emitNative({ type: "plan", text: plan });
      await nativeOutputSink(outputWork, () =>
        live.acp
          // End the provider-owned plan turn without approving implementation.
          // Bycoda's separate Build turn is the only approval boundary.
          .respond(id, { outcome: "abandoned" }),
      )().catch(() => undefined);
      return;
    }
    await nativeOutputSink(outputWork, () =>
      live.acp.respondError(id, {
        code: -32601,
        message: `Method not found: ${method}`,
      }),
    )().catch(() => undefined);
  });
}

async function handlePermission(live: Live, id: number, params: unknown) {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
      const overlap = rejectOverlappingApproval(
        live.approvals,
        id,
        nativeOutputSink(outputWork, (onActualWrite: ApprovalActualWriteObserver) =>
          live.acp.respond(id, { outcome: { outcome: "cancelled" } }, onActualWrite),
        ),
      );
      if (overlap) {
        await overlap;
        return;
      }
      const request = permissionRequestFromAcp(params);
      if (request.callId) {
        emitNative({
          type: "tool.updated",
          callId: request.callId,
          title: request.title,
          kind: request.kind,
          preview: request.preview,
        });
      }

      if (live.planning) {
        const readOnly = request.kind === "read" || request.kind === "search";
        const optionId = permissionOptionId(readOnly ? "allow" : "deny", request.optionIds);
        await nativeOutputSink(outputWork, () =>
          live.acp.respond(id, {
            outcome: { outcome: "selected", optionId },
          }),
        )();
        return;
      }

      const auto = pickAutoOption(live.runtimeMode, request.kind, request.optionIds);
      if (auto) {
        await nativeOutputSink(outputWork, () =>
          live.acp.respond(id, {
            outcome: { outcome: "selected", optionId: auto },
          }),
        )();
        return;
      }

      const pending = createPendingApproval((occurrenceId, decision) =>
        emitNative({ type: "approval.resolved", requestId: id, occurrenceId, decision }),
      );
      const { occurrenceId } = pending;
      live.approvals.set(id, pending);
      try {
        emitNative({
          type: "approval.requested",
          requestId: id,
          occurrenceId,
          title: request.title,
          kind: request.kind,
          callId: request.callId,
          preview: request.preview,
        });

        const decision = await pending.decision;
        pending.report(decision);
        if (!Array.from(liveByThread.values()).includes(live)) return;

        await nativeOutputSink(outputWork, () => {
          if (!Array.from(liveByThread.values()).includes(live)) return Promise.resolve();
          if (!ownsPendingApproval(live.approvals, id, pending)) {
            pending.report("cancelled");
            return live.acp.respond(
              id,
              { outcome: { outcome: "cancelled" } },
              observePendingApprovalWrite(live.approvals, id, pending),
            );
          }
          return live.acp.respond(
            id,
            {
              outcome: {
                outcome: "selected",
                optionId: permissionOptionId(
                  decision === "allow" ? "allow" : "deny",
                  request.optionIds,
                ),
              },
            },
            observePendingApprovalWrite(live.approvals, id, pending),
          );
        })();
      } finally {
        releasePendingApproval(live.approvals, id, pending);
      }
    },
    { additionalInput: true },
  );
}

async function handleAskQuestion(live: Live, id: number, params: unknown) {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
      const questions = askQuestionsFromAcp(params);
      const event: Extract<HarnessEvent, { type: "question.asked" }> = {
        type: "question.asked",
        requestId: id,
        title: questionPromptTitle(questions),
        questions,
        dismissAction: "skip",
      };
      captureNativeOutputWorkEvent(outputWork, event);

      const replyPromise = new Promise<UserQuestionReply>((resolve) => {
        live.questions.set(
          id,
          Object.assign(resolve, {
            event,
            deliver: (reply: UserQuestionReply) =>
              nativeOutputSink(outputWork, () =>
                live.acp.respond(id, askQuestionResponse(reply, questions)),
              )(),
          }),
        );
      });
      showNextQueuedQuestion(live);
      const reply = await replyPromise;
      live.questions.delete(id);
      emitNative({
        type: "question.resolved",
        requestId: id,
        decision: live.cancelled || live.muteUpdates ? "cancelled" : reply.kind,
        ...(reply.kind === "answered" ? { reply } : {}),
      });
      showNextQueuedQuestion(live);
    },
    { additionalInput: true },
  );
}
