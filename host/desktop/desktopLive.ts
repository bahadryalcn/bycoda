import { createHash, randomUUID } from "node:crypto";
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
  DesktopProjectDirectory,
  HostCommand,
  HostProject,
  HostProjectDirectory,
} from "../../src/features/connections/model/protocol";
import { canonicalHostPath, hostProjectId } from "../../src/features/sync/model/syncProjectId";
import { createDedupedWarn } from "../diagnostics/log-dedupe";
import { createLogger } from "../diagnostics/logger";

const log = createLogger("host.desktop.live");

/** Past this without a heartbeat, the desktop app is gone (closed or crashed)
 * and none of its sessions is running. */
export const DESKTOP_BEAT_STALE_MS = 20_000;
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
    const sessionLayout = parseSessionLayout(project.sessionLayout);
    const appearance = readAppearance(project.appearance);
    projects.push({
      cwd: project.cwd,
      name: project.name,
      ...(typeof project.groupId === "string" ? { groupId: project.groupId } : {}),
      ...(sessionLayout ? { sessionLayout } : {}),
      ...(appearance ? { appearance } : {}),
    });
  }
  return {
    version: 1,
    groups,
    projects,
    excludedPaths: value.excludedPaths,
    excludedGroupIds: value.excludedGroupIds,
  };
}

/**
 * What the desktop app on this machine reports about its running sessions,
 * and the commands watchers on other computers left for it. The desktop
 * calls in (`sessions.desktopLive`); the host can't reach it otherwise.
 */
export class DesktopLive {
  private clients = new Map<string, number>();
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
  /** A window reported a conversation busy (each beat while it runs). */
  onBusy?: (sessionId: string, clientId: string) => void;
  /** A conversation a window ran is no longer busy there (`idle`), or the window stopped answering (`gone`). */
  onIdle?: (sessionId: string, clientId: string, reason?: "idle" | "gone") => void;
  /** When the in-flight mark of a session was first seen while no app had beat. */
  private storedSince = new Map<string, number>();
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
  constructor(private readonly now: () => number = Date.now) {}

  /** Only running state, including heartbeat/stored-mark expiry, influences
   * list metadata. Prompt text changes must not reread SQLite list rows. */
  listVersion(ids: readonly string[], stored: readonly boolean[]): string {
    let states = "";
    for (let index = 0; index < ids.length; index++)
      states += this.running(ids[index], stored[index]) ? "1" : "0";
    return states;
  }

  private reclaimCommands(): void {
    const now = this.now();
    this.commands = this.commands.filter((command) => {
      const owner = this.sessions.get(command.sessionId)?.clientId;
      const heartbeat = owner ? this.clients.get(owner) : undefined;
      return (
        (heartbeat !== undefined && now - heartbeat <= DESKTOP_BEAT_STALE_MS) ||
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

  beat(input: unknown): { commands: DesktopCommand[]; projectDirectoryRevision?: string } {
    const value =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    if (!Array.isArray(value.sessions)) throw new Error("Invalid desktop sessions");
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
    if (Object.hasOwn(value, "projectDirectory")) {
      const projection = parseDesktopProjectDirectory(value.projectDirectory);
      this.directories.set(clientId, {
        at: this.now(),
        value: projection,
        revision: projection ? revision : undefined,
      });
    } else if (revision) {
      const previous = this.directories.get(clientId);
      if (previous?.value && previous.revision === revision) previous.at = this.now();
    }
    const acked = new Set(Array.isArray(value.acked) ? value.acked.map(String) : []);
    const writers = value.writers as { version?: number; sessionIds?: unknown } | undefined;
    if (writers?.version === 1 && Array.isArray(writers.sessionIds))
      this.writerClients.set(clientId, {
        sessions: new Set(writers.sessionIds.filter((id): id is string => typeof id === "string")),
        at: this.now(),
      });
    else {
      const known = this.writerClients.get(clientId);
      if (known) known.at = this.now();
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
      if (entry.busy === true) this.onBusy?.(entry.id, clientId);
      else if (previous?.busy && previous.clientId === clientId) this.onIdle?.(entry.id, clientId);
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
    this.clients.set(clientId, this.now());
    this.storedSince.clear();
    for (const [id, beatAt] of this.clients) {
      if (this.now() - beatAt <= DESKTOP_BEAT_STALE_MS) continue;
      this.clients.delete(id);
      this.directories.delete(id);
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
    return {
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

  /** Never substitute raw sync records when a desktop privacy snapshot is absent. */
  projectDirectory(
    registered: readonly HostProject[],
    environmentId: string,
  ): HostProjectDirectory {
    const snapshots = [...this.directories.values()]
      .filter((snapshot) => this.now() - snapshot.at <= DESKTOP_BEAT_STALE_MS)
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
        for (const project of matches)
          projects.push({ ...project, ...projection, cwd: project.cwd, registered: true });
      } else
        projects.push({
          ...projection,
          id: hostProjectId(environmentId, projection.cwd),
          registered: false,
        });
    }
    return { version: 1, privacyReady: true, groups: [...groups.values()], projects };
  }

  private clientAlive(clientId: string): boolean {
    const beatAt = this.clients.get(clientId);
    return beatAt !== undefined && this.now() - beatAt <= DESKTOP_BEAT_STALE_MS;
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
      const since = this.storedSince.get(id) ?? this.now();
      this.storedSince.set(id, since);
      while (this.storedSince.size > 512)
        this.storedSince.delete(this.storedSince.keys().next().value!);
      if (this.now() - since < DESKTOP_STORED_RUNNING_MS) return true;
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
    for (const since of this.storedSince.values()) {
      const at = since + DESKTOP_STORED_RUNNING_MS;
      if (at > this.now()) earliest = Math.min(earliest ?? at, at);
    }
    return earliest;
  }

  /** The window that reports `id` busy right now, if it is alive. */
  busyClient(id: string): string | undefined {
    const session = this.sessions.get(id);
    return session?.busy && this.clientAlive(session.clientId) ? session.clientId : undefined;
  }

  /** A client silent past the stale window cannot hold a writer any more. */
  private pruneWriterClients(): void {
    for (const [clientId, known] of this.writerClients)
      if (this.now() - known.at > DESKTOP_WRITER_STALE_MS) this.writerClients.delete(clientId);
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
    if (this.busyClient(sessionId))
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
