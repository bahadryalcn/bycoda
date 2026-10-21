import { randomUUID } from "node:crypto";
import { parseSessionLayout } from "./session-layout";
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

export type DesktopCommand = {
  id: string;
  sessionId: string;
  type: "cancel" | "approve" | "answer";
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
  const ids = new Set<string>();
  for (const raw of value.groups) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const group = raw as Record<string, unknown>;
    if (!text(group.id, 200) || !text(group.name, 1000) || ids.has(group.id)) return;
    ids.add(group.id);
    groups.push({
      id: group.id,
      name: group.name,
      ...(typeof group.color === "string" && /^#[0-9a-f]{6}$/i.test(group.color)
        ? { color: group.color }
        : {}),
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
    projects.push({
      cwd: project.cwd,
      name: project.name,
      ...(typeof project.groupId === "string" ? { groupId: project.groupId } : {}),
      ...(sessionLayout ? { sessionLayout } : {}),
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
  private directories = new Map<string, { at: number; value?: DesktopProjectDirectory }>();

  private lastChange = 0;

  onChange?: () => void;
  constructor(private readonly now: () => number = Date.now) {}

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

  beat(input: unknown): { commands: DesktopCommand[] } {
    const value =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    if (!Array.isArray(value.sessions)) throw new Error("Invalid desktop sessions");
    const clientId =
      typeof value.clientId === "string" && value.clientId ? value.clientId : "legacy";
    if (Object.hasOwn(value, "projectDirectory")) {
      const projection = parseDesktopProjectDirectory(value.projectDirectory);
      this.directories.set(clientId, { at: this.now(), value: projection });
    }
    const acked = new Set(Array.isArray(value.acked) ? value.acked.map(String) : []);
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
      )
        next.set(id, {
          clientId,
          busy: false,
          pending: [],
          patch: {},
          fingerprint: "[[],{}]",
          changedAt: this.changeStamp(),
        });
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
    for (const [id, beatAt] of this.clients) {
      if (this.now() - beatAt <= DESKTOP_BEAT_STALE_MS) continue;
      this.clients.delete(id);
      this.directories.delete(id);
      for (const [sessionId, session] of this.sessions)
        if (session.clientId === id) {
          this.sessions.delete(sessionId);
          changed = true;
        }
    }
    // Watchers must read the committed sessions and heartbeat, including on the
    // first beat. Signalling earlier can expose the previous running state.
    this.reclaimCommands();
    if (changed) this.onChange?.();
    return {
      commands: this.commands
        .filter((command) => this.sessions.get(command.sessionId)?.clientId === clientId)
        .map(({ queuedAt: _queuedAt, ...command }) => command),
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
    if (alive === undefined) return stored;
    const session = this.sessions.get(id);
    return alive && !!session?.busy && this.clientAlive(session.clientId);
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
