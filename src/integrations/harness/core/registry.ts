import type {
  Block,
  HarnessId,
  TaskListMeta,
  TurnIntent,
} from "../../../features/sessions/model/session";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  forgetRuntimeHint,
  harnessRuntimeHints,
  markRuntimeHintDelivered,
  pendingRuntimeHint,
  turnCarriesRuntimeHint,
  withRuntimeHint,
} from "./runtimeGuidance";
import { providerInput, providerInputCopy, providerTurnInput } from "./providerInput";
import {
  conversationDelegationReady,
  delegationFallback,
  delegationNotice,
} from "./delegationReadiness";
import type { GeneratedSessionTitle } from "../../../features/sessions/model/sessionTitle";
import type { PrContent } from "../../../features/source-control/model/gitText";
import {
  defaultModelId,
  hasLiveCatalog,
  modelBelongsToHarness,
  nativeModelId,
} from "../../../features/sessions/model/models";
import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import type { NativeCommandProvider } from "./nativeCommands";
import { loadSkillRestrictions } from "../../../features/skills/model/skillPreferences";
import { withInstalledSkillScope } from "../../../features/skills/model/skillProviderScope";
import { loadProviderSkillCandidates } from "./skillCandidates";
import { withSkillPolicy } from "./skillPolicy";
import {
  captureChildProcess,
  captureChildControlTurn,
  hasHeadlessChildBackend,
  type ChildProcessHandle,
} from "./child";
import { flushHostSessionBindings } from "../../../features/connections/model/sessionExecutionBinding";
import {
  acquireNativeSessionClaim,
  markNativeSessionClaim,
  settleNativeSessionClaim,
} from "../../../features/connections/model/hostSessionBindingDatabase";
import {
  beginNativeControlTurn,
  finishNativeControlTurn,
  nativeControlTurnReceipt,
  type ControlTurnHandle,
} from "./controlTurn";
import { drainRetirementsForWriter, retireProviderOwner } from "./providerRetirement";
import { beginHandoffPhase } from "./handoffPhase";
import { formatDuration } from "../../../shared/i18n/format";
import { t } from "../../../shared/i18n/core";
import { TurnNotReadyError } from "./types";
import { retireProviderEpoch, retireProviderOwnerAndCommands } from "./providerEpoch";
import { releaseOwnedOpenCodeForCapability } from "../providers/opencode/opencodeService";

async function operationSkillPolicy(cwd: string, provider: string) {
  const policy = await loadSkillRestrictions(cwd);
  // Unit/fixture callers outside native desktop have no filesystem bridge.
  if (!cwd.startsWith("remote://") && !(typeof isTauri === "function" && isTauri())) return policy;
  return withInstalledSkillScope(
    policy,
    provider,
    await loadProviderSkillCandidates(cwd, provider),
  );
}
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessOperationContext,
  HarnessSessionInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  model?: string;
  modelSettings?: Record<string, string>;
  operationContext?: HarnessOperationContext;
  providerAccountId?: string;
};

/** One-shot, isolated text generation shared by titles and side questions. */
export type TextPromptInput = {
  cwd: string;
  operationContext?: HarnessOperationContext;
  providerAccountId?: string;
  model?: string;
  modelSettings?: Record<string, string>;
  /** Codex defaults to unsaved threads; false allows resumable side questions. */
  ephemeral?: boolean;
  threadId?: string;
  onThreadId?: (threadId: string) => void | Promise<void>;
  /** Internal isolated-thread maintenance; never a user/project session command. */
  compactBefore?: boolean;
  onCompacted?: (receipt: { threadId: string }) => Promise<void>;
  intent?: TurnIntent;
  prompt: string;
  /** Internal isolated utility allowance; adapters must not invent unsupported provider fields. */
  maxOutputTokens?: number;
  /** Local bound on received assistant/reasoning text, not provider tokens or charges. */
  maxOutputChars?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

/**
 * Lifecycle contract for a live harness adapter.
 * App.tsx dispatches through the registry instead of harness-specific branches.
 */
export type HarnessAdapter = {
  id: HarnessId;
  /** True when this adapter can run live turns. */
  live: boolean;
  /** False when the harness cannot accept a follow-up while a turn is running. Default: same as live. */
  canSteer?: boolean;
  /** True when a steered follow-up carries its own model settings (effort) into the running turn. */
  steerAppliesSettings?: boolean;
  commands?: NativeCommandProvider;
  sendTurn(input: SendTurnInput): Promise<void>;
  /** Trigger provider-owned compaction outside Bycoda's normal user-turn path. */
  compactContext?(input: CompactContextInput): Promise<void>;
  /** Rewind provider state so the last user turn can be replaced. */
  rewindLastTurn?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string, context?: HarnessOperationContext): Promise<void>;
  /**
   * Stop one running subagent or background command (`callId` is its tool
   * call), or every one of them when omitted, without interrupting the turn.
   * Only a harness whose protocol can stop a task by id offers it.
   */
  stopBackgroundWork?(
    sessionId: string,
    callId?: string,
    context?: HarnessOperationContext,
  ): Promise<void>;
  respondApproval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
    approvalOccurrenceId?: string,
  ): void;
  /** False when nothing is waiting for the answer (it was not delivered); void or true otherwise. */
  respondQuestion?(sessionId: string, requestId: number, reply: UserQuestionReply): boolean | void;
  /** Keep a timed question open once the user starts answering it. */
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string, context?: HarnessOperationContext): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string, context?: HarnessOperationContext): Promise<void>;
  /** Seed resume state from a restored Bycoda session. */
  bindSession(
    threadId: string,
    providerSessionId: string,
    cwd: string,
    providerAccountId?: string,
  ): void;
  /** Seed provider task state from a restored session's persisted panels. */
  restoreTaskLists?(threadId: string, lists: TaskListMeta[]): void;
  /** Refresh the model catalog overlay when supported. */
  refreshCatalog?(): Promise<void>;
  /** Optional LLM tab title for the first turn. */
  generateTitle?(input: TitleInput): Promise<GeneratedSessionTitle | null>;
  /** Optional LLM commit message from staged changes. */
  generateCommitMessage?(
    cwd: string,
    signal?: AbortSignal,
    context?: HarnessOperationContext,
  ): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(
    cwd: string,
    context?: HarnessOperationContext,
  ): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(
    cwd: string,
    message: string,
    context?: HarnessOperationContext,
  ): Promise<string | null>;
  /** Optional warmup for text-generation backends. Options match a later
   * `runTextPrompt` so that request can reuse the warm process. */
  warmupText?(cwd: string, options?: TextWarmupOptions): Promise<void>;
  /** Run an isolated, read-only prompt without mutating the main session. */
  runTextPrompt?(input: TextPromptInput): Promise<string>;
  /** Stop an isolated text-generation backend. */
  stopTextPrompt?(): Promise<void>;
};

/** Capabilities come from the registered adapter, not a second hardcoded matrix.
 * Missing features are protocol/UI limitations and must stay unavailable.
 */
export type HarnessTelemetryEvent =
  | "context"
  | "turn.metrics"
  | "usage"
  | "usage.limited"
  | "image.generated";
/** Events mapped by live provider protocols. These are optional when the CLI
 * omits their source data; availability is not a promise of emission every turn.
 * Cursor/Hermes/generic ACP currently expose no compatible usage payload.
 */
export const HARNESS_TELEMETRY_CAPABILITIES: Record<HarnessId, readonly HarnessTelemetryEvent[]> = {
  claude: ["context", "turn.metrics", "usage", "usage.limited"],
  codex: ["context", "turn.metrics", "usage.limited", "image.generated"],
  cursor: [],
  grok: ["context", "turn.metrics"],
  opencode: ["context", "turn.metrics"],
  pi: ["context", "turn.metrics"],
  omp: ["context", "turn.metrics"],
  fx: ["context", "turn.metrics"],
  hermes: [],
  antigravity: ["context", "turn.metrics"],
  acp: [],
};
export type HarnessCapabilities = {
  live: boolean;
  steer: boolean;
  compactContext: boolean;
  rewindLastTurn: boolean;
  stopBackgroundWork: boolean;
  respondQuestion: boolean;
  generateCommitMessage: boolean;
  generatePrContent: boolean;
  telemetry: readonly HarnessTelemetryEvent[];
};
export function harnessCapabilities(id: HarnessId): HarnessCapabilities | undefined {
  const adapter = adapters.get(id);
  if (!adapter) return undefined;
  return {
    live: adapter.live,
    steer: adapter.canSteer ?? adapter.live,
    compactContext: adapter.compactContext != null,
    rewindLastTurn: adapter.rewindLastTurn != null,
    stopBackgroundWork: adapter.stopBackgroundWork != null,
    respondQuestion: adapter.respondQuestion != null,
    generateCommitMessage: adapter.generateCommitMessage != null,
    generatePrContent: adapter.generatePrContent != null,
    telemetry: HARNESS_TELEMETRY_CAPABILITIES[id],
  };
}
export function harnessCapabilityTable(): {
  id: HarnessId;
  capabilities: HarnessCapabilities;
}[] {
  return [...adapters.keys()].map((id) => ({
    id,
    capabilities: harnessCapabilities(id)!,
  }));
}

const adapters = new Map<HarnessId, HarnessAdapter>();

/**
 * After a turn settles, keep the child warm for follow-ups, then park it.
 * Resume state stays, so the next prompt respawns instead of starting over.
 */
export const HARNESS_IDLE_PARK_MS = 5 * 60_000;
const idleParkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retainedWriters = new Map<string, HarnessId>();
// A claim survives turn completion and follows the warm physical writer. A
// rejected/unknown acquisition stays in this map: silently issuing another ID
// could overlap an accepted original request.
const nativeSessionClaims = new Map<
  string,
  Promise<import("./controlTurn").NativeSessionCapability | null>
>();
function captureNativeSessionClaim(
  sessionId: string,
): Promise<import("./controlTurn").NativeSessionCapability | null> | undefined {
  if (!(typeof isTauri === "function" && isTauri()) || hasHeadlessChildBackend()) return undefined;
  const existing = nativeSessionClaims.get(sessionId);
  if (existing) return existing;
  let acquisitionStarted = false;
  const claim: Promise<import("./controlTurn").NativeSessionCapability | null> = (async () => {
    await flushHostSessionBindings(sessionId);
    acquisitionStarted = true;
    const capability = await acquireNativeSessionClaim(sessionId);
    if (capability) await markNativeSessionClaim(capability);
    return capability;
  })().catch((error: unknown) => {
    // A failure before native admission is known unstarted and can be retried.
    if (!acquisitionStarted && nativeSessionClaims.get(sessionId) === claim)
      nativeSessionClaims.delete(sessionId);
    throw error;
  });
  // The caller can be cancelled before reaching its queued operation.
  void claim.catch(() => undefined);
  nativeSessionClaims.set(sessionId, claim);
  return claim;
}
async function confirmCapturedNativeClaim(
  sessionId: string,
  claim: Promise<import("./controlTurn").NativeSessionCapability | null> | undefined,
): Promise<void> {
  if (!claim) return;
  await claim;
  if (nativeSessionClaims.get(sessionId) !== claim)
    throw new Error("The captured Native session owner retired before this operation started.");
}
const sessionOperationTails = new Map<string, Promise<void>>();
/** Idle releases the last turn left running; joined by the session's queue tail. */
const deferredIdleReleases = new Map<string, Promise<void>>();
const sessionSteerTails = new Map<string, Promise<void>>();
const activeTurnSessions = new Set<string>();
const nativeControlTurns = new Map<
  string,
  { handle: ControlTurnHandle; processes: Set<ChildProcessHandle> }
>();

/** Explicit stop captures this source observation before any await. */
export function captureHarnessControlTurn(
  sessionId: string,
  original: ChildProcessHandle | undefined,
): ControlTurnHandle | undefined {
  if (!original) return undefined;
  const active = nativeControlTurns.get(sessionId);
  if (active) {
    return active.processes.has(original) || captureChildControlTurn(original) === active.handle
      ? active.handle
      : undefined;
  }
  const control = captureChildControlTurn(original);
  return control && nativeControlTurnReceipt(control).sessionId === sessionId ? control : undefined;
}
const turnReady = new Map<string, Promise<void>>();
type TurnSubmission = {
  control: Promise<ControlTurnHandle | undefined>;
  resolveControl: (control: ControlTurnHandle | undefined) => void;
  owner?: AdapterOperation;
};
const turnSubmissions = new Map<string, TurnSubmission>();
const cancellationEpoch = new Map<string, number>();
type AdapterOperation = {
  adapter: HarnessAdapter;
  cancellation?: Promise<void>;
  /** The cached cancellation ran past STOP_CONFIRM_MS without the provider confirming. */
  cancellationUnconfirmed?: boolean;
  entered: boolean;
  operation: object;
  control?: ControlTurnHandle;
  processes: Set<ChildProcessHandle>;
};
// Only an invocation that entered the adapter owns its startup cancellation.
// Cancelling registry preparation must not create a provider startup tombstone.
const adapterOperations = new Map<string, AdapterOperation>();

function warnCleanup(label: string, error: unknown): void {
  console.warn(`[harness] ${label} failed`, error);
}

/** Operations are serialized per session, so an entry found here belongs to a
 * finished turn: drop it instead of failing the new one. */
function assertAdapterOperationReady(sessionId: string): void {
  if (!adapterOperations.has(sessionId)) return;
  warnCleanup("stale provider operation cleared", new Error(sessionId));
  adapterOperations.delete(sessionId);
}

/**
 * Wait for the previous provider processes of this session before a turn starts.
 * Only a process of the provider this turn is about to run can become a second
 * concurrent writer, so that wait still fails the turn. The old provider of a
 * handoff has finished its reply (and was already waited for by the handoff): a
 * slow or failed stop of it is warned about and the turn continues.
 */
async function drainRetirementsBestEffort(sessionId: string, harness: HarnessId): Promise<void> {
  await drainRetirementsForWriter(sessionId, harness, warnCleanup);
}

function beginAdapterOperation(
  sessionId: string,
  adapter: HarnessAdapter,
  control?: ControlTurnHandle,
  processes = new Set<ChildProcessHandle>(),
): AdapterOperation {
  assertAdapterOperationReady(sessionId);
  const owner: AdapterOperation = {
    adapter,
    entered: false,
    operation: Object.freeze({}),
    control,
    processes,
  };
  adapterOperations.set(sessionId, owner);
  return owner;
}

function operationContext(
  owner: AdapterOperation | undefined,
): HarnessOperationContext | undefined {
  if (!owner) return undefined;
  const originals = Object.freeze([...owner.processes]);
  return Object.freeze({
    operation: owner.operation,
    nativeControlTurn: owner.control,
    originalProcess: originals.length === 1 ? originals[0] : undefined,
    originalProcesses: originals,
  });
}

function operationInput<I extends HarnessSessionInput>(
  input: I,
  owner: AdapterOperation,
  delegationReady = true,
): I {
  return {
    ...providerTurnInput(input, nativeModelId, delegationReady),
    nativeControlTurn: owner.control,
    // This is the original operation identity, not a cleanup source cut. A
    // legitimate queued restart can select another construction after this call.
    // Fresh cleanup/steer observations still capture immutable source snapshots.
    operationContext: Object.freeze({
      operation: owner.operation,
      nativeControlTurn: owner.control,
    }),
    onOriginalProcess: (original: ChildProcessHandle) => {
      if (adapterOperations.get(input.sessionId) !== owner)
        throw new Error("The original provider operation is no longer accepting constructions.");
      const birth = captureChildControlTurn(original);
      if (
        owner.control &&
        birth &&
        nativeControlTurnReceipt(birth).sessionId !==
          nativeControlTurnReceipt(owner.control).sessionId
      )
        throw new Error("The original process belongs to another logical session.");
      if (!owner.processes.has(original) && owner.processes.size >= 512)
        throw new Error("The original provider operation construction capacity is full.");
      owner.processes.add(original);
      input.onOriginalProcess?.(original);
    },
  };
}

async function beginOperationControl(
  input: HarnessSessionInput,
  claim: Promise<import("./controlTurn").NativeSessionCapability | null> | undefined,
): Promise<{
  control?: ControlTurnHandle;
  processes: Set<ChildProcessHandle>;
}> {
  const processes = new Set<ChildProcessHandle>();
  const original = captureChildProcess(input.sessionId);
  if (original) processes.add(original);
  const capability = await claim;
  const control =
    typeof isTauri === "function" && isTauri()
      ? await beginNativeControlTurn(
          input.sessionId,
          input.cwd,
          input.appAccess === true,
          invoke,
          capability ?? undefined,
        )
      : undefined;
  if (control) nativeControlTurns.set(input.sessionId, { handle: control, processes });
  activeTurnSessions.add(input.sessionId);
  return { control, processes };
}

const CONTROL_FINISH_WAIT_MS = 15_000;

async function endOperationControl(
  sessionId: string,
  control: ControlTurnHandle | undefined,
): Promise<void> {
  activeTurnSessions.delete(sessionId);
  if (!control) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The finish drains the turn's provider writes. A provider that stopped
    // reading its input must not hold this session's whole queue forever: the
    // finish keeps running, the next turn replaces this authorization natively.
    const finishing = finishNativeControlTurn(control);
    finishing.catch(() => undefined);
    await Promise.race([
      finishing,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          warnCleanup(
            "native control turn finish",
            new Error(`not confirmed within ${CONTROL_FINISH_WAIT_MS / 1000} s; continuing`),
          );
          resolve();
        }, CONTROL_FINISH_WAIT_MS);
      }),
    ]);
  } catch (error) {
    warnCleanup("native control turn finish", error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (nativeControlTurns.get(sessionId)?.handle === control) nativeControlTurns.delete(sessionId);
  }
}

async function finishAdapterOperation(sessionId: string, owner: AdapterOperation): Promise<void> {
  // Do not let the next turn reuse a transport while Stop is still retiring it.
  // With no accepted cancellation, relinquish routing synchronously. Yielding on
  // undefined would let a late Stop enter before deletion and then lose its work.
  try {
    const cancellation = owner.cancellation;
    if (cancellation) await cancellation;
  } catch (error) {
    warnCleanup("turn cancellation", error);
  } finally {
    if (adapterOperations.get(sessionId) === owner) {
      adapterOperations.delete(sessionId);
    }
  }
}

function queueSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  // A finished reply returns before its idle release (Codex writer stop) ends,
  // but the next operation on this session still queues behind that release,
  // so two writers never overlap.
  const settled = current
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      const release = deferredIdleReleases.get(sessionId);
      deferredIdleReleases.delete(sessionId);
      return release;
    });
  sessionOperationTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionOperationTails.get(sessionId) === settled) {
      sessionOperationTails.delete(sessionId);
    }
  });
  return current;
}

function queueSteerOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previousSteer = sessionSteerTails.get(sessionId) ?? Promise.resolve();
  // A live turn must remain steerable while its long-running send is pending.
  // Other provider-state operations still form a barrier for the steer.
  const barrier =
    turnReady.get(sessionId) ??
    (activeTurnSessions.has(sessionId)
      ? Promise.resolve()
      : (sessionOperationTails.get(sessionId) ?? Promise.resolve()));
  const current = Promise.all([
    previousSteer.catch(() => undefined),
    barrier.catch(() => undefined),
  ]).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  sessionSteerTails.set(sessionId, settled);
  void settled.then(() => {
    if (sessionSteerTails.get(sessionId) === settled) {
      sessionSteerTails.delete(sessionId);
    }
  });
  return current;
}

function cancelIdlePark(sessionId: string): void {
  const timer = idleParkTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  idleParkTimers.delete(sessionId);
}

function scheduleIdlePark(harness: HarnessId, sessionId: string): void {
  cancelIdlePark(sessionId);
  idleParkTimers.set(
    sessionId,
    setTimeout(() => {
      idleParkTimers.delete(sessionId);
      void queueSessionOperation(sessionId, () => stopHarnessSession(harness, sessionId)).catch(
        (error: unknown) => warnCleanup("idle park", error),
      );
    }, HARNESS_IDLE_PARK_MS),
  );
}

async function releaseIdleHarness(
  harness: HarnessId,
  sessionId: string,
  lightweightWorktree = false,
): Promise<void> {
  // Park Codex only while its held writer is reported to the Host. Ownership
  // transfer and idle expiry stop it before clearing that retained writer.
  // Untracked Codex operations still release the thread's writer immediately.
  // Never reject: a completed turn must not fail because its cleanup did.
  try {
    if (harness === "codex" && !lightweightWorktree && retainedWriters.get(sessionId) !== harness)
      await stopHarnessSession(harness, sessionId);
    else scheduleIdlePark(harness, sessionId);
  } catch (error) {
    warnCleanup("idle release", error);
  }
}

/** Test seam. */
export function resetHarnessIdlePark(): void {
  for (const timer of idleParkTimers.values()) clearTimeout(timer);
  idleParkTimers.clear();
}

export function registerHarness(adapter: HarnessAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getHarness(id: HarnessId): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarness(id: HarnessId): HarnessAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`No harness adapter registered for "${id}"`);
  }
  return adapter;
}

export function isLiveHarness(id: HarnessId): boolean {
  return adapters.get(id)?.live === true;
}

export function listHarnesses(): HarnessAdapter[] {
  return [...adapters.values()];
}

/** A model left over from another provider (stale after a switch/restore) is
 * remapped to this provider's default (empty means the CLI chooses). */
function assertHarnessModel(
  harness: HarnessId,
  input: { model?: string; modelSettings?: Record<string, string> },
): void {
  const model = input.model;
  if (model === undefined || modelBelongsToHarness(harness, model)) return;
  const fallback = defaultModelId(harness);
  console.warn(`[harness] model "${model}" is foreign to "${harness}"; using "${fallback}"`);
  input.model = fallback;
  input.modelSettings = undefined;
}

export function sendHarnessTurn(
  request: SendTurnInput & {
    harness: HarnessId;
    /** Local lifetime policy for a worktree with exact Git rewind disabled. */
    lightweightWorktree?: boolean;
    /** Local prompt preparation after runtime and skill guidance; never sent to a provider. */
    prepareText?: (text: string, runtimeInstructions?: string) => Promise<string>;
    /** The provider's final result arrived; before cleanup, so durations exclude it. */
    onReplyEnded?: (endedAt: number) => void;
  },
) {
  const { prepareText, lightweightWorktree, onReplyEnded, ...input } = request;
  const nativeClaim = captureNativeSessionClaim(input.sessionId);
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let resolveControl!: TurnSubmission["resolveControl"];
  const submission: TurnSubmission = {
    control: new Promise((resolve) => {
      resolveControl = resolve;
    }),
    resolveControl: (control) => resolveControl(control),
  };
  turnReady.set(input.sessionId, started);
  turnSubmissions.set(input.sessionId, submission);
  return queueSessionOperation(input.sessionId, async () => {
    try {
      await confirmCapturedNativeClaim(input.sessionId, nativeClaim);
      assertHarnessModel(input.harness, input);
      if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
        throw new Error("Turn cancelled before it started");
      const adapter = requireHarness(input.harness);
      if (!adapter.live) throw new Error(`${input.harness} is not connected yet`);
      assertAdapterOperationReady(input.sessionId);
      if (lightweightWorktree || input.harness === "codex")
        retainedWriters.set(input.sessionId, input.harness);
      cancelIdlePark(input.sessionId);
      await drainRetirementsBestEffort(input.sessionId, input.harness);
      const guidance = Promise.allSettled([
        input.modelSettings?.crossSubagents || input.modelSettings?.crossSubagentMaxEffort
          ? conversationDelegationReady(input.sessionId)
          : Promise.resolve(true),
        operationSkillPolicy(input.cwd, input.harness),
      ]);
      const { control: controlTurn, processes } = await beginOperationControl(input, nativeClaim);
      submission.resolveControl(controlTurn);
      try {
        const [readiness, policy] = await guidance;
        if (policy.status === "rejected") throw policy.reason;
        const thread = { harness: input.harness, providerAccountId: input.providerAccountId };
        const delegationReady = readiness.status === "fulfilled" && readiness.value;
        const fallback = delegationFallback(input.modelSettings, delegationReady);
        const runtime = await harnessRuntimeHints(
          input.sessionId,
          input.modelSettings,
          input,
          delegationReady,
        );
        const hint = pendingRuntimeHint(
          input.sessionId,
          thread,
          [runtime, fallback].filter(Boolean).join("\n"),
        );
        const text =
          input.harness === "codex" ? input.text : withRuntimeHint(input.harness, input.text, hint);
        const deliversHint = turnCarriesRuntimeHint(input.harness, input.text, text, hint);
        let delegationNoticePending = Boolean(fallback);
        const accepted = () => {
          if (delegationNoticePending) {
            delegationNoticePending = false;
            input.onEvent({
              type: "status",
              key: "delegation-unavailable",
              text: t(delegationNotice(fallback)),
            });
          }
          if (deliversHint) markRuntimeHintDelivered(input.sessionId, thread, hint);
          ready();
        };
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
          throw new Error("Turn cancelled before it started");
        const owner = beginAdapterOperation(input.sessionId, adapter, controlTurn, processes);
        submission.owner = owner;
        try {
          const restricted = withSkillPolicy(input.harness, input, policy.value);
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
            throw new Error("Turn cancelled before it started");
          const preparedInput = {
            ...restricted,
            ...(controlTurn ? { nativeControlTurn: controlTurn } : {}),
            ...(input.harness === "codex"
              ? {
                  runtimeInstructions:
                    [restricted.runtimeInstructions, hint].filter(Boolean).join("\n\n") ||
                    undefined,
                }
              : {
                  text: withSkillPolicy(input.harness, { ...input, text }, restricted.skillPolicy!)
                    .text,
                }),
          };
          if (prepareText)
            preparedInput.text = await prepareText(
              preparedInput.text,
              preparedInput.runtimeInstructions,
            );
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
            throw new Error("Turn cancelled before it started");
          owner.entered = true;
          const watchdog = createTurnWatchdog(input.harness, input.onEvent);
          watchdog.arm();
          let started = false;
          const deliver = (event: HarnessEvent) => {
            if (event.type === "turn.started") {
              started = true;
              accepted();
            }
            watchdog.observe(event);
            input.onEvent(event);
          };
          try {
            await adapter.sendTurn(
              operationInput(
                {
                  ...preparedInput,
                  onAccepted: () => {
                    accepted();
                    input.onAccepted?.();
                    // Most providers say nothing more until the model's first
                    // output, which withheld thinking can delay for a long
                    // time; the acceptance is what ends the wait for them.
                    if (!started) deliver({ type: "turn.started" });
                  },
                  onEvent: deliver,
                },
                owner,
                delegationReady,
              ),
            );
          } finally {
            watchdog.stop();
          }
          try {
            onReplyEnded?.(Date.now());
          } catch (error) {
            warnCleanup("reply end observer", error);
          }
        } finally {
          await finishAdapterOperation(input.sessionId, owner);
        }
      } finally {
        await endOperationControl(input.sessionId, controlTurn);
        // The reply is complete: do not hold the session busy while the provider
        // writer stops. The queue tail (see queueSessionOperation) still makes
        // the next operation wait for it. releaseIdleHarness never rejects.
        deferredIdleReleases.set(
          input.sessionId,
          releaseIdleHarness(input.harness, input.sessionId, lightweightWorktree),
        );
      }
    } finally {
      submission.resolveControl(undefined);
      ready();
      if (turnReady.get(input.sessionId) === started) turnReady.delete(input.sessionId);
      if (turnSubmissions.get(input.sessionId) === submission)
        turnSubmissions.delete(input.sessionId);
    }
  });
}

export function canCompactHarnessContext(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.compactContext != null;
}

export function compactHarnessContext(
  request: CompactContextInput & { harness: HarnessId },
): Promise<void> {
  const input = providerInputCopy(request);
  const nativeClaim = captureNativeSessionClaim(input.sessionId);
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  return queueSessionOperation(input.sessionId, async () => {
    await confirmCapturedNativeClaim(input.sessionId, nativeClaim);
    assertHarnessModel(input.harness, input);
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Compaction cancelled before it started");
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    if (!adapter.compactContext) {
      throw new Error(`${input.harness} does not support manual compaction`);
    }
    cancelIdlePark(input.sessionId);
    assertAdapterOperationReady(input.sessionId);
    await drainRetirementsBestEffort(input.sessionId, input.harness);
    const { control, processes } = await beginOperationControl(input, nativeClaim);
    try {
      const owner = beginAdapterOperation(input.sessionId, adapter, control, processes);
      try {
        const skillPolicy = await operationSkillPolicy(input.cwd, input.harness);
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
          throw new Error("Compaction cancelled before it started");
        owner.entered = true;
        await adapter.compactContext(operationInput({ ...input, skillPolicy }, owner));
        forgetRuntimeHint(input.sessionId);
      } finally {
        await finishAdapterOperation(input.sessionId, owner);
      }
    } finally {
      await endOperationControl(input.sessionId, control);
      await releaseIdleHarness(input.harness, input.sessionId);
    }
  });
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

/** True when steering applies the follow-up's model settings, so an effort change need not restart the turn. */
export function steerAppliesModelSettings(id: HarnessId): boolean {
  return canSteerHarness(id) && adapters.get(id)?.steerAppliesSettings === true;
}

export function canRewindHarnessLastTurn(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.rewindLastTurn != null;
}

export function rewindHarnessLastTurn(
  request: RewindLastTurnInput & { harness: HarnessId },
): Promise<RewindLastTurnResult> {
  const input = {
    ...request,
    modelSettings: request.modelSettings ? { ...request.modelSettings } : undefined,
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  };
  const nativeClaim = captureNativeSessionClaim(input.sessionId);
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  return queueSessionOperation(input.sessionId, async () => {
    await confirmCapturedNativeClaim(input.sessionId, nativeClaim);
    assertHarnessModel(input.harness, input);
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Edit cancelled before it started");
    const adapter = requireHarness(input.harness);
    if (!adapter.rewindLastTurn) {
      throw new Error(`${input.harness} does not support editing the last message`);
    }
    cancelIdlePark(input.sessionId);
    assertAdapterOperationReady(input.sessionId);
    await drainRetirementsBestEffort(input.sessionId, input.harness);
    const { control, processes } = await beginOperationControl(input, nativeClaim);
    try {
      const owner = beginAdapterOperation(input.sessionId, adapter, control, processes);
      try {
        const policy = await operationSkillPolicy(input.cwd, input.harness);
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
          throw new Error("Edit cancelled before it started");
        owner.entered = true;
        const result = await adapter.rewindLastTurn(
          operationInput(
            input.text === undefined
              ? { ...input, skillPolicy: policy }
              : withSkillPolicy(input.harness, { ...input, text: input.text }, policy),
            owner,
          ),
        );
        // The removed turn may have carried the hint; resend it next turn.
        forgetRuntimeHint(input.sessionId);
        return result;
      } finally {
        await finishAdapterOperation(input.sessionId, owner);
      }
    } finally {
      await endOperationControl(input.sessionId, control);
      await releaseIdleHarness(input.harness, input.sessionId);
    }
  });
}

export function steerHarnessTurn(request: SteerTurnInput & { harness: HarnessId }): Promise<void> {
  const input = {
    ...request,
    modelSettings: request.modelSettings ? { ...request.modelSettings } : undefined,
    attachments: request.attachments?.map((attachment) => ({ ...attachment })),
  };
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  const submission = turnSubmissions.get(input.sessionId);
  const sourceOwner = adapterOperations.get(input.sessionId);
  const sourceAdapter = adapters.get(input.harness);
  return queueSteerOperation(input.sessionId, async () => {
    assertHarnessModel(input.harness, input);
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Follow-up cancelled because the turn was stopped");
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    const originalOwner = submission ? submission.owner : sourceOwner;
    const assertOriginal = () => {
      if (
        sourceAdapter !== adapter ||
        adapters.get(input.harness) !== adapter ||
        (submission && !originalOwner) ||
        (originalOwner &&
          (!originalOwner.entered ||
            originalOwner.adapter !== adapter ||
            adapterOperations.get(input.sessionId) !== originalOwner))
      )
        throw new TurnNotReadyError("The original turn is no longer ready for a follow-up.");
    };
    assertOriginal();
    cancelIdlePark(input.sessionId);
    const control = submission ? await submission.control : sourceOwner?.control;
    const originalContext = operationContext(originalOwner);
    const policy = await operationSkillPolicy(input.cwd, input.harness);
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Follow-up cancelled because the turn was stopped");
    assertOriginal();
    const prepared = withSkillPolicy(
      "steer",
      {
        ...providerInput(input),
        nativeControlTurn: control,
        operationContext: originalContext,
      },
      policy,
    );
    input.onReady?.();
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Follow-up cancelled because the turn was stopped");
    assertOriginal();
    try {
      await adapter.steerTurn(prepared);
    } catch (error) {
      // These adapter guards run before any provider write. Do not classify
      // transport errors or unknown acknowledgements as safe to replay.
      if (
        error instanceof Error &&
        (error.message ===
          "The previous turn has finished. Send this follow-up as a new message." ||
          /^No active (Codex|Cursor|Hermes Agent) session$/.test(error.message))
      )
        throw new TurnNotReadyError(error.message);
      throw error;
    }
  });
}

/**
 * A running turn with no provider event for this long gets a visible notice.
 * The notice never ends the turn: a lost result line or a hung provider is the
 * user's call to Stop, and a long tool run is still a running turn.
 */
export const TURN_INACTIVITY_WARNING_MS = 10 * 60_000;
export const TURN_INACTIVITY_STATUS_KEY = "turn-inactivity";

/** Events after which the silence is the user's (or background work's), not the provider's. */
function turnWaitsOutsideProvider(event: HarnessEvent): boolean {
  return (
    event.type === "approval.requested" ||
    event.type === "question.asked" ||
    event.type === "question.updated" ||
    (event.type === "background.updated" && event.tasks.length > 0)
  );
}

/**
 * Per-turn inactivity watchdog: armed when the provider is entered, reset by
 * every provider event, disarmed while the turn waits on the user. On expiry
 * it posts one keyed status row and stays quiet until the provider speaks
 * again, which clears the row. It is the UI's existing status row, not a new
 * surface, and it leaves the turn running.
 */
function createTurnWatchdog(
  harness: HarnessId,
  emit: (event: HarnessEvent) => void,
  warnAfterMs = TURN_INACTIVITY_WARNING_MS,
): { arm(): void; observe(event: HarnessEvent): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  let generation = 0;
  const clear = () => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const notify = (text: string) => {
    try {
      emit({ type: "status", key: TURN_INACTIVITY_STATUS_KEY, text });
    } catch (error) {
      warnCleanup("turn inactivity notice", error);
    }
  };
  const arm = () => {
    clear();
    const currentGeneration = generation;
    timer = setTimeout(() => {
      timer = undefined;
      void import("../../../shared/model/harnessIdentity")
        .then(({ HARNESS_TITLE }) => {
          if (generation !== currentGeneration) return;
          warned = true;
          notify(
            t(
              "No response from {p0} in {p1}. It may still be working. Press Stop to end the turn.",
              {
                p0: HARNESS_TITLE[harness],
                p1: formatDuration(warnAfterMs),
              },
            ),
          );
        })
        .catch((error: unknown) => warnCleanup("turn inactivity notice", error));
    }, warnAfterMs);
  };
  return {
    arm,
    observe(event) {
      if (warned) {
        warned = false;
        notify("");
      }
      if (turnWaitsOutsideProvider(event)) clear();
      else arm();
    },
    stop() {
      clear();
      if (warned) {
        warned = false;
        notify("");
      }
    },
  };
}

/** How long Stop waits for the provider to confirm before it reports instead of hanging. */
const STOP_CONFIRM_MS = 10_000;
const stoppingTurns = new Map<string, number>();
const stoppingListeners = new Set<() => void>();
function setStopping(sessionId: string, delta: 1 | -1): void {
  const next = (stoppingTurns.get(sessionId) ?? 0) + delta;
  if (next > 0) stoppingTurns.set(sessionId, next);
  else stoppingTurns.delete(sessionId);
  for (const listener of Array.from(stoppingListeners)) listener();
}
/** True while a Stop for this session is waiting for the provider to confirm. */
export function isHarnessTurnStopping(sessionId: string): boolean {
  return stoppingTurns.has(sessionId);
}
/** Notified whenever a session enters or leaves the "Stopping…" state. */
export function subscribeHarnessStopping(listener: () => void): () => void {
  stoppingListeners.add(listener);
  return () => stoppingListeners.delete(listener);
}

/**
 * Cancels the running turn. Resolves once the provider confirmed. Rejects when the
 * cancel failed or was not confirmed within STOP_CONFIRM_MS, so the caller can say
 * so and offer Stop again; a failed cancel never schedules the idle park.
 */
export async function cancelHarnessTurn(harness: HarnessId, sessionId: string): Promise<void> {
  cancellationEpoch.set(sessionId, (cancellationEpoch.get(sessionId) ?? 0) + 1);
  const owner = adapterOperations.get(sessionId);
  if (!owner || owner.adapter.id !== harness) return;
  cancelIdlePark(sessionId);
  if (!owner.entered) return;
  const originalContext = operationContext(owner);
  if (owner.cancellation && owner.cancellationUnconfirmed) {
    // The provider never confirmed the earlier Stop. Waiting on that same hung
    // promise again could never escalate, so this Stop drops it and stops the
    // session the hard way, as Codex does when its interrupt is not answered.
    owner.cancellation = undefined;
    owner.cancellationUnconfirmed = false;
    warnCleanup(
      "turn cancellation",
      new Error(`${harness} did not confirm the previous Stop; stopping the session instead`),
    );
    setStopping(sessionId, 1);
    try {
      await stopHarnessSession(harness, sessionId);
    } finally {
      setStopping(sessionId, -1);
    }
    return;
  }
  // A failed cancellation is not cached, so Stop can retry. It is rethrown below.
  const cancellation: Promise<void> = (owner.cancellation ??= Promise.resolve()
    .then(() => owner.adapter.cancelTurn(sessionId, originalContext))
    .then(() => {
      // A late confirmation is still a confirmation: no escalation is needed.
      if (owner.cancellation === cancellation) owner.cancellationUnconfirmed = false;
    })
    .catch((error: unknown) => {
      warnCleanup("turn cancellation", error);
      if (owner.cancellation === cancellation) owner.cancellation = undefined;
      throw error;
    }));
  setStopping(sessionId, 1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cancellation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // The next Stop on this still-pending cancellation escalates.
          if (owner.cancellation === cancellation) owner.cancellationUnconfirmed = true;
          reject(
            new Error(
              `${harness} did not confirm Stop within ${STOP_CONFIRM_MS / 1000} s; it may still be running`,
            ),
          );
        }, STOP_CONFIRM_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    setStopping(sessionId, -1);
  }
  if (
    owner.cancellation === cancellation &&
    (!adapterOperations.has(sessionId) || adapterOperations.get(sessionId) === owner)
  ) {
    scheduleIdlePark(harness, sessionId);
  }
}

/** True when a row can be stopped on its own, not only with the whole turn. */
export function canStopHarnessBackgroundWork(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.stopBackgroundWork != null;
}

export async function stopHarnessBackgroundWork(
  harness: HarnessId,
  sessionId: string,
  callId?: string,
): Promise<void> {
  const owner = adapterOperations.get(sessionId);
  const adapter = owner?.adapter.id === harness ? owner.adapter : getHarness(harness);
  if (!adapter?.live || !adapter.stopBackgroundWork) {
    throw new Error(`${harness} cannot stop background work on its own`);
  }
  // Not a turn: the idle park timer is left alone, as for an approval answer.
  const context = owner?.adapter === adapter ? operationContext(owner) : undefined;
  if (context) await adapter.stopBackgroundWork(sessionId, callId, context);
  else await adapter.stopBackgroundWork(sessionId, callId);
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
  approvalOccurrenceId?: string,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision, approvalOccurrenceId);
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): boolean {
  const respond = getHarness(harness)?.respondQuestion;
  // No adapter, or an adapter that cannot take answers, did not deliver anything.
  if (!respond) return false;
  return respond(sessionId, requestId, reply) !== false;
}

export function keepHarnessQuestionOpen(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
): void {
  getHarness(harness)?.keepQuestionOpen?.(sessionId, requestId);
}

export async function stopHarnessSession(harness: HarnessId, sessionId: string): Promise<void> {
  cancelIdlePark(sessionId);
  const owner = adapterOperations.get(sessionId);
  const adapter = owner?.adapter.id === harness ? owner.adapter : getHarness(harness);
  if (!adapter?.live) return;
  // Only a running operation's context is valid; otherwise stop by session.
  const context =
    owner?.adapter === adapter && activeTurnSessions.has(sessionId)
      ? operationContext(owner)
      : undefined;
  try {
    if (context) await adapter.stopSession(sessionId, context);
    else await adapter.stopSession(sessionId);
    await retireProviderOwner(sessionId);
    if (retainedWriters.get(sessionId) === harness) retainedWriters.delete(sessionId);
  } catch (error) {
    warnCleanup("stop session", error);
    throw error;
  }
}

/** Writers held between turns, reported to the execution Host. */
export function retainedHarnessWriters(): string[] {
  return [...retainedWriters.keys()];
}

/** Explicit Host ownership transfer; ordinary local turns never call this.
 * Clear the writer only after both provider stop and native retirement succeed. */
export function retireHarnessWriter(sessionId: string): Promise<void> {
  return queueSessionOperation(sessionId, async () => {
    if (activeTurnSessions.has(sessionId) || adapterOperations.has(sessionId))
      throw new Error("The desktop session is still running. Retry after it finishes.");
    const harness = retainedWriters.get(sessionId);
    const claim = nativeSessionClaims.get(sessionId);
    if (!harness && !claim) return;
    cancelIdlePark(sessionId);
    try {
      // Mute intentional exit events first; the native receipt survives kill.
      if (harness) await requireHarness(harness).stopSession(sessionId);
    } catch (error) {
      warnCleanup("writer stop", error);
      throw error;
    }
    try {
      await retireProviderOwner(sessionId);
      await invoke("harness_retire", { sessionId });
      if (claim) {
        const capability = await claim;
        if (capability) {
          await releaseOwnedOpenCodeForCapability(capability);
          await settleNativeSessionClaim(capability);
        }
        if (nativeSessionClaims.get(sessionId) === claim) nativeSessionClaims.delete(sessionId);
      }
      retainedWriters.delete(sessionId);
    } catch (error) {
      warnCleanup("writer retire", error);
      throw error;
    }
  });
}

export async function forgetHarnessSession(harness: HarnessId, sessionId: string): Promise<void> {
  cancelIdlePark(sessionId);
  const owner = adapterOperations.get(sessionId);
  const adapter = owner?.adapter.id === harness ? owner.adapter : getHarness(harness);
  forgetRuntimeHint(sessionId);
  if (!adapter) return;
  const context =
    owner?.adapter === adapter && activeTurnSessions.has(sessionId)
      ? operationContext(owner)
      : undefined;
  const endPhase = beginHandoffPhase(harness, "stopping");
  try {
    await retireProviderOwnerAndCommands(sessionId, () =>
      adapter.forgetSession(sessionId, context),
    );
    if (retainedWriters.get(sessionId) === harness) retainedWriters.delete(sessionId);
    retireProviderEpoch(
      cancellationEpoch,
      sessionOperationTails,
      sessionId,
      sessionSteerTails,
      turnReady,
    );
  } catch (error) {
    warnCleanup("forget session", error);
    throw error;
  } finally {
    endPhase();
  }
}

export function bindHarnessSession(
  harness: HarnessId,
  threadId: string,
  providerSessionId: string,
  cwd: string,
  providerAccountId?: string,
  /** Restored transcript, so the adapter can reseed its task state. */
  blocks?: Block[],
): void {
  const adapter = getHarness(harness);
  adapter?.bindSession(threadId, providerSessionId, cwd, providerAccountId);
  if (!blocks || !adapter?.restoreTaskLists) return;
  const lists = blocks.flatMap((block) =>
    block.role === "tasks" && block.taskList ? [block.taskList] : [],
  );
  if (lists.length > 0) adapter.restoreTaskLists(threadId, lists);
}

/**
 * Probe model lists only for the harnesses the caller actually needs.
 * Boot used to refresh every adapter; that spawned unused CLIs (Pi with
 * extensions can sit at ~1GB) even when the workspace never touched them.
 */
/** `force` re-reads a catalog that already loaded, e.g. after a CLI update. */
export async function refreshHarnessCatalogs(
  ids: Iterable<HarnessId>,
  options?: { force?: boolean },
): Promise<void> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return;
  await Promise.all(
    [...adapters.values()]
      .filter((adapter) => wanted.has(adapter.id))
      .map(async (adapter) => {
        if (!adapter.refreshCatalog) return;
        // `force` marks an explicit user action (opening the model dropdown);
        // routine refreshes keep skipping adapters with a live catalog.
        if (!options?.force && hasLiveCatalog(adapter.id)) return;
        await adapter.refreshCatalog().catch((error: unknown) => {
          console.debug(`[bycoda] ${adapter.id} catalog`, error);
        });
      }),
  );
}

export async function generateHarnessTitle(
  harness: HarnessId,
  input: TitleInput,
): Promise<GeneratedSessionTitle | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateTitle) return null;
  return adapter.generateTitle(providerInput(input));
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  signal?: AbortSignal,
  context?: HarnessOperationContext,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  signal?.throwIfAborted();
  return context
    ? adapter.generateCommitMessage(cwd, signal, context)
    : adapter.generateCommitMessage(cwd, signal);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
  context?: HarnessOperationContext,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return context ? adapter.generatePrContent(cwd, context) : adapter.generatePrContent(cwd);
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
  context?: HarnessOperationContext,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateBranchName) return null;
  return context
    ? adapter.generateBranchName(cwd, message, context)
    : adapter.generateBranchName(cwd, message);
}

export type TextWarmupOptions = Pick<
  TextPromptInput,
  "providerAccountId" | "model" | "modelSettings"
>;

export async function warmupHarnessText(
  harness: HarnessId,
  cwd: string,
  options?: TextWarmupOptions,
): Promise<void> {
  const adapter = getHarness(harness);
  if (!adapter?.warmupText) return;
  if (!options) return adapter.warmupText(cwd);
  const input = providerInput({ ...options });
  assertHarnessModel(harness, input);
  await adapter.warmupText(cwd, input);
}

export function canRunHarnessTextPrompt(harness: HarnessId): boolean {
  const adapter = getHarness(harness);
  return adapter?.live === true && adapter.runTextPrompt != null;
}

function stopTextPrompt(adapter: HarnessAdapter): Promise<void> {
  return adapter.stopTextPrompt
    ? adapter.stopTextPrompt().catch(() => undefined)
    : Promise.resolve();
}

const activeTextPromptOwners = new Map<HarnessAdapter, Set<symbol>>();

function beginTextPrompt(adapter: HarnessAdapter): symbol {
  const owner = Symbol("text-prompt");
  const owners = activeTextPromptOwners.get(adapter) ?? new Set<symbol>();
  owners.add(owner);
  activeTextPromptOwners.set(adapter, owners);
  return owner;
}

function finishTextPrompt(adapter: HarnessAdapter, owner: symbol, stopIfLast: boolean): void {
  const owners = activeTextPromptOwners.get(adapter);
  if (!owners?.delete(owner)) return;
  if (owners.size > 0) return;
  activeTextPromptOwners.delete(adapter);
  if (stopIfLast) void stopTextPrompt(adapter);
}

function cancelledTextPrompt(): Error {
  return new Error("By-the-way request cancelled");
}

export async function runHarnessTextPrompt(
  request: TextPromptInput & { harness: HarnessId },
): Promise<string> {
  const input = providerInput({ ...request });
  assertHarnessModel(input.harness, input);
  const adapter = requireHarness(input.harness);
  if (!adapter.live) {
    throw new Error(`${input.harness} is not connected yet`);
  }
  if (!adapter.runTextPrompt) {
    throw new Error(`${input.harness} does not support isolated text prompts`);
  }

  const signal = input.signal;
  if (signal?.aborted) {
    throw cancelledTextPrompt();
  }

  const owner = beginTextPrompt(adapter);
  let run: Promise<string>;
  try {
    run = adapter.runTextPrompt(input);
  } catch (error) {
    finishTextPrompt(adapter, owner, false);
    throw error;
  }
  if (!signal) {
    try {
      return await run;
    } finally {
      finishTextPrompt(adapter, owner, false);
    }
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      finishTextPrompt(adapter, owner, false);
      reject(cancelledTextPrompt());
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  try {
    return await Promise.race([run, abortPromise]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    finishTextPrompt(adapter, owner, false);
  }
}

export async function stopHarnessTextPrompts(): Promise<void> {
  await Promise.all([...adapters.values()].map(stopTextPrompt));
}
