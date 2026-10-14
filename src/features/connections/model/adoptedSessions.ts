import type { Session } from "../../sessions/model/session";
import type { HostSession } from "./protocol";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { persistableAttachment } from "../../sessions/model/attachments";

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
  };
}
export const ADOPTED_RUNNING_REASON =
  "This conversation is running in the background on this computer. New messages appear automatically.";
export const ADOPTED_CONFLICT_MESSAGE =
  "Two versions of this conversation were found. Your messages were kept. Sync to load the latest version and save this one separately in project history.";
export const ADOPTED_POLL_VISIBLE_MS = 5_000;
export const ADOPTED_POLL_HIDDEN_MS = 20_000;

export function supportsAdoptedSessions(capabilities: string[] | undefined): boolean {
  return !!capabilities?.includes(ADOPTED_CAPABILITY);
}

/** Entries worth fetching: a loaded, idle local copy whose host revision moved. */
export function planAdoptedFetches(
  entries: readonly AdoptedEntry[],
  local: readonly Session[],
  mirrored: ReadonlyMap<string, number>,
): AdoptedEntry[] {
  const byId = new Map(local.map((session) => [session.id, session]));
  return entries.filter((entry) => {
    const session = byId.get(entry.id);
    return !!session && !session.busy && mirrored.get(entry.id) !== entry.revision;
  });
}

/** The host copy's transcript laid over the local session. Desktop identity
 * (id, cwd, worktree) stays local. A shared baseline permits a host
 * reset/rewind; first contact only permits an identical local prefix. */
function transcript(session: Session): string {
  return canonicalJson(
    session.blocks.map((block) => ({
      ...block,
      image: block.image
        ? (({ data: _data, loadPreview: _load, ...image }) => image)(block.image)
        : undefined,
      // Desktop-only file/preview flags disappear during persistence. They
      // must not make an unchanged message look like a competing local edit.
      attachments: block.attachments?.length
        ? block.attachments.map(persistableAttachment)
        : undefined,
    })),
  );
}

export function mergeAdoptedSession(
  local: Session,
  host: HostSession,
  base?: Session,
): Session | undefined {
  const remote = host.session;
  if (transcript(local) !== transcript(remote)) {
    if (base) {
      // The host may legitimately reset/rewind. Only accept it if the local
      // transcript hasn't changed since our last successful merge.
      if (transcript(local) !== transcript(base)) return undefined;
    } else {
      // On first contact there is no shared ancestor. An identical prefix is
      // safe; block count alone doesn't prove the local text is unchanged.
      if (
        remote.blocks.length < local.blocks.length ||
        transcript(local) !==
          transcript({
            ...remote,
            blocks: remote.blocks.slice(0, local.blocks.length),
          })
      )
        return undefined;
    }
  }
  const fromHost = <K extends keyof Session>(key: K): Session[K] =>
    base && canonicalJson(local[key]) !== canonicalJson(base[key]) ? local[key] : remote[key];
  // Provider configuration and its resume identity move as one unit. A local
  // edit conflicting with a host edit needs an explicit refresh, just like a
  // divergent transcript; never bind a host thread through a retained adapter.
  const provider = (session: Session) =>
    canonicalJson({
      harness: session.harness,
      model: session.model,
      modelSettings: session.modelSettings ?? {},
      providerSessionId: session.providerSessionId,
    });
  const localChanged = !!base && provider(local) !== provider(base);
  if (localChanged && provider(remote) !== provider(base) && provider(remote) !== provider(local))
    return undefined;
  const configuration = localChanged ? local : remote;
  return {
    ...local,
    blocks: remote.blocks,
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
    ...(remote.context ? { context: remote.context } : {}),
    continuingElsewhere: host.status === "running" || undefined,
    retryMessage: host.status === "running" ? remote.retryMessage : undefined,
    adoptedSyncConflict: undefined,
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
  conflict?: (local: Session) => void;
  /** Live status is independent of whether a transcript can be merged. */
  onRunning?: (running: ReadonlySet<string>) => void;
  /** Persist a separate local conversation before resolving a conflict. */
  preserve?: (copy: Session) => Promise<boolean>;
  /** Resolve open-session conflicts automatically after saving a separate copy. */
  autoRefreshConflicts?: boolean;
};

/** Sessions known to have a stored copy, per mirror, so a running one is not
 * read from storage again on every pass. */
const storedHere = new WeakMap<Map<string, number>, Set<string>>();
const baselines = new WeakMap<Map<string, number>, Map<string, Session>>();
/** The last host snapshot received per session, to ask for deltas. Bounded:
 * a snapshot is a whole transcript. */
const snapshots = new WeakMap<Map<string, number>, Map<string, HostSession>>();
export const ADOPTED_SNAPSHOT_LIMIT = 6;

/** An explicit refresh resolves divergence only after preserving the local
 * transcript. It never sends a command to, or stops, the host's running turn. */
export async function refreshAdoptedSession(
  deps: AdoptedMirrorDeps,
  sessionId: string,
): Promise<boolean> {
  const entry = (await deps.list()).find((item) => item.id === sessionId);
  if (!entry) throw new Error("This conversation is no longer available on the host.");
  const before = deps.local().find((session) => session.id === sessionId);
  if (!before || before.busy)
    throw new Error("Wait for the local turn to finish before refreshing.");
  // Always request a full snapshot, including when the revision has not moved.
  const host = await deps.load(sessionId);
  return applyAdoptedSnapshot(deps, before, host);
}

/** Both manual and periodic refresh preserve divergence before replacing it. */
async function applyAdoptedSnapshot(
  deps: AdoptedMirrorDeps,
  before: Session,
  host: HostSession,
): Promise<boolean> {
  const sessionId = before.id;
  const beforeTranscript = transcript(before);
  const unchanged = () => {
    const current = deps.local().find((session) => session.id === sessionId);
    if (!current || current.busy || current !== before || transcript(current) !== beforeTranscript)
      throw new Error("The local conversation changed while refreshing. Try again.");
    return current;
  };
  unchanged();
  const base = baselines.get(deps.mirrored)?.get(sessionId);
  let merged = mergeAdoptedSession(before, host, base);
  const preserved = !merged;
  if (!merged) {
    const copy: Session = {
      id: crypto.randomUUID(),
      harness: before.harness,
      model: before.model,
      modelSettings: { ...before.modelSettings },
      runtimeMode: before.runtimeMode,
      title: `${before.title || "Session"} (local copy)`,
      cwd: before.cwd,
      worktreeCwd: before.worktreeCwd,
      worktreeRemoved: before.worktreeRemoved,
      branch: before.branch,
      providerAccountId: before.providerAccountId,
      blocks: before.blocks,
    };
    // No provider conversation id, automation or queued sends on the saved copy.
    const saved = await deps.preserve?.(copy).catch(() => false);
    if (!saved)
      throw new Error("Could not save the local copy. Your conversation was kept. Try again.");
    unchanged();
    merged = mergeAdoptedSession(before, host, before)!;
  }
  deps.apply(merged, before);
  let bases = baselines.get(deps.mirrored);
  if (!bases) baselines.set(deps.mirrored, (bases = new Map()));
  bases.set(sessionId, merged);
  // Drop any older delta base; the next automatic pass starts from a full copy.
  snapshots.get(deps.mirrored)?.delete(sessionId);
  deps.mirrored.set(sessionId, host.revision);
  return preserved;
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
  deps.onRunning?.(running);
  for (const entry of planAdoptedFetches(entries, deps.local(), deps.mirrored)) {
    try {
      const before = deps.local().find((session) => session.id === entry.id);
      const host = await deps.load(entry.id, known.get(entry.id));
      // A local turn may have started while the snapshot was in flight.
      const current = deps.local().find((session) => session.id === entry.id);
      if (!current || current.busy) continue;
      if (before && transcript(before) !== transcript(current)) {
        deps.conflict?.(current);
        continue;
      }
      const merged = mergeAdoptedSession(current, host, base.get(entry.id));
      if (!merged) {
        // Not mirrored, but the host copy itself arrived: the next pass only
        // needs what changed after it.
        remember(entry.id, host);
        if (deps.autoRefreshConflicts) {
          try {
            await applyAdoptedSnapshot(deps, current, host);
            continue;
          } catch {
            // A failed backup or a concurrent local edit leaves the copy intact.
            // Keep the manual action available and retry on the next poll.
          }
        }
        deps.conflict?.(current);
        continue;
      }
      deps.apply(merged, current);
      remember(entry.id, host);
      base.set(entry.id, merged);
      deps.mirrored.set(entry.id, host.revision);
    } catch {
      // Retried on the next pass.
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
            deps.conflict?.(current);
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
          base.set(entry.id, merged);
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
  // Sessions already mirrored at this revision still need the hold flag.
  return running;
}
