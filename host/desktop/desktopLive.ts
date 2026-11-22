import { createHash, randomUUID } from "node:crypto";
import { dedicatedWorktreeVerifier } from "./headless-worktree";
import { requestedByName, type DesktopCommand } from "./desktopCommand";
import type { PreparedDesktop } from "../domains/commands/service";
export type { PreparedDesktop } from "../domains/commands/service";
import { isApprovalOccurrenceId } from "../../src/shared/model/approvalOccurrence";
import { WIRE_IDENTIFIER_PATTERN } from "../../src/shared/model/host-contracts/schemas";
import { parseSessionLayout } from "../sessions/session-layout";
import {
  MAX_DIRECTORY_LOGO_LENGTH,
  parseProjectAppearance,
  projectIdentityColor,
} from "../../src/features/connections/model/projectAppearance";
import type { Block, Session } from "../../src/features/sessions/model/session";
import type {
  DesktopConcealedGroups,
  DesktopProjectDirectory,
  HostCommand,
  HostProject,
  HostProjectDirectory,
} from "../../src/features/connections/model/protocol";
import { canonicalHostPath, hostProjectId } from "../../src/features/sync/model/syncProjectId";
import { RUN_LEASE_TTL_MS } from "../../src/features/sync/model/runLease";
import { AwakeClock } from "../../src/shared/lib/time/awakeClock";
import { createDedupedWarn } from "../diagnostics/log-dedupe";
import { createLogger } from "../diagnostics/logger";
import {
  DesktopGroupLock,
  NO_GROUP_ACCESS,
  type GroupAccess,
} from "../group-lock/desktop-group-lock";

const log = createLogger("host.desktop.live");

/** Past this without a heartbeat, the desktop app is gone (closed or crashed)
 * and none of its sessions is running. */
export const DESKTOP_BEAT_STALE_MS = 20_000;
/**
 * A desktop silent this long no longer blocks a clean, non-forced worktree removal on an
 * unattended Host (it may only be reconnecting before that). See `withRemovalLease`.
 */
export const DESKTOP_UNATTENDED_GRACE_MS = 2 * 60_000;
const MAX_PENDING_BLOCKS = 50;
const MAX_COMMANDS = 100;
const MAX_COMMAND_RECEIPTS = 500;
export const DESKTOP_COMMAND_RETAIN_MS = 5 * 60_000;
export const DESKTOP_WRITER_TRANSFER_MS = 12_000;
/** A client silent this long no longer owns any writer. */
export const DESKTOP_WRITER_STALE_MS = 60_000;
/**
 * How long the desktop database's in-flight mark is believed from an app that
 * never sent a heartbeat. A crashed app leaves the mark behind for good; without
 * an end the host would never send a queued message of that conversation.
 */
export const DESKTOP_STORED_RUNNING_MS = 75_000;
/** A window silent after reporting a session busy still runs it this long: its run lease's life. */
export const DESKTOP_SILENT_BUSY_MS = RUN_LEASE_TTL_MS;
/** Attended removal requires every desktop grant to confirm it checked open editors. */
export const REQUIRE_DESKTOP_EDITOR_CHECK = true;
const EDITORS_REFUSED =
  "Save or close unsaved files under this worktree in the desktop before removing it.";
const DESKTOP_UPDATE_REQUIRED = "Update the desktop app to remove worktrees from this Host.";

/** What one desktop answered to a removal-lease request. */
type RemovalLeaseResult = { granted: boolean; checks: string[]; reason?: string };

export type { DesktopCommand };

type LiveSession = {
  clientId: string;
  /** Identity of this live overlay, distinct from its changing contents. */
  sourceEpoch: string;
  pageToken?: string;
  turnReceipt?: { version: 1; sessionId: string; turnId: string };
  busy: boolean;
  pending: Block[];
  patch: Partial<Session>;
  /** When running state or prompts last changed: part of the watchers' revision. */
  changedAt: number;
  fingerprint: string;
};

function directoryPathKey(path: string): string {
  const key = canonicalHostPath(path);
  return key.startsWith("//") ? key.toLowerCase() : key;
}

/** Invalid privacy metadata cannot make previously protected folders visible. */
export function parseDesktopProjectDirectory(input: unknown): DesktopProjectDirectory | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.excludedPaths) ||
    !Array.isArray(value.excludedGroupIds)
  )
    return;
  const text = (value: unknown, max: number): value is string =>
    typeof value === "string" && !!value.trim() && value.length <= max && !value.includes("\0");
  if (
    value.projects.length > 10000 ||
    value.groups.length > 10000 ||
    value.excludedPaths.length > 10000 ||
    value.excludedGroupIds.length > 10000
  )
    return;
  if (
    !value.excludedPaths.every((path) => text(path, 4096)) ||
    !value.excludedGroupIds.every((id) => text(id, 200))
  )
    return;
  const groups: DesktopProjectDirectory["groups"] = [];
  let logoBudget = MAX_DIRECTORY_LOGO_LENGTH;
  const readAppearance = (input: unknown) => {
    const appearance = parseProjectAppearance(input);
    if (appearance?.logo) {
      if (appearance.logo.length > logoBudget) delete appearance.logo;
      else logoBudget -= appearance.logo.length;
    }
    return appearance;
  };
  const ids = new Set<string>();
  for (const raw of value.groups) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const group = raw as Record<string, unknown>;
    if (!text(group.id, 200) || !text(group.name, 1000) || ids.has(group.id)) return;
    ids.add(group.id);
    const color = projectIdentityColor(group.color);
    const appearance = readAppearance(group.appearance);
    groups.push({
      id: group.id,
      name: group.name,
      ...(color ? { color } : {}),
      ...(appearance ? { appearance } : {}),
      ...(typeof group.collapsed === "boolean" ? { collapsed: group.collapsed } : {}),
    });
  }
  const projects: DesktopProjectDirectory["projects"] = [];
  for (const raw of value.projects) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const project = raw as Record<string, unknown>;
    if (
      !text(project.cwd, 4096) ||
      !text(project.name, 1000) ||
      project.cwd.startsWith("remote://")
    )
      return;
    if (project.groupId !== undefined && (!text(project.groupId, 200) || !ids.has(project.groupId)))
      return;
    if (project.pinned !== undefined && typeof project.pinned !== "boolean") return;
    const sessionLayout = parseSessionLayout(project.sessionLayout);
    const appearance = readAppearance(project.appearance);
    projects.push({
      cwd: project.cwd,
      name: project.name,
      ...(typeof project.groupId === "string" ? { groupId: project.groupId } : {}),
      ...(sessionLayout ? { sessionLayout } : {}),
      ...(appearance ? { appearance } : {}),
      ...(project.pinned === true ? { pinned: true } : {}),
    });
  }
  const concealed = parseConcealedGroups(value.concealed);
  return {
    version: 1,
    groups,
    projects,
    excludedPaths: value.excludedPaths,
    excludedGroupIds: value.excludedGroupIds,
    ...(concealed ? { concealed } : {}),
  };
}

/** Malformed concealed data is dropped whole: nothing is revealed from a doubtful snapshot. */
function parseConcealedGroups(input: unknown): DesktopConcealedGroups | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const raw = input as { locked?: unknown; hidden?: unknown };
  if (!Array.isArray(raw.locked) || !Array.isArray(raw.hidden)) return;
  if (raw.locked.length > 10000 || raw.hidden.length > 10000) return;
  const parents = new Map<string, string>();
  const groups: unknown[] = [];
  const projects: unknown[] = [];
  for (const entry of raw.locked) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const { parentId, projects: rows, ...group } = entry as Record<string, unknown>;
    if (!Array.isArray(rows) || typeof group.id !== "string") return;
    if (typeof parentId === "string" && parentId.length <= 200) parents.set(group.id, parentId);
    groups.push(group);
    for (const row of rows)
      projects.push(row && typeof row === "object" ? { ...row, groupId: group.id } : row);
  }
  // The same validation as the visible directory: ids, paths, appearance and budgets.
  const parsed = parseDesktopProjectDirectory({
    version: 1,
    projects,
    groups,
    excludedPaths: [],
    excludedGroupIds: [],
  });
  if (!parsed) return;
  const hidden: DesktopConcealedGroups["hidden"] = [];
  for (const entry of raw.hidden) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const group = entry as Record<string, unknown>;
    if (
      typeof group.id !== "string" ||
      !group.id.trim() ||
      group.id.length > 200 ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      group.name.length > 1000
    )
      return;
    const color = projectIdentityColor(group.color);
    hidden.push({ id: group.id, name: group.name, ...(color ? { color } : {}) });
  }
  return {
    locked: parsed.groups.map((group) => ({
      ...group,
      ...(parents.has(group.id) ? { parentId: parents.get(group.id)! } : {}),
      projects: parsed.projects.filter((project) => project.groupId === group.id),
    })),
    hidden,
  };
}

/**
 * What the desktop app on this machine reports about its running sessions,
 * and the commands watchers on other computers left for it. The desktop
 * calls in (`sessions.desktopLive`); the host can't reach it otherwise.
 */
export class DesktopLive {
  private removalPages = new Map<string, string | undefined>();
  get headlessRemovalConfigured(): boolean {
    return !!this.verifyHeadless && !this.removalPages.size;
  }
  private removalJobs = new Map<
    string,
    {
      id: string;
      clientId: string;
      pageToken?: string;
      path?: string;
      until: number;
      reply?: (result: RemovalLeaseResult) => void;
    }
  >();

  removalLeaseBeat(input: Record<string, unknown>) {
    const clientId = input.clientId;
    const now = Date.now();
    const replies = Array.isArray(input.removalLeaseReplies)
      ? input.removalLeaseReplies
          .slice(0, 100)
          .filter((entry) => typeof entry?.id === "string" && entry.id.length <= 36)
      : [];
    const acked = replies
      .map((entry) => entry.id as string)
      .filter(
        (id) =>
          this.removalJobs.has(JSON.stringify([id, clientId])) ||
          ![...this.removalJobs.values()].some((job) => job.id === id),
      );
    const jobs: { id: string; clientId: string; path?: string }[] = [];
    for (const [key, job] of this.removalJobs) {
      const { id } = job;
      if (job.until <= now) {
        this.removalJobs.delete(key);
        continue;
      }
      if (job.clientId !== clientId || (job.path && job.pageToken !== input.pageToken)) continue;
      const result = replies.find((entry) => entry.id === id && entry.release === !job.path);
      if (result) {
        job.reply?.({
          granted: result.granted === true,
          // Extra fields are optional: an older desktop sends neither.
          checks: Array.isArray(result.checks)
            ? result.checks.filter((check: unknown): check is string => typeof check === "string")
            : [],
          ...(typeof result.reason === "string" ? { reason: result.reason.slice(0, 40) } : {}),
        });
        if (!job.path) this.removalJobs.delete(key);
      } else if (!job.path || job.reply) {
        jobs.push({ id, clientId: job.clientId, path: job.path });
      }
    }
    return { jobs, acked };
  }

  async withRemovalLease<T>(
    id: string,
    path: string,
    run: (assertLease: () => void) => Promise<T>,
    project?: () => Promise<string>,
    options?: { unattended?: boolean },
  ): Promise<T> {
    const clients = [...this.removalPages.keys()];
    const pages = new Map(clients.map((client) => [client, this.removalPages.get(client)]));
    const unavailable =
      "Cannot verify native terminal usage. Reconnect the execution Host desktop and retry.";
    if (!clients.length && this.verifyHeadless && project) {
      await this.verifyHeadless(path, await project());
      const assertDedicated = () => {
        if (this.removalPages.size) throw new Error(unavailable);
      };
      assertDedicated();
      return run(assertDedicated);
    }
    // Unattended Host (policy, following T3 Code): no desktop is alive and none was seen within
    // the grace period, so nobody can hold native terminals here. Only a caller that proved a
    // non-forced, clean removal opts in; Git's own non-forced refusal stays the backstop. A
    // desktop that appears during the removal revokes it through the assert callback.
    if (options?.unattended && this.noDesktopWithinGrace(clients)) {
      const assertUnattended = () => {
        if ([...this.removalPages.keys()].some((client) => this.clientAlive(client)))
          throw new Error(unavailable);
      };
      assertUnattended();
      return run(assertUnattended);
    }
    if (!clients.length || clients.some((client) => !this.clientAlive(client)))
      throw new Error(unavailable);
    if (clients.includes("legacy")) throw new Error(unavailable);
    const startedAt = performance.now();
    const until = Date.now() + 15_000;
    try {
      const results = await Promise.all(
        clients.map(
          (clientId) =>
            new Promise<RemovalLeaseResult>((resolve) => {
              const key = JSON.stringify([id, clientId]);
              const pageToken = pages.get(clientId);
              const timeout = setTimeout(() => resolve({ granted: false, checks: [] }), 15_000);
              const job = {
                id,
                clientId,
                pageToken,
                path,
                until,
                reply: (result: RemovalLeaseResult) => {
                  clearTimeout(timeout);
                  this.removalJobs.set(key, { id, clientId, pageToken, path, until });
                  resolve(result);
                },
              };
              this.removalJobs.set(key, job);
            }),
        ),
      );
      if (performance.now() - startedAt >= 15_000) throw new Error(unavailable);
      if (results.some((result) => !result.granted && result.reason === "editors"))
        throw new Error(EDITORS_REFUSED);
      if (!results.every((result) => result.granted)) throw new Error(unavailable);
      if (this.requireEditorChecks && !results.every((result) => result.checks.includes("editors")))
        throw new Error(DESKTOP_UPDATE_REQUIRED);
      const assertLease = () => {
        // Leave 150 seconds for a started mutation to finish within the native TTL.
        if (
          performance.now() - startedAt >= 450_000 ||
          clients.some(
            (client) =>
              !this.clientAlive(client) || pages.get(client) !== this.removalPages.get(client),
          ) ||
          this.removalPages.size !== clients.length
        )
          throw new Error(unavailable);
      };
      assertLease();
      return await run(assertLease);
    } finally {
      for (const clientId of clients)
        this.removalJobs.set(JSON.stringify([id, clientId]), {
          id,
          clientId,
          until: Date.now() + 600_000,
        });
    }
  }

  private clients = new Map<string, number>();
  /** A desktop connected before a Host restart reconnects within seconds: the grace runs from start too. */
  private startedAwake: number;
  /** Last beat per desktop client; unlike `clients` it survives stale expiry, for the unattended grace. */
  private removalSeen = new Map<string, number>();
  private noDesktopWithinGrace(clients: readonly string[]): boolean {
    return (
      this.awake() - this.startedAwake > DESKTOP_UNATTENDED_GRACE_MS &&
      clients.every(
        (client) =>
          !this.clientAlive(client) &&
          this.awake() - (this.removalSeen.get(client) ?? Number.NEGATIVE_INFINITY) >
            DESKTOP_UNATTENDED_GRACE_MS,
      )
    );
  }
  private sessions = new Map<string, LiveSession>();
  private commands: (DesktopCommand & { queuedAt: number })[] = [];
  private readonly durablePending = new Map<string, PreparedDesktop>();
  private readonly durableOffered = new Map<string, PreparedDesktop>();
  // Bounded acceptance fingerprints, not provider-completion or durable receipts.
  private commandReceipts = new Map<string, { signature: string; acceptedAt: number }>();
  private writerClients = new Map<string, { sessions: Set<string>; at: number }>();
  private writerTransfers = new Map<
    string,
    { clientId: string; sessionId: string; finish: (error?: string) => void }
  >();
  private directories = new Map<
    string,
    { at: number; value?: DesktopProjectDirectory; revision?: string }
  >();

  private lastChange = 0;

  onChange?: (sessionIds: string[]) => void;
  onSourceChange?: (sessionIds: string[]) => void;
  /** A window's project directory projection changed or its window stopped answering. */
  onDirectoryChange?: () => void;
  onRemovalHeartbeat?: () => void;
  /** A window reported a conversation busy (each beat while it runs). */
  onBusy?: (sessionId: string, clientId: string) => void;
  /** A conversation a window ran is no longer busy there (`idle`), or the window stopped answering (`gone`). */
  onIdle?: (sessionId: string, clientId: string, reason?: "idle" | "gone") => void;
  /** When the in-flight mark of a session was first seen while no app had beat. */
  private storedSince = new Map<string, number>();
  /** The window that last reported each session busy, and when; cleared only by its idle report. */
  private lastBusyBeat = new Map<string, { clientId: string; at: number }>();
  /**
   * One line per session for the life of this Host process. The stale mark stays in the
   * desktop database, so every later read finds it again and a new belief window expires.
   */
  private readonly warnExpiredStored = createDedupedWarn({
    windowMs: Number.POSITIVE_INFINITY,
    maxKeys: 4096,
    write: (sessionId) =>
      log.warn(
        "desktop session still carries an in-flight mark with no desktop heartbeat; treating it as not running",
        { sessionId },
      ),
  });
  /** Remote unlock requests for the desktop renderer, and the grants phones earned. */
  readonly groupLock: DesktopGroupLock;
  /**
   * Window liveness (heartbeats, directory snapshots, writers, silent busy marks) is measured on
   * this clock, which skips the time the Host machine slept: after waking, no window is stale
   * just because the whole machine was suspended, and a window that really went quiet still
   * expires one window length after. Revisions and command retention stay on the wall clock.
   */
  private readonly clock: AwakeClock;
  /**
   * `watchSuspension` starts the clock's own sampling with the first heartbeat. It defaults on only
   * for the real wall clock: a test clock is moved by hand and would read as one long sleep.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly watchSuspension: boolean = now === Date.now,
    private readonly verifyHeadless = dedicatedWorktreeVerifier(),
    private readonly requireEditorChecks: boolean = REQUIRE_DESKTOP_EDITOR_CHECK,
  ) {
    this.clock = new AwakeClock(now);
    this.startedAwake = this.clock.now();
    this.groupLock = new DesktopGroupLock(now);
    // A grant given or ended changes what a phone sees of the directory.
    this.groupLock.onChange = () => this.onDirectoryChange?.();
  }

  /** Only running state, including heartbeat/stored-mark expiry, influences
   * list metadata. Prompt text changes must not reread SQLite list rows. */
  listVersion(ids: readonly string[], stored: readonly boolean[]): string {
    let states = "";
    for (let index = 0; index < ids.length; index++)
      states += this.running(ids[index], stored[index]) ? "1" : "0";
    return states;
  }

  /** Liveness time: wall time without the spans the Host machine slept. */
  private awake(): number {
    return this.clock.now();
  }

  private reclaimCommands(): void {
    const now = this.now();
    const awake = this.awake();
    this.commands = this.commands.filter((command) => {
      const owner = this.sessions.get(command.sessionId)?.clientId;
      const heartbeat = owner ? this.clients.get(owner) : undefined;
      return (
        (heartbeat !== undefined && awake - heartbeat <= DESKTOP_BEAT_STALE_MS) ||
        now - command.queuedAt < DESKTOP_COMMAND_RETAIN_MS
      );
    });
    const pending = new Set(this.commands.map((command) => command.id));
    for (const [id, receipt] of this.commandReceipts)
      if (!pending.has(id) && now - receipt.acceptedAt >= DESKTOP_COMMAND_RETAIN_MS)
        this.commandReceipts.delete(id);
  }

  /** Strictly increasing, so two changes in one millisecond still differ. */
  private changeStamp(): number {
    this.lastChange = Math.max(this.now(), this.lastChange + 1);
    return this.lastChange;
  }

  beat(input: unknown): {
    commands: DesktopCommand[];
    projectDirectoryRevision?: string;
    groupLock: ReturnType<DesktopGroupLock["beat"]>;
    removalLease: ReturnType<DesktopLive["removalLeaseBeat"]>;
  } {
    const value =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    if (!Array.isArray(value.sessions)) throw new Error("Invalid desktop sessions");
    if (this.watchSuspension) this.clock.start();
    const clientId =
      typeof value.clientId === "string" && value.clientId ? value.clientId : "legacy";
    const pageToken =
      typeof value.pageToken === "string" && /^[0-9a-f-]{36}$/i.test(value.pageToken)
        ? value.pageToken
        : undefined;
    const revision =
      typeof value.projectDirectoryRevision === "string" &&
      value.projectDirectoryRevision.length > 0 &&
      value.projectDirectoryRevision.length <= 64
        ? value.projectDirectoryRevision
        : undefined;
    let directoryChanged = false;
    if (Object.hasOwn(value, "projectDirectory")) {
      const projection = parseDesktopProjectDirectory(value.projectDirectory);
      directoryChanged =
        JSON.stringify(this.directories.get(clientId)?.value) !== JSON.stringify(projection);
      this.directories.set(clientId, {
        at: this.awake(),
        value: projection,
        revision: projection ? revision : undefined,
      });
    } else if (revision) {
      const previous = this.directories.get(clientId);
      if (previous?.value && previous.revision === revision) previous.at = this.awake();
    }
    const acked = new Set(Array.isArray(value.acked) ? value.acked.map(String) : []);
    const writers = value.writers as { version?: number; sessionIds?: unknown } | undefined;
    if (writers?.version === 1 && Array.isArray(writers.sessionIds))
      this.writerClients.set(clientId, {
        sessions: new Set(writers.sessionIds.filter((id): id is string => typeof id === "string")),
        at: this.awake(),
      });
    else {
      const known = this.writerClients.get(clientId);
      if (known) known.at = this.awake();
    }
    this.pruneWriterClients();
    for (const id of acked) {
      const transfer = this.writerTransfers.get(id);
      if (transfer?.clientId === clientId)
        transfer.finish(
          this.writerClients.get(clientId)?.sessions.has(transfer.sessionId)
            ? "The desktop still owns the provider writer. Retry after it finishes."
            : undefined,
        );
    }
    const next = new Map(this.sessions);
    const reported = new Set<string>();
    for (const raw of value.sessions) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.id !== "string" || !entry.id) continue;
      const turn = entry.turnReceipt as
        | { version?: unknown; sessionId?: unknown; turnId?: unknown }
        | undefined;
      const turnReceipt =
        turn?.version === 1 &&
        turn.sessionId === entry.id &&
        typeof turn.turnId === "string" &&
        /^[0-9a-f-]{36}$/i.test(turn.turnId)
          ? { version: 1 as const, sessionId: entry.id, turnId: turn.turnId }
          : undefined;
      const owner = this.sessions.get(entry.id);
      // Another live window owns this turn. An idle copy of its tab cannot
      // take over command delivery; a crashed owner can be replaced.
      if (
        owner &&
        owner.clientId !== clientId &&
        (owner.busy || owner.fingerprint !== "[[],{}]") &&
        this.clientAlive(owner.clientId)
      )
        continue;
      reported.add(entry.id);
      const pending = Array.isArray(entry.pending)
        ? (entry.pending as Block[])
            .filter((block) => block && typeof block.id === "string")
            .slice(0, MAX_PENDING_BLOCKS)
        : [];
      const patch =
        entry.patch && typeof entry.patch === "object" && !Array.isArray(entry.patch)
          ? livePatch(entry.patch as Partial<Session>)
          : {};
      const fingerprint = JSON.stringify([pending, patch]);
      const previous = this.sessions.get(entry.id);
      if (entry.busy === true) {
        this.noteBusyBeat(entry.id, clientId);
        this.onBusy?.(entry.id, clientId);
      } else {
        this.clearBusyBeat(entry.id, clientId);
        if (previous?.busy && previous.clientId === clientId) this.onIdle?.(entry.id, clientId);
      }
      next.set(entry.id, {
        clientId,
        sourceEpoch:
          previous?.clientId === clientId &&
          this.clientAlive(clientId) &&
          previous.pageToken === pageToken &&
          previous.busy === (entry.busy === true)
            ? previous.sourceEpoch
            : randomUUID(),
        pageToken,
        turnReceipt,
        busy: entry.busy === true,
        pending,
        patch,
        fingerprint,
        changedAt:
          previous &&
          previous.fingerprint === fingerprint &&
          previous.busy === (entry.busy === true)
            ? previous.changedAt
            : this.changeStamp(),
      });
    }
    // A session that just went idle changed too: its prompt is gone.
    for (const [id, previous] of this.sessions)
      if (
        previous.clientId === clientId &&
        !reported.has(id) &&
        (previous.busy || previous.fingerprint !== "[[],{}]")
      ) {
        this.clearBusyBeat(id, clientId);
        if (previous.busy) this.onIdle?.(id, clientId);
        next.set(id, {
          clientId,
          sourceEpoch: randomUUID(),
          busy: false,
          pending: [],
          patch: {},
          fingerprint: "[[],{}]",
          changedAt: this.changeStamp(),
        });
      }
    // Omitted idle tombstones own no work. Keep one transition beat so observers
    // see busy/pending become idle, then drop only the exact still-empty record.
    const heldSessions = new Set([
      ...this.commands.map((command) => command.sessionId),
      ...[...this.durablePending.values()].map((command) => command.sessionId),
      ...[...this.durableOffered.values()].map((command) => command.sessionId),
      ...[...this.writerTransfers.values()].map((transfer) => transfer.sessionId),
    ]);
    for (const [id, previous] of this.sessions) {
      if (
        previous.clientId === clientId &&
        !reported.has(id) &&
        !previous.busy &&
        previous.fingerprint === "[[],{}]" &&
        next.get(id) === previous &&
        !heldSessions.has(id)
      )
        next.delete(id);
    }
    const changedIds = new Set<string>();
    const sourceChangedIds = new Set<string>();
    for (const [id, value] of next)
      if (this.sessions.get(id)?.sourceEpoch !== value.sourceEpoch) sourceChangedIds.add(id);
    for (const id of this.sessions.keys()) if (!next.has(id)) sourceChangedIds.add(id);
    for (const [id, value] of next)
      if (this.sessions.get(id)?.changedAt !== value.changedAt) changedIds.add(id);
    for (const id of this.sessions.keys()) if (!next.has(id)) changedIds.add(id);
    this.sessions = next;
    // ACKs are scoped to the owner too, including retries sent by old clients.
    this.commands = this.commands.filter(
      (command) =>
        !acked.has(command.id) || this.sessions.get(command.sessionId)?.clientId !== clientId,
    );
    this.clients.set(clientId, this.awake());
    this.removalPages.set(clientId, pageToken);
    this.removalSeen.set(clientId, this.awake());
    this.storedSince.clear();
    for (const [id, beatAt] of this.clients) {
      if (this.awake() - beatAt <= DESKTOP_BEAT_STALE_MS) continue;
      this.clients.delete(id);
      // Heartbeat expiry is not proof that native PTYs have exited.
      if (this.directories.delete(id)) directoryChanged = true;
      for (const [sessionId, session] of this.sessions)
        if (session.clientId === id) {
          this.sessions.delete(sessionId);
          if (session.busy) this.onIdle?.(sessionId, id, "gone");
          changedIds.add(sessionId);
          sourceChangedIds.add(sessionId);
        }
    }
    // Watchers must read the committed sessions and heartbeat, including on the
    // first beat. Signalling earlier can expose the previous running state.
    this.reclaimCommands();
    if (sourceChangedIds.size) this.onSourceChange?.([...sourceChangedIds]);
    if (changedIds.size) this.onChange?.([...changedIds]);
    if (directoryChanged) this.onDirectoryChange?.();
    this.onRemovalHeartbeat?.();
    return {
      groupLock: this.groupLock.beat(clientId, value.groupLock),
      removalLease: this.removalLeaseBeat(value),
      ...(revision && this.directories.get(clientId)?.revision === revision
        ? { projectDirectoryRevision: revision }
        : {}),
      commands: this.commands
        .filter((command) => this.sessions.get(command.sessionId)?.clientId === clientId)
        .map(({ queuedAt: _queuedAt, ...command }) => command)
        .concat(
          [...this.writerTransfers]
            .filter(([, transfer]) => transfer.clientId === clientId)
            .map(([id, transfer]) => ({
              id,
              sessionId: transfer.sessionId,
              type: "retire-writer" as const,
            })),
        ),
    };
  }

  /**
   * Which desktop snapshots `projectDirectory` still counts. It moves when a snapshot crosses
   * the stale threshold, the one directory change no beat or commit announces.
   */
  freshDirectoryClients(): string {
    return JSON.stringify(
      [...this.directories]
        .filter(([, snapshot]) => this.awake() - snapshot.at <= DESKTOP_BEAT_STALE_MS)
        .map(([clientId]) => clientId)
        .sort(),
    );
  }

  /** Never substitute raw sync records when a desktop privacy snapshot is absent. */
  projectDirectory(
    registered: readonly HostProject[],
    environmentId: string,
    /** What the calling phone earned; without it only open groups show, as for any caller. */
    access: GroupAccess = NO_GROUP_ACCESS,
  ): HostProjectDirectory {
    const snapshots = [...this.directories.values()]
      .filter((snapshot) => this.awake() - snapshot.at <= DESKTOP_BEAT_STALE_MS)
      .sort((a, b) => b.at - a.at);
    if (!snapshots.length || snapshots.some((snapshot) => !snapshot.value))
      return { version: 1, privacyReady: false, groups: [], projects: [] };
    const valid = snapshots.map((snapshot) => snapshot.value!);
    const excludedGroups = new Set(valid.flatMap((snapshot) => snapshot.excludedGroupIds));
    const excludedPaths = new Set(
      valid.flatMap((snapshot) => snapshot.excludedPaths.map(directoryPathKey)),
    );
    for (const snapshot of valid)
      for (const project of snapshot.projects)
        if (project.groupId && excludedGroups.has(project.groupId))
          excludedPaths.add(directoryPathKey(project.cwd));
    const groups = new Map<string, DesktopProjectDirectory["groups"][number]>();
    const paths = new Map<string, DesktopProjectDirectory["projects"][number]>();
    for (const snapshot of valid) {
      for (const group of snapshot.groups)
        if (!excludedGroups.has(group.id) && !groups.has(group.id)) groups.set(group.id, group);
      for (const project of snapshot.projects) {
        const key = directoryPathKey(project.cwd);
        if (excludedPaths.has(key) || (project.groupId && excludedGroups.has(project.groupId)))
          continue;
        if (!paths.has(key)) paths.set(key, project);
      }
    }
    const concealed = this.concealedView(valid, excludedGroups, access);
    for (const group of concealed.opened) groups.set(group.id, group);
    for (const project of concealed.projects) {
      const key = directoryPathKey(project.cwd);
      if (!paths.has(key)) paths.set(key, project);
    }
    const projects: HostProjectDirectory["projects"] = [];
    const registeredByPath = new Map<string, HostProject[]>();
    for (const project of registered) {
      const key = directoryPathKey(project.cwd);
      registeredByPath.set(key, [...(registeredByPath.get(key) ?? []), project]);
    }
    // The desktop projection owns visibility and order; historical host records
    // must not resurrect projects removed or archived from the desktop rail.
    for (const [key, projection] of paths) {
      const matches = registeredByPath.get(key) ?? [];
      if (matches.length) {
        // One entry per folder: legacy rows spelling the same path differently stay in
        // the store (their sessions reference them) but are not listed twice. Prefer the
        // row spelled exactly like the desktop, then the lowest id; the session list
        // merges the other rows' sessions into the listed one.
        const project = [...matches].sort(
          (a, b) =>
            Number(b.cwd === projection.cwd) - Number(a.cwd === projection.cwd) ||
            a.id.localeCompare(b.id),
        )[0];
        // Sessions of the folded rows still carry their own id; phones accept them through this list.
        const aliasIds = matches.filter((row) => row.id !== project.id).map((row) => row.id);
        projects.push({
          ...project,
          ...projection,
          cwd: project.cwd,
          registered: true,
          ...(aliasIds.length ? { aliasIds } : {}),
        });
      } else
        projects.push({
          ...projection,
          id: hostProjectId(environmentId, projection.cwd),
          registered: false,
        });
    }
    return {
      version: 1,
      privacyReady: true,
      groups: [...groups.values()],
      projects,
      ...(concealed.locked.length ? { lockedGroups: concealed.locked } : {}),
      ...(access.hiddenList ? { hiddenGroups: concealed.hidden } : {}),
    };
  }

  /**
   * Locked groups by name, opened where this device holds a grant (a nested group is
   * reachable only through an open parent), and hidden group names for a device that
   * passed the hidden-list password. Hidden groups never reveal their projects.
   */
  private concealedView(
    snapshots: readonly DesktopProjectDirectory[],
    excludedGroups: ReadonlySet<string>,
    access: GroupAccess,
  ) {
    const locked = new Map<string, DesktopConcealedGroups["locked"][number]>();
    const hidden = new Map<string, DesktopConcealedGroups["hidden"][number]>();
    for (const snapshot of snapshots) {
      for (const group of snapshot.concealed?.locked ?? [])
        if (excludedGroups.has(group.id) && !locked.has(group.id)) locked.set(group.id, group);
      for (const group of snapshot.concealed?.hidden ?? [])
        if (excludedGroups.has(group.id) && !hidden.has(group.id)) hidden.set(group.id, group);
    }
    const reachable = (group: DesktopConcealedGroups["locked"][number], depth = 0): boolean => {
      const parent = group.parentId ? locked.get(group.parentId) : undefined;
      if (!parent) return true;
      return depth < 32 && access.groupIds.has(parent.id) && reachable(parent, depth + 1);
    };
    const stubs: NonNullable<HostProjectDirectory["lockedGroups"]> = [];
    const opened: DesktopProjectDirectory["groups"] = [];
    const projects: DesktopProjectDirectory["projects"] = [];
    for (const entry of locked.values()) {
      if (!reachable(entry)) continue;
      const { parentId: _parentId, projects: rows, ...group } = entry;
      if (access.groupIds.has(entry.id)) {
        opened.push(group);
        projects.push(...rows);
      } else
        stubs.push({
          id: group.id,
          name: group.name,
          ...(group.color ? { color: group.color } : {}),
          ...(group.appearance ? { appearance: group.appearance } : {}),
        });
    }
    return { locked: stubs, opened, projects, hidden: [...hidden.values()] };
  }

  private clientAlive(clientId: string): boolean {
    const beatAt = this.clients.get(clientId);
    return beatAt !== undefined && this.awake() - beatAt <= DESKTOP_BEAT_STALE_MS;
  }

  /** Whether the desktop reports itself alive; undefined if it never has
   * (an older app: fall back to what its database says). */
  alive(): boolean | undefined {
    if (this.clients.size === 0) return undefined;
    return [...this.clients.keys()].some((id) => this.clientAlive(id));
  }

  /** Running per the heartbeat; `stored` is the database's in-flight mark,
   * only trusted from an app that doesn't send heartbeats. */
  running(id: string, stored: boolean): boolean {
    const alive = this.alive();
    if (alive === undefined) {
      if (!stored) {
        this.storedSince.delete(id);
        return false;
      }
      // No app has beat since this host started: the mark is all there is. It is
      // believed for a while; a crashed app leaves it behind for good.
      const since = this.storedSince.get(id) ?? this.awake();
      this.storedSince.set(id, since);
      while (this.storedSince.size > 512)
        this.storedSince.delete(this.storedSince.keys().next().value!);
      if (this.awake() - since < DESKTOP_STORED_RUNNING_MS) return true;
      this.warnExpiredStored(id);
      return false;
    }
    const session = this.sessions.get(id);
    return alive && !!session?.busy && this.clientAlive(session.clientId);
  }

  /** When the earliest in-flight mark believed without a heartbeat stops counting, so the host looks again then. */
  nextStoredExpiry(): number | undefined {
    if (this.alive() !== undefined) return undefined;
    let earliest: number | undefined;
    const awake = this.awake();
    for (const since of this.storedSince.values()) {
      const at = since + DESKTOP_STORED_RUNNING_MS;
      if (at > awake) earliest = Math.min(earliest ?? at, at);
    }
    // The caller schedules on the wall clock.
    return earliest === undefined ? undefined : this.clock.toWall(earliest);
  }

  /** The window that reports `id` busy right now, if it is alive. */
  busyClient(id: string): string | undefined {
    const session = this.sessions.get(id);
    return session?.busy && this.clientAlive(session.clientId) ? session.clientId : undefined;
  }

  /**
   * The window still running `id` as far as anyone knows: alive and busy, or
   * busy at its last beat and silent since, for as long as its run lease would
   * last. A hidden or stalled window keeps running its provider, so a Host turn
   * started over that silence forks the conversation.
   */
  runningClient(id: string): string | undefined {
    const live = this.busyClient(id);
    if (live) return live;
    const last = this.lastBusyBeat.get(id);
    if (!last || this.clientAlive(last.clientId)) return undefined;
    if (this.awake() - last.at <= DESKTOP_SILENT_BUSY_MS) return last.clientId;
    this.lastBusyBeat.delete(id);
    return undefined;
  }

  private noteBusyBeat(id: string, clientId: string): void {
    this.lastBusyBeat.delete(id);
    this.lastBusyBeat.set(id, { clientId, at: this.awake() });
    while (this.lastBusyBeat.size > 1024)
      this.lastBusyBeat.delete(this.lastBusyBeat.keys().next().value!);
  }

  /** Only the window that ran the turn can report it over. */
  private clearBusyBeat(id: string, clientId: string): void {
    if (this.lastBusyBeat.get(id)?.clientId === clientId) this.lastBusyBeat.delete(id);
  }

  /** A client silent past the stale window cannot hold a writer any more. */
  private pruneWriterClients(): void {
    for (const [clientId, known] of this.writerClients)
      if (this.awake() - known.at > DESKTOP_WRITER_STALE_MS) this.writerClients.delete(clientId);
  }

  /** Before Host continuation, every live window that holds this session's writer must release it.
   * A dead (silent) client and a live window whose last report lacks the session count as
   * retired; only a busy live holder blocks. */
  async retireWriters(sessionId: string): Promise<void> {
    this.pruneWriterClients();
    const clients = [...this.writerClients].filter(
      ([clientId, known]) => this.clientAlive(clientId) || known.sessions.has(sessionId),
    );
    for (const [clientId] of clients)
      if (!this.clientAlive(clientId))
        console.warn(`Desktop writer client ${clientId} is silent; treating it as retired.`);
    const live = clients.filter(
      ([clientId, known]) => this.clientAlive(clientId) && known.sessions.has(sessionId),
    );
    if (this.runningClient(sessionId))
      throw new Error("The desktop session is still running. Retry after it finishes.");
    await Promise.all(
      live.map(
        ([clientId]) =>
          new Promise<void>((resolve, reject) => {
            const id = randomUUID();
            const timer = setTimeout(() => {
              // A live heartbeat retaining this writer is evidence against transfer.
              this.pruneWriterClients();
              if (
                this.busyClient(sessionId) ||
                (this.clientAlive(clientId) &&
                  this.writerClients.get(clientId)?.sessions.has(sessionId))
              )
                finish(
                  "The desktop did not confirm provider writer retirement. Reopen bycoda there and retry.",
                );
              else {
                console.warn("Desktop writer retirement was not confirmed; proceeding.");
                finish();
              }
            }, DESKTOP_WRITER_TRANSFER_MS);
            const finish = (error?: string) => {
              clearTimeout(timer);
              this.writerTransfers.delete(id);
              if (error) reject(new Error(error));
              else resolve();
            };
            this.writerTransfers.set(id, { clientId, sessionId, finish });
          }),
      ),
    );
  }

  closeWriterTransfers(): void {
    for (const transfer of this.writerTransfers.values())
      transfer.finish("The Host closed before desktop writer retirement was confirmed.");
  }

  /** Live prompts laid over a stored session, and when they last changed. */
  overlay(
    id: string,
  ):
    | { pending: Block[]; patch: Partial<Session>; changedAt: number; sourceEpoch: string }
    | undefined {
    const session = this.sessions.get(id);
    return session && this.clientAlive(session.clientId) ? session : undefined;
  }

  /** Leaves a watcher's stop, approval or answer for the desktop to run. */
  async prepareDesktop(
    command: Extract<HostCommand, { type: "cancel" | "approve" | "answer" }>,
    requester?: string,
  ): Promise<PreparedDesktop> {
    command = JSON.parse(JSON.stringify(command)) as typeof command;
    if (!WIRE_IDENTIFIER_PATTERN.test(command.commandId)) throw new Error("Invalid command ID");
    const source = this.sessions.get(command.sessionId);
    if (!source || !this.clientAlive(source.clientId) || !source.pageToken || !source.turnReceipt)
      throw new Error(
        "Desktop control ownership is unavailable. Wait for the original turn or use its owning window.",
      );
    const turn = { ...source.turnReceipt };
    const pageToken = source.pageToken;
    const fingerprint = source.fingerprint;
    const clientId = source.clientId;
    const validate = () => {
      const current = this.sessions.get(command.sessionId);
      if (
        !current ||
        !this.clientAlive(clientId) ||
        current.clientId !== clientId ||
        current.pageToken !== pageToken ||
        current.turnReceipt?.turnId !== turn.turnId ||
        current.turnReceipt?.sessionId !== turn.sessionId ||
        (command.type !== "cancel" && current.fingerprint !== fingerprint)
      )
        throw new Error("The original desktop turn changed. Refresh before retrying.");
      if (command.type === "cancel" && !current.busy)
        throw new Error("The desktop turn is no longer running.");
      if (command.type === "approve") {
        if (!isApprovalOccurrenceId(command.approvalOccurrenceId) || command.runId !== "desktop")
          throw new Error("Approval request identity is missing or invalid.");
        const pending = current.pending.filter(
          (block) => block.approval?.requestId === command.requestId && !block.approval.decided,
        );
        if (
          pending.length !== 1 ||
          pending[0].approval?.occurrenceId !== command.approvalOccurrenceId
        )
          throw new Error(
            "This approval request changed or is already resolved. Refresh it before responding.",
          );
      }
      if (
        command.type === "answer" &&
        String(current.patch.pendingQuestion?.requestId) !== String(command.requestId)
      )
        throw new Error("Question is already resolved.");
    };
    validate();
    const delivery: DesktopCommand = {
      id: command.commandId,
      sessionId: command.sessionId,
      type: command.type,
      runId: command.runId,
      ...(command.authorityGeneration === undefined
        ? {}
        : { authorityGeneration: command.authorityGeneration }),
      ...(command.type === "approve"
        ? {
            requestId: command.requestId,
            approvalOccurrenceId: command.approvalOccurrenceId,
            decision: command.decision,
          }
        : {}),
      ...(command.type === "answer" ? { requestId: command.requestId, reply: command.reply } : {}),
      pageToken,
      turnReceipt: turn,
      requestedBy: requestedByName(requester),
    };
    return Object.freeze({
      commandId: command.commandId,
      sessionId: command.sessionId,
      clientId,
      ownerId: pageToken,
      delivery: JSON.stringify(delivery),
      revalidate: async () => validate(),
      current: () => {
        try {
          validate();
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  trackDesktop(prepared: PreparedDesktop): void {
    if (!this.durablePending.has(prepared.commandId))
      this.durablePending.set(prepared.commandId, prepared);
  }
  pendingDesktop(clientId: string): PreparedDesktop[] {
    const pending: PreparedDesktop[] = [];
    for (const [id, entry] of this.durablePending) {
      if (!entry.current()) {
        this.durablePending.delete(id);
        continue;
      }
      if (entry.clientId === clientId && pending.length < 16) pending.push(entry);
    }
    return pending;
  }
  finishDesktopOffer(commandId: string, offered: boolean): void {
    const entry = this.durablePending.get(commandId);
    if (entry && offered) this.durableOffered.set(commandId, entry);
    this.durablePending.delete(commandId);
  }
  desktopAcknowledgement(
    clientId: string,
    pageToken: string | undefined,
    commandId: string,
  ): PreparedDesktop | undefined {
    const entry = this.durableOffered.get(commandId);
    return entry && entry.clientId === clientId && entry.ownerId === pageToken ? entry : undefined;
  }
  finishDesktopAcknowledgement(commandId: string): void {
    this.durableOffered.delete(commandId);
  }

  enqueue(command: Extract<HostCommand, { type: "cancel" | "approve" | "answer" }>): void {
    this.reclaimCommands();
    if (typeof command.commandId !== "string" || !WIRE_IDENTIFIER_PATTERN.test(command.commandId))
      throw new Error("Invalid command ID");
    const delivery: DesktopCommand = {
      id: command.commandId,
      sessionId: command.sessionId,
      type: command.type,
      runId: command.runId,
      ...(command.authorityGeneration === undefined
        ? {}
        : { authorityGeneration: command.authorityGeneration }),
      ...(command.type === "approve"
        ? {
            requestId: command.requestId,
            approvalOccurrenceId: command.approvalOccurrenceId,
            decision: command.decision,
          }
        : {}),
      ...(command.type === "answer" ? { requestId: command.requestId, reply: command.reply } : {}),
    };
    const signature = createHash("sha256").update(JSON.stringify(delivery)).digest("hex");
    const previous = this.commandReceipts.get(command.commandId);
    if (previous) {
      if (previous.signature !== signature)
        throw new Error("This command ID already belongs to a different desktop control");
      return;
    }
    if (this.commands.some((pending) => pending.id === command.commandId))
      throw new Error("This command ID already belongs to a different desktop control");
    if (command.type === "approve") {
      if (!isApprovalOccurrenceId(command.approvalOccurrenceId))
        throw new Error(
          "Approval request identity is missing or invalid. Refresh this request before responding.",
        );
      if (command.runId !== "desktop")
        throw new Error("This approval belongs to a different execution owner");
      const pending = this.overlay(command.sessionId)?.pending.filter(
        (block) => block.approval?.requestId === command.requestId && !block.approval.decided,
      );
      if (
        pending?.length !== 1 ||
        pending[0].approval?.occurrenceId !== command.approvalOccurrenceId
      )
        throw new Error(
          "This approval request changed or is already resolved. Refresh it before responding.",
        );
    }
    if (this.commands.length >= MAX_COMMANDS)
      throw new Error("Too many commands waiting for the bycoda app on that computer");
    // Only acknowledged/expired delivery history may be compacted. Pending choices
    // remain in their original queue slot even when the current prompt changes.
    if (this.commandReceipts.size >= MAX_COMMAND_RECEIPTS) {
      const queued = new Set(this.commands.map((entry) => entry.id));
      const completed = Array.from(this.commandReceipts.keys()).find((id) => !queued.has(id));
      if (completed === undefined) throw new Error("Desktop command receipt storage is full");
      this.commandReceipts.delete(completed);
    }
    const acceptedAt = this.now();
    this.commands.push({ ...delivery, queuedAt: acceptedAt });
    this.commandReceipts.set(command.commandId, { signature, acceptedAt });
  }
}

/** Only presentation fields: identity and transcript stay the stored copy's. */
function livePatch(patch: Partial<Session>): Partial<Session> {
  const {
    id: _id,
    cwd: _cwd,
    harness: _harness,
    blocks: _blocks,
    providerSessionId: _provider,
    worktreeCwd: _worktree,
    ...rest
  } = patch;
  return rest;
}

/** The stored session with the desktop's live prompts merged in. */
export function withOverlay(
  session: Session,
  overlay: { pending: Block[]; patch: Partial<Session> } | undefined,
): Session {
  if (!overlay || (!overlay.pending.length && !Object.keys(overlay.patch).length)) return session;
  const pending = new Map(overlay.pending.map((block) => [block.id, block]));
  const blocks = session.blocks.map((block) => {
    const live = pending.get(block.id);
    if (!live) return block;
    pending.delete(block.id);
    return live;
  });
  return {
    ...session,
    ...overlay.patch,
    blocks: [...blocks, ...pending.values()],
  };
}
