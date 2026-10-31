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
import {
  createProviderRetirementLedger,
  preserveProviderFailure,
} from "../../core/providerRetirement";
import {
  runNativeOutputWork,
  nativeOutputSink,
  retainNativeOutputEventOrigin,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { AcpSubagents } from "../../core/acpSubagents";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import { AcpClient, type AcpHandlers } from "../../core/acp";
import { reportAcpStopReason } from "../../core/acpStopReason";
import { JsonRpcResponseError } from "../../core/jsonRpc";
import { resolveFxBinary, spawnChild, watchChild } from "../../core/child";
import {
  autoPermissionOption,
  eventsFromAcpUpdate,
  extractModelConfigId,
  fxModeId,
  fxPromptBlocks,
  permissionOptionId,
  permissionRequestFromAcp,
  readConfigOptions,
  resolveSettingConfigId,
  sessionIdFromResult,
  type SessionConfigOption,
} from "./fxProtocol";
import type {
  ApprovalDecision,
  HarnessEvent,
  SendTurnInput,
  SteerTurnInput,
} from "../../core/types";

type SessionSetupResult = {
  sessionId?: string;
  session_id?: string;
  configOptions?: unknown;
};

import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const retirements = createProviderRetirementLedger("fx.main", killChild);

type Live = {
  operation?: object;
  handle: ChildProcessHandle;
  subagents: AcpSubagents;
  acp: AcpClient;
  acpSessionId: string;
  cwd: string;
  modelConfigId: string;
  configOptions: SessionConfigOption[];
  muteUpdates: boolean;
  cancelled: boolean;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
};

type Resume = {
  acpSessionId: string;
  cwd: string;
};

// fx answers `initialize` in well under a second when it can reach a
// credential. A long wait means it is blocked reading the macOS Keychain, not
// working — so fail fast with something actionable instead of stalling.
const INIT_TIMEOUT_MS = 12_000;
const SESSION_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 15_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;

const AUTH_HELP =
  "fx has no Vercel AI Gateway credential it can read from here. " +
  "Run `fx login` (or `fx setup`) in a terminal, or export AI_GATEWAY_API_KEY " +
  "so it does not depend on the macOS Keychain.";

/** fx rejects `initialize` itself when it cannot read a credential. */
function fxStartupError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (/needs access|AI Gateway|API key|Keychain/i.test(detail)) {
    return new Error(`${detail.trim()}\n\n${AUTH_HELP}`);
  }
  if (/timed out/i.test(detail)) {
    return new Error(
      `fx did not answer initialize within ${INIT_TIMEOUT_MS / 1000}s. ${AUTH_HELP}`,
    );
  }
  return new Error(`fx did not start. ${detail}`);
}

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
 * Live fx adapter. Spawns `fx acp` and talks Agent Client Protocol.
 * Image/audio prompt blocks are not supported; the composer hides attachments.
 */
export async function sendFxTurn(input: SendTurnInput): Promise<void> {
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
          await applyRuntimeMode(live, input.runtimeMode, input.intent === "plan", acp);
          if (live.cancelled) return;
          await prompt(live, input, acp);
        } catch (error) {
          if (live.cancelled) return;
          // Cleanup belongs to this entered turn and remains part of its queue
          // tail. A canceled queued operation must never tear down the prior one.
          if (liveByThread.get(input.sessionId) === live)
            return preserveProviderFailure(error, stopFxSession(input.sessionId, live.handle));
          throw error;
        }
      },
    );
    await run;
  } finally {
    finishProviderOperation(input.operationContext);
  }
}

export async function steerFxTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("fx does not support steering an in-flight turn");
}

/** fx auto-approves in `code` mode, so there is never a pending approval. */
export function respondFxApproval(
  _sessionId: string,
  _requestId: number,
  _decision: ApprovalDecision,
  _approvalOccurrenceId?: string,
) {}

export async function cancelFxTurn(
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
    if (preparing) await stopFxSession(sessionId, context ?? preparing.handle);
    return;
  }
  const acp = context
    ? await acpTurnWriter(live.handle, live.acp, context.nativeControlTurn, context, "control")
    : live.acp;
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.cancelled = true;
  live.muteUpdates = true;
  await acp.notify("session/cancel", { sessionId: live.acpSessionId }).catch(() => undefined);
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.acp.rejectPending(new Error("cancelled"));
}

export async function stopFxSession(
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
  if (live) live.muteUpdates = true;
  live?.acp.close();
  startup?.acp?.close();
  const handles = new Set([live?.handle, startup?.handle, ...(!context ? [expectedHandle] : [])]);
  await (context || expectedHandle
    ? retirements.retire(handles)
    : retirements.retireOwner(sessionId, handles));
}

export async function forgetFxSession(
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
  await stopFxSession(sessionId, owned ? context : undefined);
}

export function bindFxSession(threadId: string, acpSessionId: string, cwd: string): void {
  const sessionId = acpSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  resumeByThread.set(threadId, { acpSessionId: sessionId, cwd });
}

async function ensureLive(input: SendTurnInput): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const existing = liveByThread.get(input.sessionId);
  if (existing && existing.cwd === input.cwd) {
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
      resumeByThread.delete(input.sessionId);
      await stopFxSession(input.sessionId, existing.handle);
      if (startingByThread.get(input.sessionId) !== startup)
        throw new Error("Provider startup cancelled");
    }

    const resume = resumeByThread.get(input.sessionId);
    const canLoad = resume != null && resume.cwd === input.cwd;
    if (resume && resume.cwd !== input.cwd) {
      resumeByThread.delete(input.sessionId);
    }

    const { path } = await resolveFxBinary();
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
        console.warn("[bycoda] fx server request failed");
      });
    };

    // ensureLive runs once per session, so these handlers outlive the turn that
    // created them. Routing through the live record keeps them on the *current*
    // turn's listener — capturing `input.onEvent` meant every exit and stderr
    // error after turn 1 was addressed to a finished turn and silently dropped,
    // leaving the session spinning on "Working…" forever.
    const emit = (event: HarnessEvent) => {
      (liveRef.current?.onEvent ?? input.onEvent)(event);
    };

    watchChild(
      handle,
      (line) => acp.pushLine(line),
      (code) => {
        acp.close(new Error("fx exited"));
        if (liveByThread.get(input.sessionId)?.handle === handle)
          liveByThread.delete(input.sessionId);
        emit({ type: "session.ended", code });
      },
      (line) => {
        console.debug("[bycoda] fx stderr", line);
        if (/Fx needs access|AI Gateway|not start/i.test(line)) {
          emit({ type: "session.error", message: line.trim() });
        }
      },
    );

    await spawnChild(handle, path, fxSpawnArgs(input.model), input.cwd, undefined, "fx");
    const startupAcp = await acpTurnWriter(
      handle,
      acp,
      input.nativeControlTurn,
      input.operationContext,
    );

    try {
      await startupAcp.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: { name: "bycoda", version: "0.1.0" },
        },
        INIT_TIMEOUT_MS,
      );
    } catch (error) {
      throw fxStartupError(error);
    }

    let setup: SessionSetupResult | undefined;
    let acpSessionId: string | undefined;
    let didLoad = false;

    if (canLoad && resume) {
      try {
        setup = await startupAcp.request<SessionSetupResult>(
          "session/resume",
          { sessionId: resume.acpSessionId },
          SESSION_TIMEOUT_MS,
        );
        acpSessionId = sessionIdFromResult(setup) ?? resume.acpSessionId;
        didLoad = true;
      } catch (error) {
        if (!(error instanceof JsonRpcResponseError)) throw error;
        muteGate.current = true;
        try {
          setup = await startupAcp.request<SessionSetupResult>(
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
          input.onEvent({ type: "status", text: "The saved provider conversation is unavailable. Starting a new session; the app will restore conversation context." });
        } finally {
          muteGate.current = false;
        }
      }
    }

    if (!acpSessionId) {
      setup = await startupAcp.request<SessionSetupResult>(
        "session/new",
        { cwd: input.cwd, mcpServers: [] },
        SESSION_TIMEOUT_MS,
      );
      acpSessionId = sessionIdFromResult(setup);
    }
    if (!acpSessionId) throw new Error("fx did not return a session id");

    const configOptions = readConfigOptions(setup?.configOptions);
    if (startingByThread.get(input.sessionId) !== startup)
      throw new Error("Provider startup cancelled");
    const live: Live = {
      operation: input.operationContext?.operation,
      handle,
      subagents: new AcpSubagents(),
      acp,
      acpSessionId,
      cwd: input.cwd,
      modelConfigId: extractModelConfigId(configOptions),
      configOptions,
      muteUpdates: didLoad,
      cancelled: false,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
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
    return preserveProviderFailure(error, stopFxSession(input.sessionId, handle));
  } finally {
    if (startingByThread.get(input.sessionId) === startup) startingByThread.delete(input.sessionId);
  }
}

async function applyModelSelection(
  live: Live,
  input: SendTurnInput,
  acp: AcpWriterView,
): Promise<void> {
  const base = nativeModelId(input.model);
  const settings = input.modelSettings ?? {};
  const modelConfigId = live.modelConfigId === "provider" ? "model" : live.modelConfigId;

  await setConfigOption(live, modelConfigId, base, acp).catch((error: unknown) => {
    ignoreUnsupportedControl("set_config_option", error);
  });
  if (modelConfigId !== "model") {
    await setConfigOption(live, "model", base, acp).catch((error: unknown) => {
      ignoreUnsupportedControl("set_config_option", error);
    });
  }

  for (const [settingId, value] of Object.entries(settings)) {
    const configId = resolveSettingConfigId(live.configOptions, settingId);
    if (!configId || configId === "provider") continue;
    await setConfigOption(live, configId, value, acp).catch((error: unknown) => {
      ignoreUnsupportedControl("set_config_option", error);
    });
  }
}

async function applyRuntimeMode(
  live: Live,
  runtimeMode: RuntimeMode,
  planning = false,
  acp: AcpWriterView,
): Promise<void> {
  // Unsupported mode control is non-fatal because handlePermission remains a
  // backstop. Transport failures and timeouts are rethrown so the wedged child
  // is recycled rather than leaving this turn pending forever.
  await acp
    .request(
      "session/set_mode",
      {
        sessionId: live.acpSessionId,
        modeId: planning ? "ask" : fxModeId(runtimeMode),
      },
      CONTROL_TIMEOUT_MS,
    )
    .catch((error: unknown) => {
      ignoreUnsupportedControl("set_mode", error);
    });
}

async function setConfigOption(
  live: Live,
  configId: string,
  value: string | boolean,
  acp: AcpWriterView,
): Promise<void> {
  const encoded = String(value);
  const current = live.configOptions.find((option) => option.id === configId);
  if (current && String(current.currentValue ?? "") === encoded) return;

  const result = await acp.request<SessionSetupResult>(
    "session/set_config_option",
    {
      sessionId: live.acpSessionId,
      configId,
      value: encoded,
    },
    CONTROL_TIMEOUT_MS,
  );
  if (result?.configOptions) {
    live.configOptions = readConfigOptions(result.configOptions);
    live.modelConfigId = extractModelConfigId(live.configOptions);
  }
}

function fxSpawnArgs(model: string): string[] {
  const native = nativeModelId(model).trim();
  return native ? ["acp", "--model", native] : ["acp"];
}

async function prompt(live: Live, input: SendTurnInput, acp: AcpWriterView): Promise<void> {
  const responseScope: { work: NativeOutputWork | null } = { work: null };
  const emitNative = (event: HarnessEvent) =>
    nativeOutputSink(responseScope.work, () => live.onEvent(event))();
  try {
    try {
      const blocks = fxPromptBlocks(input.text);
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
        message: /needs access|AI Gateway|API key|Keychain/i.test(detail)
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
  console.debug(`[bycoda] fx ${method} failed`, error);
  const detail = error instanceof Error ? error.message : String(error);
  if (/timed out|not running|exited|closed|pipe/i.test(detail)) throw error;
}

function handleNotification(live: Live, method: string, params: unknown) {
  if (method !== "session/update") return;
  for (const event of live.subagents.route(params, eventsFromAcpUpdate(params))) {
    live.onEvent(event);
  }
}

async function handleRequest(live: Live, id: number, method: string, params: unknown) {
  return runNativeOutputWork(async (outputWork) => {
    if (method === "session/request_permission") {
      await nativeOutputSink(outputWork, handlePermission)(live, id, params);
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

/**
 * fx polices its own permissions in `code` mode, so anything that still reaches
 * us is answered immediately. We never park a turn on an approval — that is
 * what left sessions stuck on "Working…" with an empty transcript.
 */
async function handlePermission(live: Live, id: number, params: unknown) {
  return runNativeOutputWork(
    async (outputWork) => {
      const emitNative = nativeOutputSink(outputWork, (event: Parameters<Live["onEvent"]>[0]) =>
        live.onEvent(event),
      );
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
      const optionId = live.planning
        ? permissionOptionId(
            request.kind === "read" || request.kind === "search" ? "allow" : "deny",
            request.optionIds,
          )
        : (autoPermissionOption(live.runtimeMode, request.optionIds) ??
          permissionOptionId("allow", request.optionIds));
      await nativeOutputSink(outputWork, () =>
        live.acp.respond(id, {
          outcome: { outcome: "selected", optionId },
        }),
      )();
    },
    { additionalInput: true },
  );
}
