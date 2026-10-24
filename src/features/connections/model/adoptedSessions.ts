import type { AdoptedDivergence, Block, Session } from "../../sessions/model/session";
import { isTurnInterruptMessage } from "../../sessions/model/inFlight";
import type { HostSession } from "./protocol";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { persistableAttachment } from "../../sessions/model/attachments";
import { buildConversationReplay } from "../../sessions/model/conversationRewind";
import { keepFullTranscript, restoreLocalFiles, sameRemoteBlock } from "./remotePreview";
import {
  blockDigest,
  conversationHead,
  transcriptDigests,
} from "../../sync/model/conversationDigest";
import {
  atHead,
  headOfDigests,
  reconcile,
  sameHead,
  type ConversationHead,
  type Reconciled,
} from "../../sync/model/conversationHead";

/** A host session adopted from this machine's desktop app (`sessions.adopted`). */
export type AdoptedEntry = {
  id: string;
  projectId: string;
  revision: number;
  updatedAt: number;
  status: "idle" | "running" | "interrupted";
};

export const ADOPTED_CAPABILITY = "sessions.desktop";
/** Fired with the project folder when a session started on this machine's
 * host from another computer is first saved here. */
export const ADOPTED_SESSION_ADDED = "bycoda:adopted-session-added";

/** The desktop copy of a session the host started: the project folder as the
 * session's place, and the host's working copy as its worktree when different. */
export function desktopCopyOf(
  host: HostSession,
  projectCwd: string,
  same: (a: string, b: string) => boolean,
): Session {
  const remote = host.session;
  const workCwd = remote.worktreeCwd || remote.cwd;
  const { busy: _busy, pendingQuestion: _question, ...rest } = remote;
  return {
    ...rest,
    cwd: projectCwd,
    worktreeCwd: workCwd && !same(workCwd, projectCwd) ? workCwd : undefined,
    title: remote.title || "Session",
    historyPartial: undefined,
    historyLoading: undefined,
    historyLoadError: undefined,
    continuingElsewhere: host.status === "running" || undefined,
    // The copy is the host's transcript, so that is where both last agreed.
    adoptedBase: hostHead(host),
  };
}
export const ADOPTED_RUNNING_REASON =
  "This conversation is running in the background on this computer. New messages appear automatically.";
export const ADOPTED_CONFLICT_MESSAGE =
  "Two versions of this conversation were found. Your messages were kept. Sync to compare them again.";
/** A proven divergence: both computers added to the conversation after the version they last shared. */
export const ADOPTED_CHOICE_MESSAGE =
  "This conversation was changed on two computers. Choose the version to keep.";
/** What each answer costs, shown with the choice so no answer discards work unseen. */
export const ADOPTED_CHOICE_CONSEQUENCES =
  "Keep this discards the other computer's changes. Keep other discards the changes made here. Keep both keeps everything.";
export const ADOPTED_DISCARD_QUESTION =
  "Discard the other computer's changes and keep this version? Keep both saves them instead.";
export const ADOPTED_POLL_VISIBLE_MS = 5_000;
export const ADOPTED_POLL_HIDDEN_MS = 20_000;

export function supportsAdoptedSessions(capabilities: string[] | undefined): boolean {
  return !!capabilities?.includes(ADOPTED_CAPABILITY);
}

/** A loaded copy that can be compared: idle, with its whole transcript. A
 * long one opens with only its tail until earlier pages arrive. */
const comparable = (session: Session | undefined): session is Session =>
  !!session && !session.busy && !session.historyLoading;

/** A divergence restored from storage that this run has not confirmed against
 * the host. It locks nothing until a pass proves it live. */
const unconfirmed = (session: Session): boolean =>
  !!session.adoptedDivergence && !session.adoptedDivergence.keep && !session.adoptedSyncConflict;

/** Entries worth fetching: a loaded, idle local copy whose host revision moved,
 * or whose stored divergence is yet to be confirmed against the host. */
export function planAdoptedFetches(
  entries: readonly AdoptedEntry[],
  local: readonly Session[],
  mirrored: ReadonlyMap<string, number>,
): AdoptedEntry[] {
  const byId = new Map(local.map((session) => [session.id, session]));
  return entries.filter((entry) => {
    const session = byId.get(entry.id);
    return (
      comparable(session) && (mirrored.get(entry.id) !== entry.revision || unconfirmed(session))
    );
  });
}

/** The host copy's transcript laid over the local session. Desktop identity
 * (id, cwd, worktree) stays local. A shared baseline permits a host
 * reset/rewind; first contact only permits an identical local prefix. */
function transcript(session: Session): string {
  return canonicalJson(
    session.blocks.map((block) => ({
      ...block,
      // Stamped by the host when it shrinks a block for transport. Its revision
      // moves with every host save and is no part of the message.
      remoteContent: undefined,
      // The host keeps a finished block's `streaming: false`; desktop storage
      // drops it. Only an open stream is part of the comparison.
      streaming: block.streaming || undefined,
      image: block.image
        ? (({ data: _data, loadPreview: _load, ...image }) => image)(block.image)
        : undefined,
      // Desktop-only file/preview flags disappear during persistence, and
      // `path` is where one machine stored the file: transcript pages and the
      // remote cache drop it in transit. Neither is part of the message, and
      // must not make an unchanged message look like a competing local edit.
      attachments: block.attachments?.length
        ? block.attachments.map((file) => {
            const { path: _path, ...content } = persistableAttachment(file);
            return content;
          })
        : undefined,
    })),
  );
}

const OPEN_TOOL_STATUS = new Set(["in_progress", "pending", "running"]);

/** Still being written when the host saved it; a desktop quit seals it. */
function isOpenBlock(block: Block): boolean {
  return (
    !!block.streaming ||
    OPEN_TOOL_STATUS.has(block.tool?.status?.toLowerCase() ?? "") ||
    (!!block.approval && !block.approval.decided) ||
    block.plan?.status === "streaming" ||
    block.orchestration?.status === "planning" ||
    !!block.taskList?.items.some((item) => item.status === "in_progress")
  );
}

function isQuitNotice(block: Block): boolean {
  return (
    block.role === "system" && (block.notice === "interrupt" || isTurnInterruptMessage(block.text))
  );
}

const blockJson = (block: Block) => transcript({ blocks: [block] } as Session);

/** The same block, or one side is the host's shrunk wire form of the other. */
const equalBlock = (a: Block, b: Block) => blockJson(a) === blockJson(b) || sameRemoteBlock(a, b);

/** The same transcript, up to the host's shrunk wire form of its blocks. */
function sameTranscript(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((block, i) => equalBlock(block, b[i]!));
}

/** Turn bookkeeping the side that ran a turn stamps on its user message after
 * the other side copied it. It never changes what the user wrote. */
const userTurnBookkeeping = (block: Block): Block => ({
  ...block,
  startedAt: undefined,
  durationMs: undefined,
  providerTurnId: undefined,
  turnMetrics: undefined,
  turnModel: undefined,
});

/** Provider progress on the same tool or subagent row: a late subagent result
 * or a bounded persisted preview, not a competing message. */
const toolProgress = (block: Block): Block => ({ ...block, tool: undefined, agentRun: undefined });

/** Same message, differing only in bookkeeping or provider progress. */
function sameBlockContent(a: Block, b: Block): boolean {
  if (a.role === "user") return equalBlock(userTurnBookkeeping(a), userTurnBookkeeping(b));
  return (
    (!!a.tool || !!a.agentRun || !!b.tool || !!b.agentRun) &&
    equalBlock(toolProgress(a), toolProgress(b))
  );
}

/** The local block is an earlier state of the host's same reply. */
function isCutShort(local: Block, host: Block): boolean {
  return (
    local.id === host.id &&
    local.role === host.role &&
    local.role !== "user" &&
    typeof local.text === "string" &&
    typeof host.text === "string" &&
    host.text.length > local.text.length &&
    host.text.startsWith(local.text)
  );
}

/** The digests of the host's transcript, when they are known and the host's own
 * head vouches for them (a host that sent none, or a window of it, is not one). */
function hostDigests(host: HostSession): string[] | undefined {
  const digests = transcriptDigests(host.session.blocks);
  if (!digests) return undefined;
  if (host.head && !sameHead(host.head, headOfDigests(digests))) return undefined;
  return digests;
}

/** Where the host's transcript stands, when it can be compared. */
function hostHead(host: HostSession): ConversationHead | undefined {
  const digests = hostDigests(host);
  return digests && headOfDigests(digests);
}

/** Which side changed since the last agreement (the saved `adoptedBase`), from
 * digests alone; `undefined` when either transcript carries content that cannot
 * be compared. The baseline of this run only says the local copy is unchanged
 * when it is the local copy: it is otherwise the host's transcript, which a
 * sealed local turn kept over a stale host copy does not agree with. */
function transcriptVerdict(
  local: Session,
  host: HostSession,
  baseline?: Session,
): Reconciled | undefined {
  const mine = transcriptDigests(local.blocks);
  const theirs = hostDigests(host);
  if (!mine || !theirs) return undefined;
  let base = local.adoptedBase;
  if (!base && baseline) {
    const head = conversationHead(baseline.blocks);
    if (head && atHead(mine, head)) base = head;
  }
  return reconcile(mine, theirs, base);
}

/** The host's blocks with this desktop's full block kept wherever the host sent
 * only a shrunk one of the same digest: a shrunk block is never written over
 * the full one. A shrunk block of another digest is a changed block, and is
 * taken (with the files this desktop holds for it): its preview is never
 * compared with the local content, which could hide the change. */
function keepFullByDigest(local: readonly Block[], host: Block[]): Block[] {
  if (!host.some((block) => block.remoteContent)) return host;
  const byId = new Map(local.map((block) => [block.id, block]));
  let changed = false;
  const blocks = host.map((block) => {
    const mine = block.remoteContent ? byId.get(block.id) : undefined;
    if (!mine || mine.role !== block.role) return block;
    const kept =
      !mine.remoteContent && blockDigest(mine) === blockDigest(block)
        ? mine
        : restoreLocalFiles(mine, block);
    if (kept !== block) changed = true;
    return kept;
  });
  return changed ? blocks : host;
}

/** Which side holds more of one shared transcript, or `undefined` when they
 * diverge. Quitting mid-turn seals the desktop's open turn (cancelled tools,
 * settled approvals, turn duration) and appends a notice: a host block still
 * open matches its sealed local version, and quit notices are not content. */
export function adoptedTranscriptLead(
  local: Session,
  remote: Session,
): "same" | "local" | "host" | undefined {
  const { lead } = compareTranscripts(local, remote);
  return lead;
}

/** The lead, or for diverged transcripts the first pair of blocks that differ. */
function compareTranscripts(
  local: Session,
  remote: Session,
): { lead?: "same" | "local" | "host"; divergence?: string } {
  const mine = local.blocks.filter((block) => !isQuitNotice(block));
  const theirs = remote.blocks.filter(
    (block) => !isQuitNotice(block) && (block.role !== "approval" || !!block.approval?.decided),
  );
  const shared = Math.min(mine.length, theirs.length);
  for (let i = 0; i < shared; i++) {
    const a = mine[i];
    const b = theirs[i];
    if (
      a.id === b.id &&
      a.role === b.role &&
      (equalBlock(a, b) || isOpenBlock(b) || sameBlockContent(a, b))
    )
      continue;
    // A copy saved while the host was still writing its reply ends in that
    // reply cut short (storage drops the stream flag). The host holds more of
    // it: never "same", which would let the stale tail replace the reply.
    if (i === mine.length - 1 && isCutShort(a, b)) return { lead: "host" };
    return { divergence: `${i}\0${a.id}\0${b.id}` };
  }
  if (mine.length === theirs.length) return { lead: "same" };
  return { lead: mine.length > theirs.length ? "local" : "host" };
}

/** The host copy only lags this desktop: it has not caught up with turns run
 * here yet. That is not a conflict and needs no separate local copy. An empty
 * host transcript was reset, and a host running its own turn has diverged. */
export function adoptedLocalAhead(local: Session, host: HostSession): boolean {
  if (host.status === "running" || host.session.blocks.length === 0) return false;
  const verdict = transcriptVerdict(local, host);
  if (verdict && verdict !== "conflict") return verdict === "localAhead";
  // No digests, or a difference they cannot excuse (a turn sealed at quit).
  return adoptedTranscriptLead(local, host.session) === "local";
}

/** A merge baseline records the transcript the host held, so a sealed local
 * turn kept over a stale host copy still counts as local on the next pass. */
function baselineOf(merged: Session, host: HostSession): Session {
  return { ...merged, blocks: host.session.blocks };
}

export function mergeAdoptedSession(
  local: Session,
  host: HostSession,
  base?: Session,
): Session | undefined {
  const remote = host.session;
  let keepLocal = false;
  const verdict = transcriptVerdict(local, host, base);
  // This computer holds blocks the host lacks: the host catches up from it.
  if (verdict === "localAhead") return undefined;
  const settled = verdict === "equal" || verdict === "hostAhead";
  if (!settled && !sameTranscript(local.blocks, remote.blocks)) {
    // The host may legitimately reset/rewind. Only accept it if the local
    // transcript hasn't changed since our last successful merge. On first
    // contact there is no shared ancestor: an identical prefix is safe; block
    // count alone doesn't prove the local text is unchanged.
    const accepted = base
      ? sameTranscript(local.blocks, base.blocks)
      : remote.blocks.length >= local.blocks.length &&
        sameTranscript(local.blocks, remote.blocks.slice(0, local.blocks.length));
    if (!accepted) {
      // A host copy saved before a quit is behind the sealed local turn
      // unless the host has continued past it.
      const lead = adoptedTranscriptLead(local, remote);
      if (lead !== "same" && lead !== "host") return undefined;
      keepLocal = lead === "same" && host.status !== "running";
    }
  }
  const fromHost = <K extends keyof Session>(key: K): Session[K] =>
    base && canonicalJson(local[key]) !== canonicalJson(base[key]) ? local[key] : remote[key];
  // Provider configuration and its resume identity move as one unit. A local
  // edit conflicting with a host edit needs an explicit refresh, just like a
  // divergent transcript; never bind a host thread through a retained adapter.
  const provider = providerIdentity;
  const localChanged = !!base && provider(local) !== provider(base);
  if (localChanged && provider(remote) !== provider(base) && provider(remote) !== provider(local))
    return undefined;
  const configuration = localChanged ? local : remote;
  // The host sends a shrunk form of blocks with files or large output: this
  // desktop's full content stays wherever that is all that differs.
  const blocks = settled
    ? verdict === "equal" && host.status !== "running"
      ? local.blocks
      : keepFullByDigest(local.blocks, remote.blocks)
    : keepLocal
      ? local.blocks
      : keepFullTranscript(local.blocks, remote.blocks);
  const hosted = hostHead(host);
  // Both now hold this transcript; the next comparison starts from it. A
  // sealed local turn kept over a stale host copy is not agreed on: the
  // tolerant comparison judges it again next time. Nor is a block that was
  // kept without being the host's: the base never moves past one not taken.
  const agreed =
    !settled && keepLocal
      ? local.adoptedBase
      : !hosted
        ? undefined
        : settled || sameHead(conversationHead(blocks), hosted)
          ? hosted
          : local.adoptedBase;
  return {
    ...local,
    blocks,
    adoptedBase: agreed,
    historyPartial: undefined,
    historyLoading: undefined,
    historyLoadError: undefined,
    title: fromHost("title") || local.title,
    harness: configuration.harness,
    model: configuration.model,
    modelSettings: configuration.modelSettings,
    providerSessionId: configuration.providerSessionId,
    providerAccountId:
      configuration.harness === local.harness ? local.providerAccountId : undefined,
    runtimeMode: fromHost("runtimeMode") ?? local.runtimeMode,
    rewindHistory: fromHost("rewindHistory"),
    pendingContextReplay: fromHost("pendingContextReplay"),
    ...(remote.context ? { context: remote.context } : {}),
    continuingElsewhere: host.status === "running" || undefined,
    retryMessage: host.status === "running" ? remote.retryMessage : undefined,
    adoptedSyncConflict: undefined,
    adoptedDivergence: undefined,
  };
}

/** Provider configuration and its resume identity, which move as one unit. */
const providerIdentity = (session: Session) =>
  canonicalJson({
    harness: session.harness,
    model: session.model,
    modelSettings: session.modelSettings ?? {},
    providerSessionId: session.providerSessionId,
  });

function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/** Names a divergence by the content that differs, so the same one is the same
 * key on every pass and after a restart, while a newer one is a different key. */
export function adoptedDivergenceKey(local: Session, remote: Session): string {
  const mine = transcriptDigests(local.blocks);
  const theirs = transcriptDigests(remote.blocks);
  if (mine && theirs) {
    const base = local.adoptedBase;
    if (reconcile(mine, theirs, base) === "conflict") {
      const name = (head?: ConversationHead) => (head ? `${head.count}.${head.chain}` : "");
      return ["heads", name(base), name(headOfDigests(mine)), name(headOfDigests(theirs))].join(
        ":",
      );
    }
  }
  const divergence = mine && theirs ? undefined : compareTranscripts(local, remote).divergence;
  if (divergence) {
    const [index, localId, hostId] = divergence.split("\0");
    const a = local.blocks.find((block) => block.id === localId);
    const b = remote.blocks.find((block) => block.id === hostId);
    return [
      index,
      localId,
      hostId,
      a ? hashText(blockJson(a)) : "",
      b ? hashText(blockJson(b)) : "",
    ].join(":");
  }
  // Same blocks, but the sides disagree about where the conversation goes on.
  return [
    "configuration",
    local.blocks[local.blocks.length - 1]?.id ?? "",
    remote.blocks[remote.blocks.length - 1]?.id ?? "",
    hashText(providerIdentity(local)),
    hashText(providerIdentity(remote)),
  ].join(":");
}

/** The user's "Keep this" still stands: the host's transcript is the one they
 * saw (`adoptedBase`, the host head when it was flagged) plus whatever the host
 * has appended since. A host that goes on streaming only adds to what was
 * discarded; it is asked about again only when it no longer contains that
 * version (rewound, or changed earlier than the head the user saw). */
function keptDecisionHolds(session: Session, host: HostSession): boolean {
  const base = session.adoptedBase;
  if (!session.adoptedDivergence?.keep || !base || base.count === 0) return false;
  const theirs = hostDigests(host);
  return !!theirs && atHead(theirs.slice(0, base.count), base);
}

/** The divergence this pass found was already answered with "Keep this". */
const answeredByKeep = (session: Session, host: HostSession, key: string): boolean =>
  !!session.adoptedDivergence?.keep &&
  (session.adoptedDivergence.key === key || keptDecisionHolds(session, host));

/** What a pass that found this computer ahead leaves of a divergence: a flag is
 * resolved, but the user's "Keep this" is remembered until both computers hold
 * the same transcript, so the host appending before it catches up is not asked
 * about again. */
const settledDivergence = (session: Session): Pick<Session, "adoptedDivergence"> => ({
  adoptedDivergence: session.adoptedDivergence?.keep ? session.adoptedDivergence : undefined,
});

/** The user chose to keep this computer's version of a flagged divergence. */
export function keepAdoptedDivergence(session: Session): Session {
  if (!session.adoptedDivergence) return session;
  const { key, hostHead: agreed } = session.adoptedDivergence;
  return {
    ...session,
    adoptedSyncConflict: undefined,
    adoptedDivergence: { key, keep: true },
    // This version is what the host held when the divergence was flagged plus
    // what was written here since: the host catches up from it.
    ...(agreed ? { adoptedBase: agreed } : {}),
  };
}

export type AdoptedMirrorDeps = {
  list: () => Promise<AdoptedEntry[]>;
  /** `known` is the last snapshot this mirror received, to fetch only what
   * changed since; a host that cannot honour it makes the loader fall back to
   * a full snapshot. */
  load: (sessionId: string, known?: HostSession) => Promise<HostSession>;
  local: () => readonly Session[];
  /** Replaces the local session; `previous` is the copy it was merged from. */
  apply: (merged: Session, previous: Session) => void;
  mirrored: Map<string, number>;
  /** The stored copy of a session no tab has loaded. */
  stored?: (sessionId: string) => Promise<Session | null>;
  /** The stored copy's `updatedAt`, read before the host snapshot is loaded. */
  stamp?: (sessionId: string) => Promise<number | null>;
  /** Writes a merged copy of a session no tab has loaded. With a `stamp` it
   * must refuse (resolve `false`) when the stored copy changed since. */
  save?: (merged: Session, stamp?: number | null) => Promise<void | boolean>;
  /** A session this desktop has never had: one started on the host from
   * another computer. Saves a copy when its project is on this desktop.
   * Success establishes presence, not the revision of any newly opened tab. */
  adopt?: (entry: AdoptedEntry) => Promise<void | boolean>;
  /** Flags the loaded session. A proven content divergence comes with its key,
   * for the session to remember. Never saves a copy. */
  conflict?: (local: Session, divergence?: AdoptedDivergence) => void;
  /** Live status is independent of whether a transcript can be merged. */
  onRunning?: (running: ReadonlySet<string>) => void;
  /** Saves this computer's version as its own conversation when the user keeps
   * both. Only an explicit answer to a conflict calls it, never a mirror pass. */
  preserve?: (copy: Session) => Promise<boolean>;
};

/** Sessions known to have a stored copy, per mirror, so a running one is not
 * read from storage again on every pass. */
const storedHere = new WeakMap<Map<string, number>, Set<string>>();
const baselines = new WeakMap<Map<string, number>, Map<string, Session>>();
/** The last host snapshot received per session, to ask for deltas. Bounded:
 * a snapshot is a whole transcript. */
const snapshots = new WeakMap<Map<string, number>, Map<string, HostSession>>();
/** Sessions seen running on the host whose finished transcript has not been
 * applied here yet, with when it was first missed. They stay "continuing
 * elsewhere" so no local turn starts on the stale copy. */
const awaitingHost = new WeakMap<Map<string, number>, Map<string, number | undefined>>();
/** The least time between two looks at a flagged conversation nobody has
 * answered yet (the host's heartbeat can name it every second or so). */
export const ADOPTED_FLAGGED_REFETCH_MS = 5_000;
/** When a flagged conversation was last compared, and what it was compared at. */
const flaggedFetches = new WeakMap<
  Map<string, number>,
  Map<string, { at: number; revision: number; blocks: Block[] }>
>();
/** Flagged on this run and not answered: the user has yet to choose. */
const awaitingAnswer = (session: Session | undefined): session is Session =>
  !!session?.adoptedSyncConflict && !!session.adoptedDivergence && !session.adoptedDivergence.keep;
/** How long a finished host turn may fail to arrive before the conversation
 * is handed to an explicit sync instead of staying held. */
export const ADOPTED_ARRIVAL_LIMIT_MS = 60_000;
export const ADOPTED_SNAPSHOT_LIMIT = 6;

/** How the user answered a genuine conflict. Keeping this computer's version
 * needs no host: it is recorded on the session (`keepAdoptedDivergence`). */
export type AdoptedResolution = "keep-other" | "keep-both";

/** The same id for the same conflict, so answering it twice (a retry, a restart
 * in the middle) never makes a second branch. */
export function adoptedBranchId(sessionId: string, key: string): string {
  const seed = `${sessionId}\0${key}`;
  const part = (salt: number) => {
    let hash = (0x811c9dc5 ^ salt) >>> 0;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  const hex = [1, 2, 3, 4].map(part).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** This computer's version as its own conversation. It keeps its context by
 * replaying it once; it has no provider thread, which stays with the conversation
 * both computers keep (one thread, one owner). */
function adoptedBranch(before: Session, id: string, at = new Date()): Session {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const replay = buildConversationReplay(before.blocks);
  return {
    id,
    harness: before.harness,
    model: before.model,
    modelSettings: { ...before.modelSettings },
    runtimeMode: before.runtimeMode,
    title: `${before.title || "Session"} (branch, ${stamp})`,
    cwd: before.cwd,
    worktreeCwd: before.worktreeCwd,
    worktreeRemoved: before.worktreeRemoved,
    branch: before.branch,
    providerAccountId: before.providerAccountId,
    blocks: before.blocks,
    ...(replay ? { pendingContextReplay: replay } : {}),
  };
}

/** An explicit refresh never replaces or copies a conversation whose two
 * versions both moved: that is flagged for the user's answer (`resolution`). It
 * never sends a command to, or stops, the host's running turn. Resolves `true`
 * when a branch was saved. */
export async function refreshAdoptedSession(
  deps: AdoptedMirrorDeps,
  sessionId: string,
  resolution?: AdoptedResolution,
): Promise<boolean> {
  const entry = (await deps.list()).find((item) => item.id === sessionId);
  if (!entry) throw new Error("This conversation is no longer available on the host.");
  const before = deps.local().find((session) => session.id === sessionId);
  if (!before || before.busy)
    throw new Error("Wait for the local turn to finish before refreshing.");
  // A partly loaded transcript would be saved as a branch missing its start;
  // the mirror catches it up once loaded.
  if (before.historyLoading) return false;
  // Always request a full snapshot, including when the revision has not moved.
  const host = await deps.load(sessionId);
  return applyAdoptedSnapshot(deps, before, host, resolution);
}

/** Both manual and periodic refresh leave a divergence for the user to answer. */
async function applyAdoptedSnapshot(
  deps: AdoptedMirrorDeps,
  before: Session,
  host: HostSession,
  resolution?: AdoptedResolution,
): Promise<boolean> {
  const sessionId = before.id;
  const beforeTranscript = transcript(before);
  // Only a change to the conversation itself aborts a refresh. Other computers
  // keep updating the same session object while this runs (the shared queue, the
  // running indicator); those updates are carried over, never a reason to fail
  // after the branch was already saved.
  const unchanged = () => {
    const current = deps.local().find((session) => session.id === sessionId);
    if (!comparable(current) || transcript(current) !== beforeTranscript)
      throw new Error("The local conversation changed while refreshing. Try again.");
    return current;
  };
  before = unchanged();
  const base = baselines.get(deps.mirrored)?.get(sessionId);
  let merged = mergeAdoptedSession(before, host, base);
  if (!merged && adoptedLocalAhead(before, host)) {
    // The host only lags turns run here and catches up from the desktop copy.
    // Replacing them with its older transcript would lose them.
    if (before.adoptedSyncConflict || before.adoptedDivergence)
      deps.apply(
        { ...before, adoptedSyncConflict: undefined, ...settledDivergence(before) },
        before,
      );
    deps.mirrored.set(sessionId, host.revision);
    return false;
  }
  let branched = false;
  if (!merged) {
    const key = adoptedDivergenceKey(before, host.session);
    if (!resolution) {
      // A genuine conflict is the user's to answer. While they choose, nothing is
      // replaced and no copy exists.
      const agreed = hostHead(host);
      deps.conflict?.(before, { key, ...(agreed ? { hostHead: agreed } : {}) });
      return false;
    }
    if (resolution === "keep-both") {
      // The key the user answered, saved with the session: a retry after the
      // host moved on must find the branch it already made, not make another.
      const id = adoptedBranchId(sessionId, before.adoptedDivergence?.key ?? key);
      // Answered before (a retry, or a restart in the middle): the branch is
      // already there, and whatever was done in it since is kept.
      const existing = await Promise.resolve(deps.stored?.(id)).catch(() => null);
      if (!existing) {
        const saved = await deps.preserve?.(adoptedBranch(before, id)).catch(() => false);
        if (!saved)
          throw new Error(
            "Could not save this computer's version as a new conversation. Your conversation was kept. Try again.",
          );
      }
      branched = true;
      before = unchanged();
    }
    // The user chose the host's version: this transcript is the baseline it
    // replaces, whatever was last agreed.
    merged = mergeAdoptedSession({ ...before, adoptedBase: undefined }, host, before)!;
  }
  deps.apply(merged, before);
  let bases = baselines.get(deps.mirrored);
  if (!bases) baselines.set(deps.mirrored, (bases = new Map()));
  bases.set(sessionId, baselineOf(merged, host));
  // Drop any older delta base; the next automatic pass starts from a full copy.
  snapshots.get(deps.mirrored)?.delete(sessionId);
  deps.mirrored.set(sessionId, host.revision);
  return branched;
}

/** One mirror pass. Returns the ids the host is still running, so the caller
 * can hold local sending for them. */
export async function mirrorAdoptedSessions(deps: AdoptedMirrorDeps): Promise<Set<string>> {
  const entries = await deps.list();
  let base = baselines.get(deps.mirrored);
  if (!base) baselines.set(deps.mirrored, (base = new Map()));
  const liveIds = new Set(entries.map((entry) => entry.id));
  for (const id of base.keys()) if (!liveIds.has(id)) base.delete(id);
  let known = snapshots.get(deps.mirrored);
  if (!known) snapshots.set(deps.mirrored, (known = new Map()));
  for (const id of known.keys()) if (!liveIds.has(id)) known.delete(id);
  // Remembered once the host copy was either applied or judged against the
  // local one; a snapshot dropped on a race is not, so it is fetched again.
  const remember = (id: string, host: HostSession) => {
    known.delete(id);
    known.set(id, host);
    if (known.size > ADOPTED_SNAPSHOT_LIMIT) known.delete(known.keys().next().value!);
  };
  const running = new Set(entries.filter((entry) => entry.status === "running").map((e) => e.id));
  const listed = new Map(entries.map((entry) => [entry.id, entry]));
  let awaiting = awaitingHost.get(deps.mirrored);
  if (!awaiting) awaitingHost.set(deps.mirrored, (awaiting = new Map()));
  for (const id of running) awaiting.set(id, undefined);
  // Released once its last revision is applied (or judged: local ahead) or
  // flagged as a conflict, which waits for an explicit sync instead.
  const held = () => {
    const flagged = new Set(
      deps.local().filter((session) => session.adoptedSyncConflict).map((session) => session.id),
    );
    for (const [id, since] of awaiting) {
      const entry = listed.get(id);
      if (!entry) {
        awaiting.delete(id);
        continue;
      }
      if (entry.status === "running") continue;
      if (deps.mirrored.get(id) === entry.revision || flagged.has(id)) {
        awaiting.delete(id);
        continue;
      }
      if (since === undefined) awaiting.set(id, Date.now());
      else if (Date.now() - since > ADOPTED_ARRIVAL_LIMIT_MS) {
        // Still unreadable: nothing is replaced; the Sync banner takes over.
        const current = deps.local().find((session) => session.id === id);
        if (current) deps.conflict?.(current);
        awaiting.delete(id);
      }
    }
    return new Set(awaiting.keys());
  };
  deps.onRunning?.(held());
  let fetched = flaggedFetches.get(deps.mirrored);
  if (!fetched) flaggedFetches.set(deps.mirrored, (fetched = new Map()));
  for (const id of fetched.keys()) if (!liveIds.has(id)) fetched.delete(id);
  // A flagged conversation waits for the user's answer, and the host may move on
  // every second while it streams: it is compared again at most every few
  // seconds, and not at all while neither side has moved since the last look.
  const settling = (entry: AdoptedEntry) => {
    const last = fetched.get(entry.id);
    const session = deps.local().find((item) => item.id === entry.id);
    if (!last || !awaitingAnswer(session)) return false;
    if (last.revision === entry.revision && last.blocks === session.blocks) return true;
    return Date.now() - last.at < ADOPTED_FLAGGED_REFETCH_MS;
  };
  for (const entry of planAdoptedFetches(entries, deps.local(), deps.mirrored)) {
    if (settling(entry)) continue;
    try {
      const before = deps.local().find((session) => session.id === entry.id);
      const host = await deps.load(entry.id, known.get(entry.id));
      // A local turn may have started while the snapshot was in flight.
      const current = deps.local().find((session) => session.id === entry.id);
      if (!comparable(current)) continue;
      if (before && transcript(before) !== transcript(current)) {
        deps.conflict?.(current);
        continue;
      }
      const merged = mergeAdoptedSession(current, host, base.get(entry.id));
      if (!merged) {
        // Not mirrored, but the host copy itself arrived: the next pass only
        // needs what changed after it.
        remember(entry.id, host);
        // The host has yet to catch up with turns run here. Judged at this
        // revision; its next change is fetched and compared again.
        if (adoptedLocalAhead(current, host)) {
          if (current.adoptedSyncConflict || current.adoptedDivergence)
            deps.apply(
              { ...current, adoptedSyncConflict: undefined, ...settledDivergence(current) },
              current,
            );
          deps.mirrored.set(entry.id, host.revision);
          continue;
        }
        // A genuine divergence is flagged for the user to answer, once: the
        // same one is neither flagged again nor copied after a restart. A pass
        // never saves a separate copy; only an explicit refresh does.
        const key = adoptedDivergenceKey(current, host.session);
        if (answeredByKeep(current, host, key)) {
          // Answered: keep this version, also while the host only goes on adding
          // to the version that was discarded. Nothing to show, nothing to refetch.
          if (current.adoptedSyncConflict)
            deps.apply({ ...current, adoptedSyncConflict: undefined }, current);
          deps.mirrored.set(entry.id, host.revision);
          continue;
        }
        const agreed = hostHead(host);
        deps.conflict?.(current, { key, ...(agreed ? { hostHead: agreed } : {}) });
        continue;
      }
      deps.apply(merged, current);
      remember(entry.id, host);
      base.set(entry.id, baselineOf(merged, host));
      deps.mirrored.set(entry.id, host.revision);
    } catch {
      // Retried on the next pass.
    } finally {
      const after = deps.local().find((session) => session.id === entry.id);
      if (awaitingAnswer(after))
        fetched.set(entry.id, { at: Date.now(), revision: entry.revision, blocks: after.blocks });
      else fetched.delete(entry.id);
    }
  }
  // Closed sessions are caught up in storage, so history shows the host copy
  // and opening one later starts from it.
  if (deps.stored && deps.save) {
    const loaded = new Set(deps.local().map((session) => session.id));
    let present = storedHere.get(deps.mirrored);
    if (!present) storedHere.set(deps.mirrored, (present = new Set()));
    for (const entry of entries) {
      if (loaded.has(entry.id) || deps.mirrored.get(entry.id) === entry.revision) continue;
      // A running session already stored here waits for its turn to end.
      if (entry.status === "running" && present.has(entry.id)) continue;
      try {
        const stored = await deps.stored(entry.id);
        if (stored) present.add(entry.id);
        if (!stored) {
          // New to this desktop: listed at once, even mid-turn, so the work
          // started elsewhere shows up here while it runs.
          if (!deps.adopt || (await deps.adopt(entry)) === false) continue;
          // A tab can open during adoption with an older stored copy. Only a
          // transcript applied to that tab establishes its mirrored revision.
          present.add(entry.id);
          // The saved copy, as storage returns it, is the shared baseline: a
          // copy still unchanged from it takes the host's later turns as they
          // are, even when it was saved mid-reply.
          const adopted = await deps.stored(entry.id).catch(() => null);
          if (adopted && !base.has(entry.id)) base.set(entry.id, adopted);
          continue;
        }
        // A copy the host is still writing is caught up once the turn ends.
        if (entry.status === "running") continue;
        if (!deps.local().some((session) => session.id === entry.id)) {
          const stamp = await deps.stamp?.(entry.id);
          const host = await deps.load(entry.id, known.get(entry.id));
          // Storage can change while a remote snapshot is in flight too.
          const current = await deps.stored(entry.id);
          if (
            !current ||
            transcript(current) !== transcript(stored) ||
            deps.local().some((session) => session.id === entry.id)
          )
            continue;
          const merged = mergeAdoptedSession(current, host, base.get(entry.id));
          if (!merged) {
            remember(entry.id, host);
            if (adoptedLocalAhead(current, host)) {
              deps.mirrored.set(entry.id, host.revision);
              continue;
            }
            // A genuine divergence of a closed conversation is saved with it, so
            // it shows when opened and is not fetched again at this revision.
            const key = adoptedDivergenceKey(current, host.session);
            if (current.adoptedDivergence?.key === key || answeredByKeep(current, host, key)) {
              deps.mirrored.set(entry.id, host.revision);
              continue;
            }
            const agreed = hostHead(host);
            const flagged = await deps.save(
              {
                ...current,
                adoptedDivergence: { key, ...(agreed ? { hostHead: agreed } : {}) },
              },
              stamp,
            );
            if (flagged !== false) deps.mirrored.set(entry.id, host.revision);
            continue;
          }
          // Another window may have written since: the save then refuses and
          // the next pass starts over from the newer stored copy.
          const saved = await deps.save({ ...merged, continuingElsewhere: undefined }, stamp);
          if (saved === false) continue;
          remember(entry.id, host);
          // Opening during the save may have loaded the previous stored copy.
          // Keep its old baseline/revision so the next pass catches the tab up.
          if (deps.local().some((session) => session.id === entry.id)) continue;
          base.set(entry.id, baselineOf(merged, host));
          deps.mirrored.set(entry.id, host.revision);
          continue;
        }
        // A tab opened after planning the loaded-session fetches. No host
        // transcript was applied to it; leave it eligible for the next pass.
      } catch {
        // Retried on the next pass.
      }
    }
  }
  // Release sessions whose finished turn arrived during this pass.
  deps.onRunning?.(held());
  return running;
}
