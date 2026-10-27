import { randomUUID } from "node:crypto";
import { parseSessionLayout } from "./session-layout";
import {
  MAX_DIRECTORY_LOGO_LENGTH,
  parseProjectAppearance,
  projectIdentityColor,
} from "../src/features/connections/model/projectAppearance";
import type { Block, Session } from "../src/features/sessions/model/session";
import type {
  DesktopProjectDirectory,
  HostCommand,
  HostProject,
  HostProjectDirectory,
} from "../src/features/connections/model/protocol";
import { canonicalHostPath, hostProjectId } from "../src/features/sync/model/syncProjectId";

/** Past this without a heartbeat, the desktop app is gone (closed or crashed)
 * and none of its sessions is running. */
export const DESKTOP_BEAT_STALE_MS = 20_000;
const MAX_PENDING_BLOCKS = 50;
const MAX_COMMANDS = 100;
export const DESKTOP_COMMAND_RETAIN_MS = 5 * 60_000;
export const DESKTOP_WRITER_TRANSFER_MS = 12_000;
/**
 * How long the desktop database's in-flight mark is believed from an app that
 * never sent a heartbeat. A crashed app leaves the mark behind for good; without
 * an end the host would never send a queued message of that conversation.
 */
export const DESKTOP_STORED_RUNNING_MS = 15 * 60_000;

export type DesktopCommand = {
  id: string;
  sessionId: string;
  type: "cancel" | "approve" | "answer" | "retire-writer";
  requestId?: number;
  decision?: "allow" | "deny";
  reply?: unknown;
};

type LiveSession = {
  clientId: string;
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
  private writerClients = new Map<string, Set<string>>();
  private writerTransfers = new Map<
    string,
    { clientId: string; sessionId: string; finish: (error?: string) => void }
  >();
  private directories = new Map<
    string,
    { at: number; value?: DesktopProjectDirectory; revision?: string }
  >();

  private lastChange = 0;

  onChange?: () => void;
  /** A window reported a conversation busy (each beat while it runs). */
  onBusy?: (sessionId: string, clientId: string) => void;
  /** A conversation a window ran is no longer busy there (`idle`), or the window stopped answering (`gone`). */
  onIdle?: (sessionId: string, clientId: string, reason?: "idle" | "gone") => void;
  /** When the in-flight mark of a session was first seen while no app had beat. */
  private storedSince = new Map<string, number>();
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
      this.writerClients.set(
        clientId,
        new Set(writers.sessionIds.filter((id): id is string => typeof id === "string")),
      );
    for (const id of acked) {
      const transfer = this.writerTransfers.get(id);
      if (transfer?.clientId === clientId)
        transfer.finish(
          this.writerClients.get(clientId)?.has(transfer.sessionId)
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
          busy: false,
          pending: [],
          patch: {},
          fingerprint: "[[],{}]",
          changedAt: this.changeStamp(),
        });
      }
    let changed =
      [...next].some(([id, value]) => this.sessions.get(id)?.changedAt !== value.changedAt) ||
      next.size !== this.sessions.size;
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
          changed = true;
        }
    }
    // Watchers must read the committed sessions and heartbeat, including on the
    // first beat. Signalling earlier can expose the previous running state.
    this.reclaimCommands();
    if (changed) this.onChange?.();
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
      return this.now() - since < DESKTOP_STORED_RUNNING_MS;
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

  /** Before Host continuation, every updated window must release this writer.
   * Known stale owners remain a blocker until they reconnect and acknowledge. */
  async retireWriters(sessionId: string): Promise<void> {
    const clients = [...this.writerClients].filter(
      ([clientId, writers]) => writers.has(sessionId) || this.clientAlive(clientId),
    );
    if (clients.some(([clientId]) => !this.clientAlive(clientId)))
      throw new Error(
        "The desktop writer is unreachable. Reopen bycoda there before continuing on the Host.",
      );
    if (this.busyClient(sessionId))
      throw new Error("The desktop session is still running. Retry after it finishes.");
    await Promise.all(
      clients.map(
        ([clientId]) =>
          new Promise<void>((resolve, reject) => {
            const id = randomUUID();
            const timer = setTimeout(
              () =>
                finish(
                  "The desktop did not confirm provider writer retirement. Reopen bycoda there and retry.",
                ),
              DESKTOP_WRITER_TRANSFER_MS,
            );
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
  ): { pending: Block[]; patch: Partial<Session>; changedAt: number } | undefined {
    const session = this.sessions.get(id);
    return session && this.clientAlive(session.clientId) ? session : undefined;
  }

  /** Leaves a watcher's stop, approval or answer for the desktop to run. */
  enqueue(command: Extract<HostCommand, { type: "cancel" | "approve" | "answer" }>): void {
    this.reclaimCommands();
    if (this.commands.length >= MAX_COMMANDS)
      throw new Error("Too many commands waiting for the bycoda app on that computer");
    this.commands.push({
      queuedAt: this.now(),
      id: randomUUID(),
      sessionId: command.sessionId,
      type: command.type,
      ...(command.type === "approve"
        ? { requestId: command.requestId, decision: command.decision }
        : {}),
      ...(command.type === "answer" ? { requestId: command.requestId, reply: command.reply } : {}),
    });
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
