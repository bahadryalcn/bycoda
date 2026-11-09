import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

/** A session is linked to one existing task record; a task may have many linked sessions. */
export interface SessionTaskLink {
  sessionId: string;
  taskId: string;
  linkedAt: number;
}

export class SessionTaskLinkError extends Error {
  constructor(
    readonly code: "task-not-found" | "already-linked" | "invalid-id",
    message: string,
  ) {
    super(message);
    this.name = "SessionTaskLinkError";
  }
}

export interface SessionTaskLinkPorts {
  /** Existing task storage lookup; links never create or copy a task record. */
  taskExists(taskId: string): Promise<boolean>;
  now(): number;
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const parseLinks = (text: string): SessionTaskLink[] => {
  const value = JSON.parse(text);
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: SessionTaskLink[] = [];
  for (const row of value as Partial<SessionTaskLink>[]) {
    if (!row || !validId(row.sessionId) || !validId(row.taskId) || seen.has(row.sessionId))
      continue;
    // The first row wins, so a hand-edited file cannot give one session two tasks.
    seen.add(row.sessionId);
    links.push({
      sessionId: row.sessionId,
      taskId: row.taskId,
      linkedAt: Number.isFinite(row.linkedAt) ? Number(row.linkedAt) : 0,
    });
  }
  return links;
};

/**
 * Persistent session-to-task links. Keyed by session, so the one-task-per-session rule holds by
 * construction; the task side is a query. State survives Host restarts in one atomic file.
 */
export class SessionTaskLinks {
  private links?: Map<string, SessionTaskLink>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly ports: SessionTaskLinkPorts,
  ) {}

  private get file(): string {
    return join(this.directory, "tasks", "session-links.json");
  }

  private async load(): Promise<Map<string, SessionTaskLink>> {
    if (!this.links) {
      const result = await readStateFile(this.file, parseLinks);
      if (result.status === "corrupt")
        throw new Error("Session task links are corrupt; they were retained as evidence.");
      this.links = new Map(
        (result.status === "ok" ? result.value : []).map((l) => [l.sessionId, l]),
      );
    }
    return this.links;
  }

  private mutate<T>(change: (links: Map<string, SessionTaskLink>) => Promise<T> | T): Promise<T> {
    const run = this.chain.then(async () => {
      const current = await this.load();
      const draft = new Map(current);
      const result = await change(draft);
      await writeFileAtomic(this.file, JSON.stringify([...draft.values()]), {
        mode: 0o600,
      });
      this.links = draft;
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async taskFor(sessionId: string): Promise<string | undefined> {
    const links = await this.chain.then(() => this.load());
    return links.get(sessionId)?.taskId;
  }

  async sessionsFor(taskId: string): Promise<string[]> {
    const links = await this.chain.then(() => this.load());
    return [...links.values()].filter((l) => l.taskId === taskId).map((l) => l.sessionId);
  }

  /** Links a session to an existing task. Linking the same pair again is a no-op. */
  async link(sessionId: string, taskId: string): Promise<SessionTaskLink> {
    if (!validId(sessionId) || !validId(taskId))
      throw new SessionTaskLinkError("invalid-id", "Invalid session or task id");
    if (!(await this.ports.taskExists(taskId)))
      throw new SessionTaskLinkError("task-not-found", "Task not found");
    return this.mutate((links) => {
      const existing = links.get(sessionId);
      if (existing?.taskId === taskId) return existing;
      if (existing)
        throw new SessionTaskLinkError(
          "already-linked",
          "This session is already linked to another task. Unlink it first.",
        );
      const next = { sessionId, taskId, linkedAt: this.ports.now() };
      links.set(sessionId, next);
      return next;
    });
  }

  /** Removes the link; the task and session records are untouched. Returns whether one existed. */
  unlink(sessionId: string): Promise<boolean> {
    return this.mutate((links) => links.delete(sessionId));
  }

  /** Drops links of deleted sessions or tasks, so a recreated id never inherits a stale link. */
  async prune(
    sessionExists: (id: string) => boolean | Promise<boolean>,
    taskExists: (id: string) => boolean | Promise<boolean>,
  ): Promise<number> {
    const links = await this.chain.then(() => this.load());
    const stale: string[] = [];
    for (const l of links.values())
      if (!(await sessionExists(l.sessionId)) || !(await taskExists(l.taskId)))
        stale.push(l.sessionId);
    if (!stale.length) return 0;
    return this.mutate((draft) => {
      for (const id of stale) draft.delete(id);
      return stale.length;
    });
  }
}
