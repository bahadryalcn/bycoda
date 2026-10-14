import type { HostSessionSummary, MachineChanges } from "./protocol";

/** What a host answers when asked with `known`; an older host ignores it and
 * returns the plain array. */
export type SessionListReply =
  | HostSessionSummary[]
  | { unchanged: true; etag: string }
  | { etag: string; sessions: HostSessionSummary[] };
const MAX_LIST_ENTRIES = 256;
const MAX_LIST_BYTES = 8 * 1024 * 1024;

/** Completed and in-flight reads are shared by the sidebar and project rail. */
export class RemoteSessionLists {
  private entries = new Map<
    string,
    { at: number; value: HostSessionSummary[]; json: string; etag?: string }
  >();
  private pending = new Map<string, Promise<HostSessionSummary[]>>();
  private generation = 0;
  private versions = new Map<string, number>();

  private bumpVersion(key: string) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    if (this.versions.size > 1024) {
      this.generation++;
      this.versions.clear();
      this.pending.clear();
    }
  }

  constructor(
    private readonly request: (
      machineId: string,
      projectId: string,
      /** The etag of the list held, or "" to ask for one. */
      known: string,
    ) => Promise<SessionListReply>,
  ) {}

  invalidate(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }

  invalidateProject(machineId: string, projectId: string): void {
    const key = JSON.stringify([machineId, projectId]);
    this.entries.delete(key);
    this.pending.delete(key);
    this.bumpVersion(key);
  }

  known(machineId: string, projectId: string): string | undefined {
    return this.entries.get(JSON.stringify([machineId, projectId]))?.etag;
  }

  verifiedAt(machineId: string, projectId: string): number | undefined {
    return this.entries.get(JSON.stringify([machineId, projectId]))?.at;
  }

  private remember(key: string, value: HostSessionSummary[], json: string, etag?: string) {
    this.entries.delete(key);
    if (json.length * 2 > MAX_LIST_BYTES) return;
    this.entries.set(key, { at: Date.now(), value, json, etag });
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.json.length * 2, 0);
    while (this.entries.size > MAX_LIST_ENTRIES || bytes > MAX_LIST_BYTES) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      bytes -= (this.entries.get(oldest)?.json.length ?? 0) * 2;
      this.entries.delete(oldest);
      this.bumpVersion(oldest);
    }
  }

  publish(
    machineId: string,
    projectId: string,
    sessions: HostSessionSummary[],
    etag: string,
  ): HostSessionSummary[] {
    const key = JSON.stringify([machineId, projectId]);
    const previous = this.entries.get(key);
    const json = JSON.stringify(sessions);
    const value = previous?.json === json ? previous.value : sessions;
    this.remember(key, value, json, etag);
    this.pending.delete(key);
    this.bumpVersion(key);
    if (this.entries.size > 256) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  applyChange(
    machineId: string,
    projectId: string,
    change: MachineChanges["projects"][number],
    reset = false,
  ): HostSessionSummary[] | undefined {
    if (reset) this.invalidateProject(machineId, projectId);
    if (change.sessions) return this.publish(machineId, projectId, change.sessions, change.etag);
    const key = JSON.stringify([machineId, projectId]);
    const entry = this.entries.get(key);
    if (entry?.etag === change.etag) return entry.value;
    if (!entry || !change.base || entry.etag !== change.base) return undefined;
    const removed = new Set(change.removed ?? []);
    const byId = new Map(
      entry.value
        .filter((session) => !removed.has(session.id))
        .map((session) => [session.id, session]),
    );
    for (const next of change.upserts ?? []) {
      const current = byId.get(next.id);
      byId.set(
        next.id,
        current && JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    }
    const sessions = [...byId.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
    return this.publish(machineId, projectId, sessions, change.etag);
  }

  load(machineId: string, projectId: string, force = false): Promise<HostSessionSummary[]> {
    const key = JSON.stringify([machineId, projectId]);
    const entry = this.entries.get(key);
    const age = entry?.value.some((session) => session.status === "running" || session.needsInput)
      ? 1_000
      : 5_000;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (!force && entry && Date.now() - entry.at < age) return Promise.resolve(entry.value);
    const generation = this.generation;
    const version = this.versions.get(key) ?? 0;
    const read = this.request(machineId, projectId, entry?.etag ?? "")
      .then((reply) => {
        if (generation !== this.generation || version !== (this.versions.get(key) ?? 0))
          return this.entries.get(key)?.value ?? this.load(machineId, projectId);
        let etag: string | undefined;
        let next: HostSessionSummary[];
        if (Array.isArray(reply)) next = reply;
        else if ("unchanged" in reply && entry && entry.etag === reply.etag) {
          next = entry.value;
          etag = reply.etag;
        } else if ("sessions" in reply && Array.isArray(reply.sessions)) {
          next = reply.sessions;
          etag = reply.etag;
        } else throw new Error("Invalid host session list");
        const json = next === entry?.value ? entry.json : JSON.stringify(next);
        const value = entry?.json === json ? entry.value : next;
        if (generation === this.generation) this.remember(key, value, json, etag);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === read) this.pending.delete(key);
      });
    this.pending.set(key, read);
    return read;
  }
}
