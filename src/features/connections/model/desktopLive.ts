import type { Block, Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { DesktopProjectDirectory } from "./protocol";
import { isRemoteJiraOperation, type RemoteJiraOperation } from "../../inbox/model/jiraBoardProtocol";
import {
  REMOTE_INBOX_VERSION,
  REMOTE_INBOX_PROVIDERS,
  nativeInboxCommand,
  safeInboxError,
  type DesktopInboxJob,
  type DesktopInboxPayload,
  type DesktopInboxReply,
  type RemoteInboxOperation,
  type RemoteInboxList,
  type RemoteInboxQuery,
} from "../../inbox/model/remoteInbox";

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
};

export type DesktopLivePayload = {
  projectDirectory?: DesktopProjectDirectory;
  /** Omit directory contents only after the host acknowledges this revision. */
  projectDirectoryRevision?: string;
  deletions?: { version: 1; replies: { id: string; error?: string }[] };
  clientId?: string;
  sessions: DesktopLiveSession[];
  acked?: string[];
  inbox?: DesktopInboxPayload;
  /** The last shared-queue change cursor this desktop saw (`queues.seq`). */
  queueSeq?: number;
  /** The last adopted-session change cursor this desktop saw (`adopted.seq`). */
  adoptedSeq?: number;
  /** The shared queues this desktop holds the drain lease of; the beat keeps them alive. `blocked`: it cannot send them now (a sync conflict). */
  queueLeases?: { sessionId: string; epoch: number; blocked?: boolean }[];
  /** The conversations this window runs a turn of under a run lease; the beat keeps them alive. */
  runLeases?: { sessionId: string; epoch: number }[];
};

export type DesktopLiveResult = {
  projectDirectoryRevision?: string;
  deletions?: {
    jobs: { id: string; sessionId: string; cwd: string }[];
    acked: string[];
  };
  commands?: DesktopLiveCommand[];
  inbox?: { jobs?: DesktopInboxJob[]; acked?: string[] };
  notesRevision?: number;
  /** Shared queues changed since `queueSeq`; `reset` when that cannot be told. */
  queues?: { seq: number; ids: string[]; reset?: boolean };
  /** Adopted sessions whose host copy moved since `adoptedSeq`; `reset` when that cannot be told. */
  adopted?: { seq: number; ids: string[]; reset?: boolean };
  /** Per queue in `queueLeases`: the extended lease, or `null` when it was lost. */
  queueLeases?: Record<string, { holder: string; epoch: number; expiresAt: number } | null>;
  /** Per conversation in `runLeases`: the lease kept, or `null` when another side runs it now. */
  runLeases?: Record<string, { holder: string; epoch: number; expiresAt: number } | null>;
};
export type DesktopInboxRunner = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  list: (projects: { path: string }[], query: RemoteInboxQuery) => Promise<RemoteInboxList>;
  results: Map<string, DesktopInboxReply>;
  running: Set<string>;
  onNotesChanged?: () => void | Promise<void>;
  jira?: (operation: RemoteJiraOperation, deadline?: number) => Promise<unknown>;
};

/** Executes only existing inbox contracts; auth/config/shell commands are absent. */
export async function executeDesktopInboxOperation(
  operation: RemoteInboxOperation,
  runner: Pick<DesktopInboxRunner, "invoke" | "list" | "jira">,
  deadline?: number,
): Promise<unknown> {
  if (isRemoteJiraOperation(operation)) {
    if (!runner.jira) throw new Error("Update the desktop for scoped Jira board access");
    return runner.jira(operation, deadline);
  }
  if (operation.action === "review") {
    if (!Number.isSafeInteger(deadline) || Number(deadline) <= Date.now() || Number(deadline) > Date.now() + 120_000)
      throw new Error("The desktop review approval deadline is missing or expired. Update the host and review again.");
    return runner.invoke("desktop_inbox_review", { operation, deadline });
  }
  if (operation.action === "providers") {
    const commands = {
      github: "git_github_status",
      gitlab: "gitlab_status",
      azuredevops: "azure_devops_status",
      linear: "linear_status",
      jira: "jira_status",
    };
    return Promise.all(
      REMOTE_INBOX_PROVIDERS.map(async (provider) => {
        try {
          const status = (await runner.invoke(commands[provider])) as { connected?: boolean };
          return { provider, connected: status?.connected === true };
        } catch (error) {
          return { provider, connected: false, error: safeInboxError(error) };
        }
      }),
    );
  }
  if (operation.action === "list") {
    const value = await runner.list(operation.projects, operation.query);
    return {
      ...value,
      errors: Object.fromEntries(
        Object.entries(value.errors).map(([provider, error]) => [provider, safeInboxError(error)]),
      ),
    };
  }
  if (
    !["details", "thread", "comment", "pr-action", "review-context", "review"].includes(
      operation.action,
    )
  )
    throw new Error("Unsupported desktop inbox operation.");
  const { command, args } = nativeInboxCommand(operation);
  return runner.invoke(command, args);
}

export type DesktopLiveCommand = {
  id: string;
  sessionId: string;
  type: "cancel" | "approve" | "answer";
  requestId?: number;
  decision?: "allow" | "deny";
  reply?: UserQuestionReply;
};

export type DesktopLiveHandlers = {
  delete?: (sessionId: string, cwd: string) => Promise<void>;
  stop: (sessionId: string) => void;
  approve: (sessionId: string, requestId: number, decision: "allow" | "deny") => void;
  answer: (sessionId: string, requestId: number, reply: UserQuestionReply) => void;
};

/** Drops functions/undefined so the value survives the JSON bridge. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function undecidedApprovals(session: Session): Block[] {
  return session.blocks.filter((block) => block.approval && !block.approval.decided);
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
): boolean {
  const session = sessions.find((candidate) => candidate.id === command.sessionId);
  if (!session || session.worktreeRemoved) return false;
  const id = command.requestId;
  if (command.type === "cancel") {
    if (!session.busy) return false;
    handlers.stop(session.id);
    return true;
  }
  if (id === undefined || id === null || !Number.isFinite(Number(id))) return false;
  const requestId = Number(id);
  if (command.type === "approve") {
    if (command.decision !== "allow" && command.decision !== "deny") return false;
    const pending = undecidedApprovals(session).some(
      (block) => String(block.approval?.requestId) === String(requestId),
    );
    if (!pending) return false;
    handlers.approve(session.id, requestId, command.decision);
    return true;
  }
  if (command.type === "answer") {
    if (!command.reply) return false;
    if (String(session.pendingQuestion?.requestId) !== String(requestId)) return false;
    handlers.answer(session.id, requestId, command.reply);
    return true;
  }
  return false;
}

/** When the last heartbeat was sent and whether it reported nothing. */
export type DesktopLiveBeat = {
  idleAt?: number;
  notesRevision?: number;
  queueSeq?: number;
  adoptedSeq?: number;
  directoryFingerprint?: string;
  directorySequence?: number;
  directoryAck?: string;
  directoryResend?: boolean;
  /** The last directory serialized, so an unchanged object is not stringified again. */
  serialized?: { directory: DesktopProjectDirectory; json: string; revision?: string };
};

/** One exchange with the host: report live sessions plus what was handled
 * since last time, then execute the commands it returns. `unacked` keeps ids
 * until a call succeeds; `handled` dedupes re-sent commands. With a `beat`,
 * an empty heartbeat is not repeated before DESKTOP_LIVE_IDLE_MS. */
export async function runDesktopLiveTick(deps: {
  beat?: DesktopLiveBeat;
  now?: () => number;
  clientId?: string;
  request: (payload: DesktopLivePayload) => Promise<DesktopLiveResult | undefined>;
  sessions: () => readonly Session[];
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
  const live = buildDesktopLiveSessions(deps.sessions());
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
      directoryRevision = serialized?.json === directoryFingerprint ? serialized.revision : undefined;
      if (!directoryRevision) {
        deps.beat.directorySequence = (deps.beat.directorySequence ?? 0) + 1;
        directoryRevision = String(deps.beat.directorySequence);
      }
      deps.beat.serialized = { directory: projectDirectory, json: directoryFingerprint, revision: directoryRevision };
    }
  }
  const directoryChanged = directoryFingerprint !== deps.beat?.directoryFingerprint || deps.beat?.directoryResend === true;
  const inboxReplies = [...(deps.inbox?.results.values() ?? [])].slice(0, 2);
  const heldLeases = deps.queueLeases?.held() ?? [];
  const heldRuns = deps.runLeases?.held() ?? [];
  const idle =
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
    ...(projectDirectory && (!directoryRevision || deps.beat?.directoryAck !== directoryRevision)
      ? { projectDirectory } : {}),
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
    sessions: live,
    ...(acked.length > 0 ? { acked } : {}),
    ...(deps.beat?.queueSeq !== undefined ? { queueSeq: deps.beat.queueSeq } : {}),
    ...(deps.beat?.adoptedSeq !== undefined ? { adoptedSeq: deps.beat.adoptedSeq } : {}),
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
  const result = await deps.request(payload);
  if (deps.beat) {
    deps.beat.directoryFingerprint = directoryFingerprint;
    deps.beat.directoryAck = directoryRevision && result?.projectDirectoryRevision === directoryRevision
      ? directoryRevision : undefined;
    // A restarted host cannot acknowledge an omitted projection. Retry the
    // full privacy snapshot next beat; old hosts keep the legacy full cadence.
    deps.beat.directoryResend = !!projectDirectory && !payload.projectDirectory && !deps.beat.directoryAck;
  }
  if (result?.queueLeases) deps.queueLeases?.answered(result.queueLeases);
  // A run lease the host took back: another computer runs this conversation now,
  // so this window stops its turn instead of writing next to it.
  if (result?.runLeases && deps.runLeases)
    for (const sessionId of deps.runLeases.answered(result.runLeases)) deps.handlers.stop(sessionId);
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
        .then(() => deps.handlers.delete!(job.sessionId, job.cwd))
        .then(() => runner.results.set(job.id, { id: job.id }))
        .catch((error) => runner.results.set(job.id, { id: job.id, error: safeInboxError(error) }))
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
        .then((value) =>
          runner.results.set(job.id, { id: job.id, result: jsonSafe(value ?? null) }),
        )
        .catch((error) => runner.results.set(job.id, { id: job.id, error: safeInboxError(error) }))
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
  for (const id of acked) deps.unacked.delete(id);
  const commands = Array.isArray(result?.commands) ? result.commands : [];
  for (const command of commands) {
    if (!command || typeof command.id !== "string") continue;
    // Older hosts return all windows' commands. Never acknowledge a session
    // this window doesn't have, or it will disappear before its owner sees it.
    if (!deps.sessions().some((session) => session.id === command.sessionId)) continue;
    if (deps.handled.has(command.id)) {
      deps.unacked.add(command.id);
      continue;
    }
    try {
      applyDesktopLiveCommand(command, deps.sessions(), deps.handlers);
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
