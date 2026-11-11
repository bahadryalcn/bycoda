import {
  assertProviderOperation,
  observeProviderProcess,
  beginProviderOperation,
  finishProviderOperation,
  cancelQueuedOperation,
  ownsOperation,
  type HarnessOperationContext,
  acpTurnWriter,
  holdProviderEpoch,
  retireProviderEpochs,
  type AcpWriterView,
} from "../turnWriter";

import { killChild } from "../../core/child";
import {
  PROVIDER_STARTUP_TIMEOUT_MS,
  withSlowStartupNotice,
} from "../../core/providerStartupStatus";
import {
  createProviderRetirementLedger,
  settleProviderRetirements,
  preserveProviderFailure,
  assertOptionalProviderProbeError,
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
  runNativeOutputWork,
  nativeOutputSink,
  retainNativeOutputEventOrigin,
  scheduleNativeOutputCallback,
  cancelNativeOutputCallback,
  type NativeOutputWork,
} from "../../core/nativeOutputDelivery";
import { createRecyclingLifecycle } from "../../../../shared/lib/recyclingLifecycle";
import { continueAfterFailure } from "../../../../shared/lib/promiseQueue";
import { nativeModelId } from "../../../../features/sessions/model/models";
import { AcpSubagents } from "../../core/acpSubagents";
import type { RuntimeMode } from "../../../../features/sessions/model/session";
import { AcpClient, type AcpHandlers } from "../../core/acp";
import { resolveAntigravityBinary, spawnChild, unwatchChild, watchChild } from "../../core/child";
import {
  autoPermissionOption,
  asRecord,
  eventsFromAcpUpdate,
  extractModelConfigId,
  antigravityModeId,
  antigravityPromptBlocks,
  antigravitySpawnCwd,
  permissionOptionId,
  permissionRequestFromAcp,
  readConfigOptions,
  resolveSettingConfigId,
  sessionIdFromResult,
  type SessionConfigOption,
} from "./antigravityProtocol";
import type { ApprovalDecision, HarnessEvent, SendTurnInput } from "../../core/types";

type SessionSetupResult = {
  sessionId?: string;
  session_id?: string;
  configOptions?: unknown;
};

import { createChildProcessHandle, type ChildProcessHandle } from "../../core/child";

const retirements = createProviderRetirementLedger("antigravity.main", killChild);

type Live = {
  operation?: object;
  handle: ChildProcessHandle;
  threadId: string;
  /** Logical child locator; physical ownership belongs to handle. */
  childKey: string;
  subagents: AcpSubagents;
  acp: AcpClient;
  acpSessionId: string;
  cwd: string;
  modelConfigId: string;
  configOptions: SessionConfigOption[];
  muteUpdates: boolean;
  cancelled: boolean;
  /** Server state is unknowable after a mid-prompt cancel; recycle before reuse. */
  stale: boolean;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  promptInFlight: boolean;
  /** True while the owning turn may have state-changing requests in flight —
   *  a cancel here makes the transport indeterminate even mid-config. */
  turnActive: boolean;
  stallNotified: boolean;
  watchdog?: ReturnType<typeof setTimeout>;
};

type Resume = {
  acpSessionId: string;
  cwd: string;
};

// Bound startup and control requests; a prompt may legitimately run much longer.
const INIT_TIMEOUT_MS = PROVIDER_STARTUP_TIMEOUT_MS;
const SESSION_TIMEOUT_MS = 45_000;
const CONTROL_TIMEOUT_MS = 15_000;
const PROMPT_TIMEOUT_MS = 30 * 60_000;
// Antigravity answers session/prompt only after its post-turn work (trajectory
// idle + external hooks) finishes, so a wedged server never resolves it. Silence
// is ambiguous — a long quiet tool call is legitimate — so past this point we
// surface a status note instead of killing the turn.
const STALL_NOTIFY_MS = 120_000;

const AUTH_HELP = "Run `agy` once in Terminal to sign in.";

function antigravityError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes(AUTH_HELP)) return new Error(detail);
  return new Error(
    /auth|login|sign.in|credential|api.key/i.test(detail)
      ? `${detail.trim()}\n\n${AUTH_HELP}`
      : detail,
  );
}

function isTimeout(error: unknown): boolean {
  // JSON-RPC deadlines include the operation, duration and session after the
  // timeout marker. A timed-out resume must never enter the fallback ladder.
  return error instanceof Error && /\btimed out\b/.test(error.message);
}

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false },
  terminal: false,
  // Advertise config-option support — a compliant agent may omit
  // session.configOptions entirely for clients that never claim it, which
  // would silently drop model selection.
  session: { configOptions: { boolean: {} } },
};

const liveByThread = new Map<string, Live>();
const resumeByThread = new Map<string, Resume>();
// Every user-intent cancel/stop/forget bumps the epoch: sends already pending
// at that moment are suppressed, while a send that arrives later captures the
// new epoch and proceeds normally.
const cancelEpoch = new Map<string, object>();
// Bumped by user-intent invalidation (cancel/stop/forget) — never by internal
// recycles. Lifecycle work validates the epoch captured at submission so
// queued steps cannot resurrect a session the user already abandoned.
const sessionEpoch = new Map<string, object>();

// Startup, teardown, and replacement serialize through this chain per thread:
// concurrent first sends share one startup, and a failed start lets the next
// waiter retry exactly once ownership is rechecked.
const lifecycleByThread = new Map<string, Promise<void>>();
const { ensure: ensureLive } = createRecyclingLifecycle<SendTurnInput, Live>({
  epochs: sessionEpoch,
  queue: lifecycleByThread,
  live: liveByThread,
  resume: resumeByThread,
  teardown: teardownLive,
  start: startLive,
  prepare: (input, life) => {
    const setup = prepareSetup(input);
    return {
      start: () => startLive(input, life, setup),
      retire: (error) => preserveProviderFailure(error, retireSetup(input.sessionId, setup)),
    };
  },
  supersededMessage: "Antigravity session superseded",
});

// A startup that has spawned but not yet published its Live owns no entry in
// liveByThread, so cancel/stop would otherwise find nothing to unwind and the
// next send would queue behind the 45s session-request timeout. Registering
// the in-flight setup lets user intent reject its wire calls and kill its
// child immediately.
const pendingSetupByThread = new Map<
  string,
  { handle: ChildProcessHandle; acp?: AcpClient; childKey: string; operation?: object }
>();
// Turns serialize per thread, not per Live: a recycled transport must not let
// a queued send run concurrently on the replacement.
const turnsByThread = new Map<string, Promise<void>>();
let childSeq = 0;

/** Live Antigravity adapter. Spawns `agy_acp_server.par`, not `agy acp`. */
export async function sendAntigravityTurn(input: SendTurnInput): Promise<void> {
  assertProviderOperation(input.operationContext);

  input = { ...input };
  const releaseEpoch = holdProviderEpoch([cancelEpoch, sessionEpoch], input.sessionId);

  try {
    const epoch =
      cancelEpoch.get(input.sessionId) ??
      cancelEpoch.set(input.sessionId, {}).get(input.sessionId)!;
    const cancelled = () => cancelEpoch.get(input.sessionId) !== epoch;
    try {
      // Eager prewarm only starts a child when none exists — it never tears down
      // a parked transport, so a queued send can never interrupt a running turn.
      const prewarmed = await withSlowStartupNotice(input.onEvent, "Antigravity", () =>
        ensureLive(input, false),
      );
      observeProviderProcess(input, prewarmed.handle);
    } catch (error) {
      if (cancelled()) {
        assertOptionalProviderProbeError(error);
        return;
      }
      throw error;
    }
    if (cancelled()) return;

    const run = continueAfterFailure(
      turnsByThread.get(input.sessionId) ?? Promise.resolve(),
      async () => {
        if (cancelled()) return;
        let live: Live;
        try {
          // This send owns the turn: it may recycle a stale or wrong-cwd
          // transport. A superseded step (cancel/stop/forget while queued) is a
          // quiet no-op, not an error.
          live = await ensureLive(input, true);
        } catch (error) {
          if (cancelled()) {
            assertOptionalProviderProbeError(error);
            return;
          }
          throw error;
        }
        if (cancelled()) return;
        // Bind the listener and policy only when this turn actually starts, so a
        // queued send cannot redirect or repolicy the turn still running.
        observeProviderProcess(input, live.handle);
        beginProviderOperation(input.operationContext, live.handle);
        const acp = await acpTurnWriter(
          live.handle,
          live.acp,
          input.nativeControlTurn,
          input.operationContext,
        );
        live.onEvent = input.onEvent;
        live.runtimeMode = input.runtimeMode;
        live.planning = input.intent === "plan";
        live.cancelled = false;
        live.muteUpdates = false;
        // From here until the prompt settles, a cancel can interrupt an
        // in-flight state-changing request whose server-side effect is
        // unknowable — mark the transport stale so the next send recycles.
        live.turnActive = true;
        try {
          await applyModelSelection(live, input, acp);
          if (live.cancelled || cancelled()) return;
          await applyRuntimeMode(live, input.runtimeMode, input.intent === "plan", acp);
          if (live.cancelled || cancelled()) return;
          await prompt(live, input, acp);
        } catch (error) {
          if (live.cancelled) return;
          // A timed-out or failed turn leaves the process state unknowable. Keep
          // its provider session id, but recycle this generation's child so the
          // next turn resumes on a fresh transport. Skip if a newer live already
          // replaced it — the teardown below is generation-checked.
          if (liveByThread.get(input.sessionId) === live) {
            return preserveProviderFailure(error, teardownLive(live));
          }
          throw error;
        } finally {
          live.turnActive = false;
        }
      },
    );
    turnsByThread.set(input.sessionId, run);
    try {
      await run;
    } finally {
      if (turnsByThread.get(input.sessionId) === run) {
        turnsByThread.delete(input.sessionId);
      }
    }
  } finally {
    releaseEpoch();
    finishProviderOperation(input.operationContext);
  }
}

export { steerAntigravityTurn } from "./antigravitySteer";

export function respondAntigravityApproval(
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

export async function cancelAntigravityTurn(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const original = liveByThread.get(sessionId) ?? pendingSetupByThread.get(sessionId);
  // A captured cancellation must not affect a newer operation.
  if (!ownsOperation(context, original?.handle, original?.operation)) return;
  cancelEpoch.set(sessionId, {});
  // Also retire queued/in-flight lifecycle work: a cancel before the child
  // exists must not leave a process spawning in the background.
  sessionEpoch.set(sessionId, {});
  const pending = abortPendingSetup(sessionId, context);
  const live = liveByThread.get(sessionId);
  if (!live) {
    await pending;
    return;
  }
  const acp = context
    ? await acpTurnWriter(live.handle, live.acp, context.nativeControlTurn, context, "control")
    : live.acp;
  if (!ownsOperation(context, live.handle, live.operation)) return;
  live.cancelled = true;
  live.muteUpdates = true;
  // A prompt cancelled on the wire may still be running server-side, and any
  // control request in flight may already have taken effect — either way this
  // transport's state is indeterminate, so the next send must not reuse it.
  if (live.turnActive) live.stale = true;
  cancelPendingApprovals(live.approvals);
  // Unwind the local turn first: a blocked stdin must not keep the UI's send
  // promise (or this cancel) wedged. The wire notify is best-effort.
  live.acp.rejectPending(new Error("cancelled"), { keepNativeOutput: true });
  void acp.notify("session/cancel", { sessionId: live.acpSessionId }).catch(() => undefined);
  await pending;
}

/**
 * Tear down exactly this generation: settle its approvals, close its client,
 * and kill only its child. Internal recycles go through here — they must NOT
 * bump the user-intent epochs or they would suppress unrelated queued sends.
 */
async function teardownLive(live: Live): Promise<void> {
  if (liveByThread.get(live.threadId) === live) {
    liveByThread.delete(live.threadId);
  }
  settleLive(live);
  live.acp.close();
  unwatchChild(live.handle);
  await retirements.retire([live.handle]);
}

export async function stopAntigravitySession(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  if (cancelQueuedOperation(context)) return;

  const original = liveByThread.get(sessionId) ?? pendingSetupByThread.get(sessionId);
  if (!ownsOperation(context, original?.handle, original?.operation)) return;
  // Stopping the session invalidates work already queued for it, not just the
  // registered live — a send waiting its turn must not resurrect it.
  cancelEpoch.set(sessionId, {});
  sessionEpoch.set(sessionId, {});
  const pending = abortPendingSetup(sessionId, context);
  const live = liveByThread.get(sessionId);
  await settleProviderRetirements([
    pending,
    ...(live ? [teardownLive(live)] : []),
    ...(context ? [] : [retirements.retireOwner(sessionId)]),
  ]);
  retireProviderEpochs([cancelEpoch, sessionEpoch], turnsByThread, sessionId, lifecycleByThread);
}

/**
 * A setup still inside initialize/session requests owns no Live yet — reject
 * its pending wire calls and kill its child so a cancel or stop lands
 * immediately instead of surfacing after the session-request timeout.
 */
function abortPendingSetup(sessionId: string, context?: HarnessOperationContext): Promise<void> {
  const pending = pendingSetupByThread.get(sessionId);
  if (!pending || !ownsOperation(context, pending.handle, pending.operation))
    return Promise.resolve();
  // close() both rejects in-flight requests and makes any further request on
  // this client fail immediately — a cancelled setup cannot fall through the
  // resume/load/new ladder into another 45s wait.
  pending.acp?.close(new Error("cancelled"));
  return retirements.retire([pending.handle]);
}

export async function forgetAntigravitySession(
  sessionId: string,
  context?: HarnessOperationContext,
): Promise<void> {
  // Delete/switch must end the process: a context that no longer owns it falls
  // back to a by-session stop instead of returning with the process alive.
  resumeByThread.delete(sessionId);
  const queuedOnly = cancelQueuedOperation(context);
  const original = liveByThread.get(sessionId) ?? pendingSetupByThread.get(sessionId);
  const owned =
    !queuedOnly && (!original || ownsOperation(context, original.handle, original.operation));
  await stopAntigravitySession(sessionId, owned ? context : undefined);
  retireProviderEpochs([cancelEpoch, sessionEpoch], turnsByThread, sessionId, lifecycleByThread);
}

export function bindAntigravitySession(threadId: string, acpSessionId: string, cwd: string): void {
  const sessionId = acpSessionId.trim();
  if (!threadId || !sessionId || !cwd.trim()) return;
  resumeByThread.set(threadId, { acpSessionId: sessionId, cwd });
}

/** Terminal settle for a retired transport: stop the clock and release waits. */
function settleLive(live: Live): void {
  live.cancelled = true;
  live.muteUpdates = true;
  live.promptInFlight = false;
  if (live.watchdog) {
    cancelNativeOutputCallback(live.watchdog);
    live.watchdog = undefined;
  }
  cancelPendingApprovals(live.approvals);
}

/**
 * Server silence is ambiguous — a quiet tool call and a wedged post-turn hook
 * look identical on the wire. Past STALL_NOTIFY_MS we only surface a status so
 * the user knows a stop-and-resend is the recovery path; nothing is killed.
 * Re-armed by any inbound traffic and after an approval resolves.
 */
function noteActivity(live: Live): void {
  live.stallNotified = false;
  if (!live.promptInFlight) return;
  if (live.watchdog) cancelNativeOutputCallback(live.watchdog);
  live.watchdog = scheduleNativeOutputCallback(() => {
    live.watchdog = undefined;
    if (liveByThread.get(live.threadId) !== live) return;
    if (!live.promptInFlight || live.approvals.size > 0) return;
    if (live.stallNotified) return;
    live.stallNotified = true;
    live.onEvent({
      type: "status",
      text: "Antigravity has been quiet for two minutes — its post-turn work may be stuck. Stop and resend to recover.",
    });
  }, STALL_NOTIFY_MS);
}

/**
 * One lifecycle operation at a time per thread: teardown of a stale or
 * wrong-cwd live and the next startup run inside the same chain, so a queued
 * send can never overlap a recycle or a failed attempt's cleanup. The session
 * epoch captured at submission bounds the whole step — a cancel, stop, or
 * forget landing mid-step retires it instead of letting it publish a session
 * the user already abandoned.
 */

type PreparedSetup = {
  handle: ChildProcessHandle;
  acp?: AcpClient;
  childKey: string;
  operation?: object;
};
function prepareSetup(input: SendTurnInput): PreparedSetup {
  assertProviderOperation(input.operationContext);

  const childKey = `${input.sessionId}#${childSeq++}`;
  const handle = retirements.admitPending(
    createChildProcessHandle(childKey, input.nativeControlTurn),
    input.sessionId,
  );
  observeProviderProcess(input, handle, "starting");
  const setup = { handle, childKey, operation: input.operationContext?.operation };
  pendingSetupByThread.set(input.sessionId, setup);
  return setup;
}
function retireSetup(sessionId: string, setup: PreparedSetup): Promise<void> {
  if (pendingSetupByThread.get(sessionId) === setup) pendingSetupByThread.delete(sessionId);
  setup.acp?.close();
  return retirements.retire([setup.handle]);
}
async function startLive(
  input: SendTurnInput,
  life: object,
  prepared?: PreparedSetup,
): Promise<Live> {
  assertProviderOperation(input.operationContext);

  const resume = resumeByThread.get(input.sessionId);
  const canLoad = resume != null && resume.cwd === input.cwd;
  if (resume && resume.cwd !== input.cwd) {
    resumeByThread.delete(input.sessionId);
  }

  const retired = () => sessionEpoch.get(input.sessionId) !== life;
  if (retired()) throw new Error("Antigravity session stopped during startup");
  const pendingSetup = prepared ?? prepareSetup(input);
  const { handle, childKey } = pendingSetup;
  const clearPending = () => {
    if (pendingSetupByThread.get(input.sessionId) === pendingSetup) {
      pendingSetupByThread.delete(input.sessionId);
    }
  };
  const liveRef: { current: Live | null } = { current: null };
  try {
    const { path, args } = await resolveAntigravityBinary();
    if (retired()) throw new Error("Antigravity session stopped during startup");
    const handlers: AcpHandlers = {};
    const acp = new AcpClient(handle, handlers);
    pendingSetup.acp = acp;

    handlers.onNotification = (method, params) => {
      const live = liveRef.current;
      if (!live) return;
      noteActivity(live);
      handleNotification(live, method, params);
    };
    handlers.onRequest = (id, method, params) => {
      const live = liveRef.current;
      if (live) noteActivity(live);
      if (!live) {
        void acp
          .respondError(id, {
            code: -32601,
            message: `Method not found: ${method}`,
          })
          .catch(() => undefined);
        return;
      }
      return handleRequest(live, id, method, params).catch((error) => {
        // A reply that could not be written is a transport failure: the provider
        // is still waiting for an answer that will never arrive. Fail the
        // generation so the owning turn unwinds instead of hanging on the prompt
        // deadline. Already-retired or cancelled generations stay quiet.
        if (liveByThread.get(live.threadId) !== live || live.cancelled) return;
        live.stale = true;
        acp.close(error instanceof Error ? error : new Error(String(error)));
      });
    };

    // startLive runs once per session, so these handlers outlive the turn that
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
        unwatchChild(handle);
        const live = liveRef.current;
        if (liveByThread.get(input.sessionId) === live) {
          liveByThread.delete(input.sessionId);
        }
        // Settle before closing so in-flight requests unwind as cancelled rather
        // than surfacing a transport error for a dead process.
        if (live) settleLive(live);
        acp.close(new Error("Antigravity exited"));
        // A generation retired by user intent settles quietly — no session.ended
        // for a setup the user already cancelled or stopped.
        if (live || !retired()) emit({ type: "session.ended", code });
      },
      (line) => {
        console.debug("[bycoda] antigravity stderr", line);
      },
    );

    // Binary resolution awaited above may have raced a stop/forget — re-check
    // before the child is ever spawned, not just after.
    if (retired()) throw new Error("Antigravity session stopped during startup");
    await spawnChild(
      handle,
      path,
      args,
      antigravitySpawnCwd(path, input.cwd),
      undefined,
      "antigravity",
      undefined,
      undefined,
      undefined,
      input.nativeOutputSessionId,
    );
    if (retired()) throw new Error("Antigravity session stopped during startup");
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
      throw antigravityError(error);
    }

    let setup: SessionSetupResult | undefined;
    let acpSessionId: string | undefined;
    let didLoad = false;

    if (canLoad && resume) {
      try {
        setup = await startupAcp.request<SessionSetupResult>(
          "session/resume",
          { sessionId: resume.acpSessionId, cwd: input.cwd, mcpServers: [] },
          SESSION_TIMEOUT_MS,
        );
        acpSessionId = sessionIdFromResult(setup) ?? resume.acpSessionId;
        didLoad = true;
      } catch (error) {
        // User intent wins over the fallback ladder — a retired setup must not
        // continue into session/load and wait out another timeout.
        if (retired()) throw new Error("Antigravity session stopped during startup");
        // A resume that timed out may still be executing server-side; never
        // stack session/load or a fresh session on top of it — fail the send
        // and let the next turn retry on a recycled transport.
        if (isTimeout(error)) throw error;
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
        } catch (loadError) {
          if (retired()) throw new Error("Antigravity session stopped during startup");
          if (isTimeout(loadError)) throw loadError;
          setup = undefined;
          acpSessionId = undefined;
          didLoad = false;
        }
      }
    }

    if (!acpSessionId) {
      if (retired()) throw new Error("Antigravity session stopped during startup");
      const droppedBinding = canLoad && resume != null;
      setup = await startupAcp.request<SessionSetupResult>(
        "session/new",
        { cwd: input.cwd, mcpServers: [] },
        SESSION_TIMEOUT_MS,
      );
      acpSessionId = sessionIdFromResult(setup);
      if (acpSessionId && droppedBinding) {
        emit({
          type: "status",
          text: "Antigravity could not restore the previous conversation — starting a new session.",
        });
      }
    }
    if (!acpSessionId) throw new Error("Antigravity did not return a session id");
    if (retired()) throw new Error("Antigravity session stopped during startup");

    const configOptions = readConfigOptions(setup?.configOptions);
    const live: Live = {
      operation: input.operationContext?.operation,
      handle,
      threadId: input.sessionId,
      childKey,
      subagents: new AcpSubagents(),
      acp,
      acpSessionId,
      cwd: input.cwd,
      modelConfigId: extractModelConfigId(configOptions),
      configOptions,
      muteUpdates: didLoad,
      cancelled: false,
      stale: false,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      promptInFlight: false,
      turnActive: false,
      stallNotified: false,
    };
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    resumeByThread.set(input.sessionId, {
      acpSessionId,
      cwd: input.cwd,
    });
    // Registration ends before the first listener callback: a cancel reentered
    // from onEvent must take the live path, never abortPendingSetup — closing
    // this client now would orphan the just-published transport.
    clearPending();
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: acpSessionId,
    });
    live.onEvent({ type: "session.started" });
    return live;
  } catch (error) {
    // Clean up only this generation's child — a successor may already own the
    // thread slot, so nothing here may touch the thread-keyed maps. A listener
    // that threw post-publish is the exception: drop the dead transport this
    // generation registered so the next send cannot reuse it.
    pendingSetup.acp?.close(error instanceof Error ? error : new Error(String(error)));
    if (liveRef.current != null && liveByThread.get(input.sessionId) === liveRef.current) {
      liveByThread.delete(input.sessionId);
    }
    return preserveProviderFailure(antigravityError(error), retirements.retire([handle]));
  } finally {
    clearPending();
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

  await setConfigOption(live, modelConfigId, base, acp);

  for (const [settingId, value] of Object.entries(settings)) {
    const configId = resolveSettingConfigId(live.configOptions, settingId);
    if (!configId || configId === "provider") continue;
    await setConfigOption(live, configId, value, acp);
  }
}

async function applyRuntimeMode(
  live: Live,
  runtimeMode: RuntimeMode,
  planning = false,
  acp: AcpWriterView,
): Promise<void> {
  // Fail closed: a rejected downgrade must not leave a prior yolo mode active.
  await acp.request(
    "session/set_mode",
    {
      sessionId: live.acpSessionId,
      modeId: antigravityModeId(runtimeMode, planning),
    },
    CONTROL_TIMEOUT_MS,
  );
}

async function setConfigOption(
  live: Live,
  configId: string,
  value: string | boolean,
  acp: AcpWriterView,
): Promise<void> {
  const current = live.configOptions.find((option) => option.id === configId);
  // session/set_config_option is only valid for options the session itself
  // advertised via configOptions — sending an unadvertised id is a protocol
  // violation the provider may reject or ignore unpredictably.
  if (!current) return;
  // Boolean options take the typed {type:"boolean", value:boolean} variant;
  // everything else is a value-id string (the wire default when type absent).
  const isBool = current.type === "boolean";
  if (isBool && typeof value !== "boolean" && value !== "true" && value !== "false") {
    // A boolean option can only carry a boolean — a stray string (e.g. a model
    // id that resolved here by accident) must not be coerced into `false`.
    return;
  }
  const boolValue = value === true || value === "true";
  const already = isBool
    ? current.currentValue === boolValue
    : String(current.currentValue ?? "") === String(value);
  if (already) return;

  const params: Record<string, unknown> = {
    sessionId: live.acpSessionId,
    configId,
    value: isBool ? boolValue : String(value),
  };
  if (isBool) params.type = "boolean";
  const result = await acp.request<SessionSetupResult>(
    "session/set_config_option",
    params,
    CONTROL_TIMEOUT_MS,
  );
  if (Array.isArray(result?.configOptions)) {
    live.configOptions = readConfigOptions(result.configOptions);
    live.modelConfigId = extractModelConfigId(live.configOptions);
  }
}

async function prompt(live: Live, input: SendTurnInput, acp: AcpWriterView): Promise<void> {
  const responseScope: { work: NativeOutputWork | null } = { work: null };
  const emitNative = (event: HarnessEvent) =>
    nativeOutputSink(responseScope.work, () => live.onEvent(event))();
  try {
    try {
      const blocks = antigravityPromptBlocks(input.text, input.attachments);
      if (blocks.length === 0) return;
      live.promptInFlight = true;
      nativeOutputSink(responseScope.work, noteActivity)(live);
      const response = acp.request(
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
      input.onAccepted?.();
      const result = await response;
      const stopReason = asRecord(result)?.stopReason;
      if (live.cancelled || stopReason === "cancelled") return;
      // A fulfilled request is not necessarily a normal end: refusals,
      // truncations, and provider-specific reasons all surface as errors.
      if (stopReason != null && stopReason !== "end_turn") {
        emitNative({
          type: "session.error",
          message: `Antigravity ended the turn (${String(stopReason)}).`,
        });
        return;
      }
      emitNative({ type: "message.completed" });
      emitNative({ type: "reasoning.completed" });
    } catch (error) {
      if (live.cancelled) return;
      const failure = antigravityError(error);
      emitNative({
        type: "session.error",
        message: failure.message,
      });
      throw failure;
    } finally {
      live.promptInFlight = false;
      if (live.watchdog) {
        cancelNativeOutputCallback(live.watchdog);
        live.watchdog = undefined;
      }
    }
  } finally {
    responseScope.work?.finish();
  }
}

function handleNotification(live: Live, method: string, params: unknown) {
  if (method !== "session/update") return;
  const rec = asRecord(params);
  const update = asRecord(rec?.update) ?? rec;
  // Config state stays fresh even while the transcript is muted — a stale
  // currentValue would resend set_config_option for a value already applied.
  if (update?.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
    live.configOptions = readConfigOptions(update.configOptions);
    live.modelConfigId = extractModelConfigId(live.configOptions);
  }
  if (live.muteUpdates) return;
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
    // Propagate: the caller turns a failed response write into a transport
    // failure for the active generation, so the provider cannot wedge waiting
    // for a reply that never left the pipe.
    await nativeOutputSink(outputWork, () =>
      live.acp.respondError(id, {
        code: -32601,
        message: `Method not found: ${method}`,
      }),
    )();
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
      // Protocol replies always flow; UI events are gated on the turn still being
      // live so a cancelled run cannot leave approval cards behind.
      if (request.callId && live.promptInFlight && !live.cancelled && !live.muteUpdates) {
        emitNative({
          type: "tool.updated",
          callId: request.callId,
          title: request.title,
          kind: request.kind,
          preview: request.preview,
        });
      }
      let optionId: string | null;
      let pending: PendingApproval | undefined;
      try {
        if (
          !live.promptInFlight ||
          live.cancelled ||
          live.muteUpdates ||
          request.optionIds.length === 0
        ) {
          optionId = null;
        } else if (live.planning) {
          optionId = permissionOptionId(
            request.kind === "read" || request.kind === "search" ? "allow" : "deny",
            request.optionIds,
            request.optionKinds,
          );
        } else {
          optionId = autoPermissionOption(
            live.runtimeMode,
            request.kind,
            request.optionIds,
            request.optionKinds,
          );
          if (!optionId) {
            pending = createPendingApproval((occurrenceId, decision) =>
              emitNative({ type: "approval.resolved", requestId: id, occurrenceId, decision }),
            );
            const { occurrenceId } = pending;
            live.approvals.set(id, pending);
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
            // The approval wait itself was the silence; restart the stall clock.
            nativeOutputSink(outputWork, noteActivity)(live);
            // Always close the card — even a cancelled/exited turn must not leave a
            // pending approval rendered as actionable.
            pending.report(decision);
            if (!Array.from(liveByThread.values()).includes(live)) return;
            optionId =
              live.cancelled || pending.invalidated
                ? null
                : permissionOptionId(
                    decision === "allow" ? "allow" : "deny",
                    request.optionIds,
                    request.optionKinds,
                  );
          }
        }
        await nativeOutputSink(outputWork, () => {
          if (pending) {
            if (!Array.from(liveByThread.values()).includes(live)) return Promise.resolve();
            if (!ownsPendingApproval(live.approvals, id, pending)) {
              pending.report("cancelled");
              optionId = null;
            }
          }
          return live.acp.respond(
            id,
            {
              outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
            },
            pending ? observePendingApprovalWrite(live.approvals, id, pending) : undefined,
          );
        })();
      } finally {
        if (pending) releasePendingApproval(live.approvals, id, pending);
      }
    },
    { additionalInput: true },
  );
}
