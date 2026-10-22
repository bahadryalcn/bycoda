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
import type { GeneratedSessionTitle } from "../../../features/sessions/model/sessionTitle";
import type { PrContent } from "../../../features/source-control/model/gitText";
import { hasLiveCatalog } from "../../../features/sessions/model/models";
import type { UserQuestionReply } from "../../../features/sessions/model/userQuestion";
import type { NativeCommandProvider } from "./nativeCommands";
import { loadSkillRestrictions } from "../../../features/skills/model/skillPreferences";
import { withSkillPolicy } from "./skillPolicy";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  RewindLastTurnInput,
  RewindLastTurnResult,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
};

/** One-shot, isolated text generation shared by titles and side questions. */
export type TextPromptInput = {
  cwd: string;
  providerAccountId?: string;
  model?: string;
  modelSettings?: Record<string, string>;
  /** Codex defaults to unsaved threads; false allows resumable side questions. */
  ephemeral?: boolean;
  threadId?: string;
  onThreadId?: (threadId: string) => void;
  intent?: TurnIntent;
  prompt: string;
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
  commands?: NativeCommandProvider;
  sendTurn(input: SendTurnInput): Promise<void>;
  /** Trigger provider-owned compaction outside Bycoda's normal user-turn path. */
  compactContext?(input: CompactContextInput): Promise<void>;
  /** Rewind provider state so the last user turn can be replaced. */
  rewindLastTurn?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  /**
   * Stop one running subagent or background command (`callId` is its tool
   * call), or every one of them when omitted, without interrupting the turn.
   * Only a harness whose protocol can stop a task by id offers it.
   */
  stopBackgroundWork?(sessionId: string, callId?: string): Promise<void>;
  respondApproval(sessionId: string, requestId: number, decision: ApprovalDecision): void;
  respondQuestion?(sessionId: string, requestId: number, reply: UserQuestionReply): void;
  /** Keep a timed question open once the user starts answering it. */
  keepQuestionOpen?(sessionId: string, requestId: number): void;
  /** Kill the child but keep resume state for later rebind. */
  stopSession(sessionId: string): Promise<void>;
  /** Drop resume state and kill the child (delete, harness switch, idle detach). */
  forgetSession(sessionId: string): Promise<void>;
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
  generateCommitMessage?(cwd: string, signal?: AbortSignal): Promise<string>;
  /** Optional LLM pull request title/body from branch diff context. */
  generatePrContent?(cwd: string): Promise<(PrContent & { base: string; head: string }) | null>;
  /** Optional LLM branch name from a user message. */
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
  /** Optional warmup for text-generation backends. */
  warmupText?(cwd: string): Promise<void>;
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
const sessionOperationTails = new Map<string, Promise<void>>();
const sessionSteerTails = new Map<string, Promise<void>>();
const activeTurnSessions = new Set<string>();
const turnReady = new Map<string, Promise<void>>();
const cancellationEpoch = new Map<string, number>();
type AdapterOperation = {
  adapter: HarnessAdapter;
  cancellation?: Promise<void>;
};
// Only an invocation that entered the adapter owns its startup cancellation.
// Cancelling registry preparation must not create a provider startup tombstone.
const adapterOperations = new Map<string, AdapterOperation>();

function beginAdapterOperation(sessionId: string, adapter: HarnessAdapter): AdapterOperation {
  const owner = { adapter };
  adapterOperations.set(sessionId, owner);
  return owner;
}

async function finishAdapterOperation(sessionId: string, owner: AdapterOperation): Promise<void> {
  // Do not let the next turn reuse a transport while Stop is still retiring it.
  await owner.cancellation?.catch(() => undefined);
  if (adapterOperations.get(sessionId) === owner) {
    adapterOperations.delete(sessionId);
  }
}

function queueSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
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
      void stopHarnessSession(harness, sessionId);
    }, HARNESS_IDLE_PARK_MS),
  );
}

async function releaseIdleHarness(harness: HarnessId, sessionId: string): Promise<void> {
  // An idle Codex app-server still owns the thread's writer lock. Release it
  // before exposing an idle desktop session that another device can resume.
  // stopSession preserves the provider conversation identity and its history.
  if (harness === "codex") await stopHarnessSession(harness, sessionId);
  else scheduleIdlePark(harness, sessionId);
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

export function sendHarnessTurn(input: SendTurnInput & { harness: HarnessId }) {
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  turnReady.set(input.sessionId, started);
  return queueSessionOperation(input.sessionId, async () => {
    try {
      if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
        throw new Error("Turn cancelled before it started");
      const adapter = requireHarness(input.harness);
      if (!adapter.live) throw new Error(`${input.harness} is not connected yet`);
      cancelIdlePark(input.sessionId);
      const controlled = typeof isTauri === "function" && isTauri();
      if (controlled)
        await invoke("control_authorize_turn", {
          sessionId: input.sessionId,
          cwd: input.cwd,
          appAccess: input.appAccess === true,
        });
      activeTurnSessions.add(input.sessionId);
      try {
        const thread = { harness: input.harness, providerAccountId: input.providerAccountId };
        const hint = pendingRuntimeHint(
          input.sessionId,
          thread,
          await harnessRuntimeHints(input.sessionId),
        );
        const text =
          input.harness === "codex" ? input.text : withRuntimeHint(input.harness, input.text, hint);
        const deliversHint = turnCarriesRuntimeHint(input.harness, input.text, text, hint);
        const accepted = () => {
          if (deliversHint) markRuntimeHintDelivered(input.sessionId, thread, hint);
          ready();
        };
        if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
          throw new Error("Turn cancelled before it started");
        const owner = beginAdapterOperation(input.sessionId, adapter);
        try {
          const restricted = withSkillPolicy(
            input.harness,
            input,
            await loadSkillRestrictions(input.cwd),
          );
          if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
            throw new Error("Turn cancelled before it started");
          await adapter.sendTurn({
            ...restricted,
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
            onAccepted: () => {
              accepted();
              input.onAccepted?.();
            },
            onEvent: (event) => {
              if (event.type === "turn.started") accepted();
              input.onEvent(event);
            },
          });
        } finally {
          await finishAdapterOperation(input.sessionId, owner);
        }
      } finally {
        activeTurnSessions.delete(input.sessionId);
        if (controlled) await invoke("control_turn_finished", { sessionId: input.sessionId });
        await releaseIdleHarness(input.harness, input.sessionId);
      }
    } finally {
      ready();
      if (turnReady.get(input.sessionId) === started) turnReady.delete(input.sessionId);
    }
  });
}

export function canCompactHarnessContext(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.compactContext != null;
}

export function compactHarnessContext(
  input: CompactContextInput & { harness: HarnessId },
): Promise<void> {
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  return queueSessionOperation(input.sessionId, async () => {
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
    const owner = beginAdapterOperation(input.sessionId, adapter);
    try {
      await adapter.compactContext({
        ...input,
        skillPolicy: await loadSkillRestrictions(input.cwd),
      });
      forgetRuntimeHint(input.sessionId);
    } finally {
      await finishAdapterOperation(input.sessionId, owner);
      await releaseIdleHarness(input.harness, input.sessionId);
    }
  });
}

export function canSteerHarness(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  if (!adapter?.live) return false;
  return adapter.canSteer !== false;
}

export function canRewindHarnessLastTurn(id: HarnessId): boolean {
  const adapter = adapters.get(id);
  return adapter?.live === true && adapter.rewindLastTurn != null;
}

export function rewindHarnessLastTurn(
  input: RewindLastTurnInput & { harness: HarnessId },
): Promise<RewindLastTurnResult> {
  return queueSessionOperation(input.sessionId, async () => {
    const adapter = requireHarness(input.harness);
    if (!adapter.rewindLastTurn) {
      throw new Error(`${input.harness} does not support editing the last message`);
    }
    cancelIdlePark(input.sessionId);
    const owner = beginAdapterOperation(input.sessionId, adapter);
    try {
      const policy = await loadSkillRestrictions(input.cwd);
      const result = await adapter.rewindLastTurn(
        input.text === undefined
          ? { ...input, skillPolicy: policy }
          : withSkillPolicy(input.harness, { ...input, text: input.text }, policy),
      );
      // The removed turn may have carried the hint; resend it next turn.
      forgetRuntimeHint(input.sessionId);
      return result;
    } finally {
      await finishAdapterOperation(input.sessionId, owner);
      await releaseIdleHarness(input.harness, input.sessionId);
    }
  });
}

export function steerHarnessTurn(input: SteerTurnInput & { harness: HarnessId }): Promise<void> {
  const epoch = cancellationEpoch.get(input.sessionId) ?? 0;
  return queueSteerOperation(input.sessionId, async () => {
    if ((cancellationEpoch.get(input.sessionId) ?? 0) !== epoch)
      throw new Error("Follow-up cancelled because the turn was stopped");
    const adapter = requireHarness(input.harness);
    if (!adapter.live) {
      throw new Error(`${input.harness} is not connected yet`);
    }
    cancelIdlePark(input.sessionId);
    const prepared = withSkillPolicy("steer", input, await loadSkillRestrictions(input.cwd));
    input.onReady?.();
    await adapter.steerTurn(prepared);
  });
}

export async function cancelHarnessTurn(harness: HarnessId, sessionId: string): Promise<void> {
  cancellationEpoch.set(sessionId, (cancellationEpoch.get(sessionId) ?? 0) + 1);
  const owner = adapterOperations.get(sessionId);
  if (!owner || owner.adapter.id !== harness) return;
  cancelIdlePark(sessionId);
  const cancellation = (owner.cancellation ??= Promise.resolve().then(() =>
    owner.adapter.cancelTurn(sessionId),
  ));
  try {
    await cancellation;
  } catch (error) {
    // Share an in-flight attempt, but allow Stop to retry a delivery failure.
    if (owner.cancellation === cancellation) owner.cancellation = undefined;
    throw error;
  }
  if (!adapterOperations.has(sessionId) || adapterOperations.get(sessionId) === owner) {
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
  const adapter = getHarness(harness);
  if (!adapter?.live || !adapter.stopBackgroundWork) {
    throw new Error(`${harness} cannot stop background work on its own`);
  }
  // Not a turn: the idle park timer is left alone, as for an approval answer.
  await adapter.stopBackgroundWork(sessionId, callId);
}

export function respondHarnessApproval(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  getHarness(harness)?.respondApproval(sessionId, requestId, decision);
}

export function respondHarnessQuestion(
  harness: HarnessId,
  sessionId: string,
  requestId: number,
  reply: UserQuestionReply,
): void {
  getHarness(harness)?.respondQuestion?.(sessionId, requestId, reply);
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
  const adapter = getHarness(harness);
  if (!adapter?.live) return;
  await adapter.stopSession(sessionId);
}

export async function forgetHarnessSession(harness: HarnessId, sessionId: string): Promise<void> {
  cancelIdlePark(sessionId);
  const adapter = getHarness(harness);
  forgetRuntimeHint(sessionId);
  if (!adapter) return;
  await adapter.forgetSession(sessionId);
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
  return adapter.generateTitle(input);
}

export async function generateHarnessCommitMessage(
  harness: HarnessId,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const adapter = requireHarness(harness);
  if (!adapter.generateCommitMessage) {
    throw new Error(`${harness} does not support commit message generation`);
  }
  signal?.throwIfAborted();
  return adapter.generateCommitMessage(cwd, signal);
}

export async function generateHarnessPrContent(
  harness: HarnessId,
  cwd: string,
): Promise<(PrContent & { base: string; head: string }) | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generatePrContent) return null;
  return adapter.generatePrContent(cwd);
}

export async function generateHarnessBranchName(
  harness: HarnessId,
  cwd: string,
  message: string,
): Promise<string | null> {
  const adapter = getHarness(harness);
  if (!adapter?.generateBranchName) return null;
  return adapter.generateBranchName(cwd, message);
}

export async function warmupHarnessText(harness: HarnessId, cwd: string): Promise<void> {
  await getHarness(harness)?.warmupText?.(cwd);
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
  input: TextPromptInput & { harness: HarnessId },
): Promise<string> {
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
