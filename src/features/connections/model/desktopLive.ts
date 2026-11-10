import type { Block, Session, ApprovalRequestToken, UserQuestionReply } from "../../sessions";
import { isApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";
import type { DesktopProjectDirectory } from "./protocol";
import type { NativeControlTurnReceipt } from "../../../integrations/harness/core/controlTurn";
import {
  REMOTE_INBOX_VERSION,
  safeInboxError,
  type DesktopInboxJob,
  type DesktopInboxPayload,
} from "../../inbox/public/remoteInbox";
import { executeDesktopInboxOperation, type DesktopInboxRunner } from "./desktopInboxOperation";
import {
  noteCommandActivity,
  noteInboxJobActivity,
  noteTakenOver,
  applyActivityFeed,
  type DesktopActivityFeed,
} from "./desktopLiveActivity";

export { executeDesktopInboxOperation, type DesktopInboxRunner };

export const DESKTOP_LIVE_CAPABILITY = "sessions.desktopLive";
export const DESKTOP_LIVE_MS = 1_500;
/** While nothing is busy or waiting and nothing is left to acknowledge, an
 * empty heartbeat is repeated this rarely. It must stay well under the host's
 * 20 s stale threshold (DESKTOP_BEAT_STALE_MS), and a remote Stop/Approve/Answer
 * only exists for a busy or waiting session, so it never waits on this. */
export const DESKTOP_LIVE_IDLE_MS = 5_000;

export function supportsDesktopLive(capabilities: string[] | undefined): boolean {
  return !!capabilities?.includes(DESKTOP_LIVE_CAPABILITY);
}

export type DesktopLiveSession = {
  id: string;
  busy: boolean;
  pending?: Block[];
  patch?: Partial<Session>;
  turnReceipt?: NativeControlTurnReceipt;
};

export type DesktopLivePayload = {
  writers?: { version: 1; sessionIds: string[] };
  projectDirectory?: DesktopProjectDirectory;
  /** Omit directory contents only after the host acknowledges this revision. */
  projectDirectoryRevision?: string;
  deletions?: { version: 1; replies: { id: string; error?: string }[] };
  clientId?: string;
  pageToken?: string;
  sessions: DesktopLiveSession[];
  acked?: string[];
  inbox?: DesktopInboxPayload;
  /** The last shared-queue change cursor this desktop saw (`queues.seq`). */
  queueSeq?: number;
  /** The last adopted-session change cursor this desktop saw (`adopted.seq`). */
  adoptedSeq?: number;
  /** The last remote-activity cursor this desktop saw (`activity.seq`). */
  activitySeq?: number;
  /** The shared queues this desktop holds the drain lease of; the beat keeps them alive. `blocked`: it cannot send them now (a sync conflict). */
  queueLeases?: { sessionId: string; epoch: number; blocked?: boolean }[];
  /** The conversations this window runs a turn of under a run lease; the beat keeps them alive. */
  runLeases?: { sessionId: string; epoch: number }[];
  /** Someone is using this window now; the Host holds phone pushes meanwhile. */
  userActive?: true;
  /** Age of the owner's last accepted voice speech; the Host counts it as presence for 2 minutes. */
  voiceActiveAgeMs?: number;
};

export type DesktopLiveResult = {
  projectDirectoryRevision?: string;
  deletions?: {
    jobs: { id: string; sessionId: string; cwd: string; requestedBy?: string }[];
    acked: string[];
  };
  commands?: DesktopLiveCommand[];
  inbox?: { jobs?: DesktopInboxJob[]; acked?: string[] };
  notesRevision?: number;
  /** Shared queues changed since `queueSeq`; `reset` when that cannot be told. */
  queues?: { seq: number; ids: string[]; reset?: boolean };
  /** Adopted sessions whose host copy moved since `adoptedSeq`; `reset` when that cannot be told. */
  adopted?: { seq: number; ids: string[]; reset?: boolean };
  /** What other devices did through the Host since `activitySeq`; untrusted. */
  activity?: DesktopActivityFeed;
  /** Event kinds this Host pushes to phones itself; absent from older Hosts. */
  hostPush?: string[];
  /** Per queue in `queueLeases`: the extended lease, or `null` when it was lost. */
  queueLeases?: Record<string, { holder: string; epoch: number; expiresAt: number } | null>;
  /** Per conversation in `runLeases`: the lease kept, or `null` when another side runs it now. */
  runLeases?: Record<string, { holder: string; epoch: number; expiresAt: number } | null>;
};
export type DesktopLiveCommand = {
  id: string;
  sessionId: string;
  type: "cancel" | "approve" | "answer" | "retire-writer";
  requestId?: number;
  approvalOccurrenceId?: string;
  decision?: "allow" | "deny";
  reply?: UserQuestionReply;
  pageToken?: string;
  turnReceipt?: NativeControlTurnReceipt;
  /** Name of the device that asked, when the Host knows it. */
  requestedBy?: string;
};
export type DesktopControlGuard = (() => boolean) & { stopOrchestration?: () => Promise<void> };

export type DesktopLiveHandlers = {
  retireWriter?: (sessionId: string) => Promise<void>;
  /** `requestedBy`: the name of the device that asked, when the Host knows it. */
  delete?: (sessionId: string, cwd: string, requestedBy?: string) => Promise<void>;
  stop: (sessionId: string, current?: DesktopControlGuard) => void;
  captureApproval?: (
    session: Session,
    requestId: number,
    block: Block,
  ) => ApprovalRequestToken | undefined;
  approvalDispatchStarted?: (expected: ApprovalRequestToken | undefined) => boolean;
  approve: (
    sessionId: string,
    requestId: number,
    decision: "allow" | "deny",
    expected?: ApprovalRequestToken,
  ) => void | boolean | Promise<boolean>;
  answer: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
    current?: () => boolean,
  ) => void;
};

/** Drops functions/undefined so the value survives the JSON bridge. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Per Session object (immutable between updates); re-scanned when `blocks` changes.
const undecidedBySession = new WeakMap<Session, { blocks: Session["blocks"]; found: Block[] }>();
function undecidedApprovals(session: Session): Block[] {
  const blocks = session.blocks;
  const cached = undecidedBySession.get(session);
  if (cached && cached.blocks === blocks) return cached.found;
  const found = blocks.filter((block) => block.approval && !block.approval.decided);
  undecidedBySession.set(session, { blocks, found });
  return found;
}

type DesktopApprovalSource = {
  sessionId: string;
  requestId: number;
  occurrenceId?: string;
  block: object;
  approval: object;
  token?: ApprovalRequestToken;
};

type DesktopCommandOutcome = "applied" | "stale" | "held";
type RetainedDesktopApproval = {
  source: DesktopApprovalSource;
  decision: "allow" | "deny";
  wireOccurrenceId?: string;
};
type DesktopApprovalCommands = {
  records: Map<string, RetainedDesktopApproval>;
  capacityHeld: boolean;
};
const DESKTOP_APPROVAL_COMMAND_LIMIT = 64;
const approvalCommandsKey = Symbol.for("bycoda.desktop-live.approval-commands.v1");
const approvalIdentitiesKey = Symbol.for("bycoda.desktop-live.approval-object-identities.v1");
const approvalCommandGlobals = globalThis as typeof globalThis & {
  [approvalCommandsKey]?: WeakMap<Set<string>, DesktopApprovalCommands>;
  [approvalIdentitiesKey]?: WeakMap<object, object>;
};
const approvalCommands = (approvalCommandGlobals[approvalCommandsKey] ??= new WeakMap());
const approvalIdentities = (approvalCommandGlobals[approvalIdentitiesKey] ??= new WeakMap());
function approvalObjectIdentity(value: object): object {
  let identity = approvalIdentities.get(value);
  if (!identity) {
    identity = {};
    approvalIdentities.set(value, identity);
  }
  return identity;
}
function retainedApprovalCommands(handled: Set<string>): DesktopApprovalCommands {
  let state = approvalCommands.get(handled);
  if (!state) {
    state = { records: new Map(), capacityHeld: false };
    approvalCommands.set(handled, state);
  }
  return state;
}

function captureDesktopApprovals(
  sessions: readonly Session[],
  handlers: DesktopLiveHandlers,
): DesktopApprovalSource[] {
  const sources: DesktopApprovalSource[] = [];
  for (const session of sessions) {
    if (session.worktreeRemoved) continue;
    for (const block of undecidedApprovals(session)) {
      const approval = block.approval!;
      const requestId = approval.requestId;
      const token = handlers.captureApproval?.(session, requestId, block);
      sources.push({
        sessionId: session.id,
        requestId,
        occurrenceId: approval.occurrenceId,
        block: approvalObjectIdentity(block),
        approval: approvalObjectIdentity(approval),
        token,
      });
    }
  }
  return sources;
}

/** The heartbeat entry per session object (null: nothing to report). A session
 * keeps its identity while unchanged, so only changed ones are scanned again. */
const entryBySession = new WeakMap<Session, DesktopLiveSession | null>();
let lastSessions: readonly Session[] | undefined;
let lastEntries: DesktopLiveSession[] = [];

function desktopLiveEntry(session: Session): DesktopLiveSession | null {
  if (session.worktreeRemoved) return null;
  const approvals = undecidedApprovals(session);
  const question = session.pendingQuestion;
  const busy = !!session.busy;
  if (!busy && approvals.length === 0 && !question) return null;
  const entry: DesktopLiveSession = { id: session.id, busy };
  if (approvals.length > 0) entry.pending = jsonSafe(approvals);
  if (question) entry.patch = jsonSafe({ pendingQuestion: question });
  return entry;
}

/** Every busy session, or one waiting on an approval/question. The pending
 * approval blocks and the live question prompt are what persistence drops. */
export function buildDesktopLiveSessions(sessions: readonly Session[]): DesktopLiveSession[] {
  if (sessions === lastSessions) return lastEntries;
  const out: DesktopLiveSession[] = [];
  for (const session of sessions) {
    let entry = entryBySession.get(session);
    if (entry === undefined) {
      entry = desktopLiveEntry(session);
      entryBySession.set(session, entry);
    }
    if (entry) out.push(entry);
  }
  lastSessions = sessions;
  lastEntries = out;
  return out;
}

/** Runs a watcher's command through the local UI handlers. Stale commands
 * (nothing busy/pending anymore, or another request id) are dropped. */
export function applyDesktopLiveCommand(
  command: DesktopLiveCommand,
  sessions: readonly Session[],
  handlers: DesktopLiveHandlers,
  originalApprovals?: readonly DesktopApprovalSource[],
): boolean {
  return dispatchDesktopLiveCommand(command, sessions, handlers, originalApprovals) === "applied";
}

function dispatchDesktopLiveCommand(
  command: DesktopLiveCommand,
  sessions: readonly Session[],
  handlers: DesktopLiveHandlers,
  originalApprovals?: readonly DesktopApprovalSource[],
  approvalOccurrenceSupported = true,
  current?: DesktopControlGuard,
): DesktopCommandOutcome {
  const session = sessions.find((candidate) => candidate.id === command.sessionId);
  if (!session || session.worktreeRemoved) return "stale";
  const id = command.requestId;
  if (command.type === "cancel") {
    if (!session.busy) return "stale";
    if (current) handlers.stop(session.id, current);
    else handlers.stop(session.id);
    noteCommandActivity(command, session.cwd);
    return "applied";
  }
  if (id === undefined || id === null || !Number.isFinite(Number(id))) return "stale";
  const requestId = Number(id);
  if (command.type === "approve") {
    if (command.decision !== "allow" && command.decision !== "deny") return "stale";
    const pending = undecidedApprovals(session).find(
      (block) => String(block.approval?.requestId) === String(requestId),
    );
    if (!pending) return "stale";
    if (!approvalOccurrenceSupported || !isApprovalOccurrenceId(command.approvalOccurrenceId))
      return "held";
    // A direct caller captures at its synchronous accepted boundary. A heartbeat
    // supplies its original cut, including an empty cut; never recapture a token
    // after the request await for an approval that arrived or changed meanwhile.
    const sources = originalApprovals ?? captureDesktopApprovals(sessions, handlers);
    const source = sources.find(
      (candidate) => candidate.sessionId === session.id && candidate.requestId === requestId,
    );
    if (!source) return "stale";
    if (!isApprovalOccurrenceId(source.occurrenceId)) return "held";
    if (
      source.occurrenceId !== command.approvalOccurrenceId ||
      pending.approval?.occurrenceId !== source.occurrenceId
    )
      return "stale";
    if (
      source.block !== approvalObjectIdentity(pending) ||
      source.approval !== approvalObjectIdentity(pending.approval!)
    )
      return "stale";
    if (!source.token || !handlers.approvalDispatchStarted) return "held";
    // The probe is a private callback-attempt observation, not a provider ACK.
    // A true probe before entry also prevents replay after a synchronous throw.
    if (handlers.approvalDispatchStarted(source.token)) return "applied";
    try {
      handlers.approve(session.id, requestId, command.decision, source.token);
    } catch (error) {
      if (!handlers.approvalDispatchStarted(source.token)) throw error;
      noteCommandActivity(command, session.cwd);
      return "applied";
    }
    if (!handlers.approvalDispatchStarted(source.token)) return "held";
    noteCommandActivity(command, session.cwd);
    return "applied";
  }
  if (command.type === "answer") {
    if (!command.reply) return "stale";
    if (String(session.pendingQuestion?.requestId) !== String(requestId)) return "stale";
    if (current) handlers.answer(session.id, requestId, command.reply, current);
    else handlers.answer(session.id, requestId, command.reply);
    noteCommandActivity(command, session.cwd);
    return "applied";
  }
  return "stale";
}

/** When the last heartbeat was sent and whether it reported nothing. */
export type DesktopLiveBeat = {
  idleAt?: number;
  notesRevision?: number;
  queueSeq?: number;
  adoptedSeq?: number;
  activitySeq?: number;
  directoryFingerprint?: string;
  directorySequence?: number;
  directoryAck?: string;
  directoryResend?: boolean;
  /** The last directory serialized, so an unchanged object is not stringified again. */
  serialized?: {
    directory: DesktopProjectDirectory;
    json: string;
    revision?: string;
  };
};

/** One exchange with the host: report live sessions plus what was handled
 * since last time, then execute the commands it returns. `unacked` keeps ids
 * until a call succeeds; `handled` dedupes re-sent commands. With a `beat`,
 * an empty heartbeat is not repeated before DESKTOP_LIVE_IDLE_MS. */
export async function runDesktopLiveTick(deps: {
  /** Actual Host descriptor observation; absent legacy capability is unjoined. */
  approvalOccurrenceSupported?: boolean;
  beat?: DesktopLiveBeat;
  now?: () => number;
  clientId?: string;
  userActive?: () => boolean;
  /** Age of fresh accepted speech to report (throttled by the source), else undefined. */
  voiceActiveAge?: () => number | undefined;
  /** Receives the event kinds the Host pushes to phones itself; empty when none, unreachable or failed. */
  hostPush?: (kinds: readonly string[]) => void;
  controlGuard?: {
    pageToken: () => Promise<string>;
    verify: (token: string) => Promise<void>;
    capture: (session: Session) =>
      | {
          receipt: NativeControlTurnReceipt;
          current: () => boolean;
          question: unknown;
          ready?: Promise<void>;
          stopOrchestration?: () => Promise<void>;
        }
      | undefined;
  };
  request: (payload: DesktopLivePayload) => Promise<DesktopLiveResult | undefined>;
  sessions: () => readonly Session[];
  writers?: () => string[];
  projectDirectory?: () => DesktopProjectDirectory;
  handlers: DesktopLiveHandlers;
  unacked: Set<string>;
  handled: Set<string>;
  /** Shared queues another computer changed: `undefined` means any of them. */
  onQueuesChanged?: (ids: string[] | undefined) => void;
  /** Every answer of a host that reports adopted-session changes: the ids that
   * moved (empty when none), or `reset` when the cursor is new or was lost. */
  onAdopted?: (change: { ids: string[]; reset: boolean }) => void;
  /** The drain leases this desktop holds, and what the host answered for them. */
  queueLeases?: {
    held: () => { sessionId: string; epoch: number; blocked?: boolean }[];
    answered: (answers: NonNullable<DesktopLiveResult["queueLeases"]>) => void;
  };
  /** The run leases of the turns this window runs; `answered` returns the conversations whose lease was lost. */
  runLeases?: {
    held: () => { sessionId: string; epoch: number }[];
    answered: (answers: NonNullable<DesktopLiveResult["runLeases"]>) => string[];
  };
  inbox?: DesktopInboxRunner;
  deletions?: {
    results: Map<string, { id: string; error?: string }>;
    running: Set<string>;
  };
}): Promise<void> {
  const acked = [...deps.unacked];
  const now = deps.now ?? Date.now;
  const originalSessions = deps.sessions();
  const originalControls = new Map(
    originalSessions.map((session) => [session.id, deps.controlGuard?.capture(session)]),
  );
  const pageToken = deps.controlGuard ? await deps.controlGuard.pageToken() : undefined;
  for (const [id, original] of originalControls) {
    if (!original?.ready) continue;
    try {
      await original.ready;
    } catch {
      originalControls.set(id, undefined);
    }
  }
  const live = buildDesktopLiveSessions(originalSessions).map((entry) => {
    const original = originalControls.get(entry.id);
    return original ? { ...entry, turnReceipt: original.receipt } : entry;
  });
  const projectDirectory = deps.projectDirectory?.();
  let directoryFingerprint: string | undefined;
  let directoryRevision: string | undefined;
  if (projectDirectory) {
    // Directory builders return the same object while their inputs are unchanged;
    // logo previews make the JSON large, so only a new object is serialized.
    const serialized = deps.beat?.serialized;
    directoryFingerprint =
      serialized?.directory === projectDirectory
        ? serialized.json
        : JSON.stringify(projectDirectory);
    if (deps.beat) {
      directoryRevision =
        serialized?.json === directoryFingerprint ? serialized.revision : undefined;
      if (!directoryRevision) {
        deps.beat.directorySequence = (deps.beat.directorySequence ?? 0) + 1;
        directoryRevision = String(deps.beat.directorySequence);
      }
      deps.beat.serialized = {
        directory: projectDirectory,
        json: directoryFingerprint,
        revision: directoryRevision,
      };
    }
  }
  const directoryChanged =
    directoryFingerprint !== deps.beat?.directoryFingerprint || deps.beat?.directoryResend === true;
  const inboxReplies = [...(deps.inbox?.results.values() ?? [])].slice(0, 2);
  const heldLeases = deps.queueLeases?.held() ?? [];
  const heldRuns = deps.runLeases?.held() ?? [];
  const voiceActiveAgeMs = deps.voiceActiveAge?.();
  const idle =
    voiceActiveAgeMs === undefined &&
    live.length === 0 &&
    acked.length === 0 &&
    inboxReplies.length === 0 &&
    !deps.deletions?.results.size &&
    !deps.deletions?.running.size &&
    !deps.inbox?.running.size;
  // Anything busy, waiting or unacknowledged goes out on every tick, so a
  // session that starts running is reported within one DESKTOP_LIVE_MS.
  if (
    idle &&
    !directoryChanged &&
    deps.beat?.idleAt !== undefined &&
    now() - deps.beat.idleAt < DESKTOP_LIVE_IDLE_MS
  )
    return;
  const payload: DesktopLivePayload = {
    ...(deps.writers && deps.handlers.retireWriter
      ? { writers: { version: 1 as const, sessionIds: deps.writers() } }
      : {}),
    ...(projectDirectory && (!directoryRevision || deps.beat?.directoryAck !== directoryRevision)
      ? { projectDirectory }
      : {}),
    ...(directoryRevision ? { projectDirectoryRevision: directoryRevision } : {}),
    ...(deps.deletions && deps.handlers.delete
      ? {
          deletions: {
            version: 1 as const,
            replies: [...deps.deletions.results.values()],
          },
        }
      : {}),
    ...(deps.clientId ? { clientId: deps.clientId } : {}),
    ...(deps.userActive?.() ? { userActive: true as const } : {}),
    ...(voiceActiveAgeMs !== undefined ? { voiceActiveAgeMs } : {}),
    ...(pageToken ? { pageToken } : {}),
    sessions: live,
    ...(acked.length > 0 ? { acked } : {}),
    ...(deps.beat?.queueSeq !== undefined ? { queueSeq: deps.beat.queueSeq } : {}),
    ...(deps.beat?.adoptedSeq !== undefined ? { adoptedSeq: deps.beat.adoptedSeq } : {}),
    ...(deps.beat?.activitySeq !== undefined ? { activitySeq: deps.beat.activitySeq } : {}),
    ...(heldLeases.length ? { queueLeases: heldLeases } : {}),
    ...(heldRuns.length ? { runLeases: heldRuns } : {}),
    ...(deps.inbox
      ? {
          inbox: {
            version: REMOTE_INBOX_VERSION,
            ...(inboxReplies.length ? { replies: inboxReplies } : {}),
          },
        }
      : {}),
  };
  // These tokens belong to the actual local requests published by this exchange.
  // The legacy wire has no remote-view occurrence nonce: this closes the local
  // await/replacement race, not an ID-reuse ambiguity in an older remote view.
  const originalApprovals = captureDesktopApprovals(originalSessions, deps.handlers);
  let result: DesktopLiveResult | undefined;
  try {
    result = await deps.request(payload);
  } catch (error) {
    // The Host may no longer push these kinds: report them to the account again.
    deps.hostPush?.([]);
    throw error;
  }
  if (deps.beat) {
    deps.beat.directoryFingerprint = directoryFingerprint;
    deps.beat.directoryAck =
      directoryRevision && result?.projectDirectoryRevision === directoryRevision
        ? directoryRevision
        : undefined;
    // A restarted host cannot acknowledge an omitted projection. Retry the
    // full privacy snapshot next beat; old hosts keep the legacy full cadence.
    deps.beat.directoryResend =
      !!projectDirectory && !payload.projectDirectory && !deps.beat.directoryAck;
  }
  deps.hostPush?.(result?.hostPush ?? []);
  if (result?.queueLeases) deps.queueLeases?.answered(result.queueLeases);
  // A run lease the host took back: another computer runs this conversation now,
  // so this window stops its turn instead of writing next to it.
  if (result?.runLeases && deps.runLeases)
    for (const sessionId of deps.runLeases.answered(result.runLeases)) {
      const running = deps.sessions().find((session) => session.id === sessionId);
      deps.handlers.stop(sessionId);
      if (running?.busy) noteTakenOver(running.cwd);
    }
  if (deps.deletions && deps.handlers.delete) {
    const runner = deps.deletions;
    for (const id of result?.deletions?.acked ?? []) runner.results.delete(id);
    for (const job of result?.deletions?.jobs ?? []) {
      if (
        !job ||
        typeof job.id !== "string" ||
        typeof job.sessionId !== "string" ||
        typeof job.cwd !== "string"
      )
        continue;
      if (runner.running.has(job.id) || runner.results.has(job.id)) continue;
      runner.running.add(job.id);
      void Promise.resolve()
        .then(() =>
          deps.handlers.delete!(
            job.sessionId,
            job.cwd,
            typeof job.requestedBy === "string" ? job.requestedBy : undefined,
          ),
        )
        .then(() => runner.results.set(job.id, { id: job.id }))
        .catch((error) =>
          runner.results.set(job.id, {
            id: job.id,
            error: safeInboxError(error),
          }),
        )
        .finally(() => runner.running.delete(job.id));
    }
  }
  if (deps.inbox) {
    for (const id of result?.inbox?.acked ?? []) deps.inbox.results.delete(id);
    for (const job of result?.inbox?.jobs ?? []) {
      if (
        !job ||
        typeof job.id !== "string" ||
        deps.inbox.running.has(job.id) ||
        deps.inbox.results.has(job.id)
      )
        continue;
      const runner = deps.inbox;
      runner.running.add(job.id);
      // Provider HTTP may be slow. Continue heartbeats and Stop/Approve/Answer
      // while native inbox work runs; never repeat a claimed send.
      void Promise.resolve()
        .then(() => executeDesktopInboxOperation(job.operation, runner, job.deadline))
        .then((value) => {
          runner.results.set(job.id, { id: job.id, result: jsonSafe(value ?? null) });
          noteInboxJobActivity(job, true);
        })
        .catch((error) => {
          runner.results.set(job.id, { id: job.id, error: safeInboxError(error) });
          noteInboxJobActivity(job, false);
        })
        .finally(() => {
          runner.running.delete(job.id);
          while (runner.results.size > 64)
            runner.results.delete(runner.results.keys().next().value!);
        });
    }
    if (
      typeof result?.notesRevision === "number" &&
      Number.isSafeInteger(result.notesRevision) &&
      deps.beat
    ) {
      if (deps.beat.notesRevision !== result.notesRevision && result.notesRevision > 0)
        await deps.inbox.onNotesChanged?.();
      deps.beat.notesRevision = result.notesRevision;
    }
  }
  if (deps.beat) deps.beat.idleAt = idle ? now() : undefined;
  const queues = result?.queues;
  if (queues && Number.isSafeInteger(queues.seq) && Array.isArray(queues.ids)) {
    // The first answer only establishes the cursor: every queue is read on
    // first sight anyway. After that, the changed ones are re-read at once.
    // An answer with nothing new wakes nobody.
    const changed = queues.ids.filter((id) => typeof id === "string");
    if (deps.beat?.queueSeq !== undefined && (queues.reset || changed.length > 0))
      deps.onQueuesChanged?.(queues.reset ? undefined : changed);
    if (deps.beat) deps.beat.queueSeq = queues.seq;
  }
  const adopted = result?.adopted;
  if (adopted && Number.isSafeInteger(adopted.seq) && Array.isArray(adopted.ids)) {
    // The first answer is a reset: the desktop reads the list once to catch up.
    deps.onAdopted?.({
      ids: adopted.ids.filter((id) => typeof id === "string"),
      reset: adopted.reset === true || deps.beat?.adoptedSeq === undefined,
    });
    if (deps.beat) deps.beat.adoptedSeq = adopted.seq;
  }
  if (deps.beat) applyActivityFeed(result?.activity, deps.beat);
  for (const id of acked) deps.unacked.delete(id);
  const commands = Array.isArray(result?.commands) ? result.commands : [];
  for (const command of commands) {
    if (!command || typeof command.id !== "string") continue;
    // Older hosts return all windows' commands. Never acknowledge a session
    // this window doesn't have, or it will disappear before its owner sees it.
    if (
      command.type !== "retire-writer" &&
      !deps.sessions().some((session) => session.id === command.sessionId)
    )
      continue;
    if (deps.handled.has(command.id)) {
      deps.unacked.add(command.id);
      continue;
    }
    try {
      let current: DesktopControlGuard | undefined;
      if (command.type !== "retire-writer" && deps.controlGuard) {
        const original = originalControls.get(command.sessionId);
        if (
          !pageToken ||
          command.pageToken !== pageToken ||
          !original ||
          !command.turnReceipt ||
          command.turnReceipt.version !== 1 ||
          command.turnReceipt.sessionId !== original.receipt.sessionId ||
          command.turnReceipt.turnId !== original.receipt.turnId
        )
          continue;
        await deps.controlGuard.verify(pageToken);
        current = () =>
          original.current() &&
          (command.type !== "answer" ||
            deps.sessions().find((session) => session.id === command.sessionId)?.pendingQuestion ===
              original.question);
        if (original.stopOrchestration) current.stopOrchestration = original.stopOrchestration;
        if (!current()) continue;
      }
      if (command.type === "retire-writer") {
        if (!deps.handlers.retireWriter)
          throw new Error("Desktop writer retirement is unavailable. Reopen the updated app.");
        if (deps.sessions().some((session) => session.id === command.sessionId && session.busy))
          throw new Error("The desktop session is still running. Retry after it finishes.");
        await deps.handlers.retireWriter(command.sessionId);
      } else if (command.type === "approve") {
        const retained = retainedApprovalCommands(deps.handled);
        const requestId = command.requestId == null ? undefined : Number(command.requestId);
        let original = retained.records.get(command.id);
        if (
          original &&
          (original.source.sessionId !== command.sessionId ||
            original.source.requestId !== requestId ||
            original.decision !== command.decision ||
            original.wireOccurrenceId !==
              (isApprovalOccurrenceId(command.approvalOccurrenceId)
                ? command.approvalOccurrenceId
                : undefined))
        ) {
          // A command ID is immutable. A changed envelope cannot retarget its
          // original choice; consuming it is an explicit local stale witness.
          retained.records.delete(command.id);
        } else {
          if (!original) {
            const source = originalApprovals.find(
              (candidate) =>
                candidate.sessionId === command.sessionId && candidate.requestId === requestId,
            );
            if (source && (command.decision === "allow" || command.decision === "deny")) {
              if (
                retained.capacityHeld ||
                retained.records.size >= DESKTOP_APPROVAL_COMMAND_LIMIT
              ) {
                // The Host queue retains this original choice. Once an original
                // cannot be pinned, never recapture it from a later heartbeat.
                retained.capacityHeld = true;
                continue;
              }
              original = {
                source,
                decision: command.decision,
                wireOccurrenceId: isApprovalOccurrenceId(command.approvalOccurrenceId)
                  ? command.approvalOccurrenceId
                  : undefined,
              };
              retained.records.set(command.id, original);
            }
          }
          const outcome = dispatchDesktopLiveCommand(
            command,
            deps.sessions(),
            deps.handlers,
            original ? [original.source] : originalApprovals,
            deps.approvalOccurrenceSupported === true,
            current,
          );
          if (outcome === "held") continue;
          retained.records.delete(command.id);
        }
      } else
        dispatchDesktopLiveCommand(
          command,
          deps.sessions(),
          deps.handlers,
          undefined,
          true,
          current,
        );
    } catch (error) {
      console.error(error);
      continue; // Keep the command pending if its handler failed.
    }
    deps.handled.add(command.id);
    // Bound the dedupe set; insertion order makes the oldest go first.
    if (deps.handled.size > 500) {
      const oldest = deps.handled.values().next().value;
      if (oldest !== undefined) deps.handled.delete(oldest);
    }
    deps.unacked.add(command.id);
  }
}
