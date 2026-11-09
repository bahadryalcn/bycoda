import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import type { SessionLifecycleStore as LifecycleStorePort } from "../domains/sessions/lifecycle-model";
import {
  isDefaultLifecycleRecord,
  normalizeAutoSettleSettings,
  normalizeLifecycleRecord,
  type AutoSettleSettings,
  type SessionLifecycleRecord,
} from "../domains/sessions/lifecycle-model";

export * from "../domains/sessions/lifecycle-model";
const parseRecords = (text: string): Record<string, unknown> => {
  const value = JSON.parse(text);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

/** One state file; writes are serialized so concurrent changes never drop a row. */
export class SessionLifecycleStore implements LifecycleStorePort {
  private records?: Map<string, SessionLifecycleRecord>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly owner: () => string | null = () => null,
  ) {}

  private get file(): string {
    return join(this.directory, "sessions", "lifecycle.json");
  }

  private async load(): Promise<Map<string, SessionLifecycleRecord>> {
    if (!this.records) {
      const result = await readStateFile(this.file, parseRecords);
      if (result.status === "corrupt")
        throw new Error("Session lifecycle state is corrupt; it was retained as evidence.");
      const raw = result.status === "ok" ? result.value : {};
      this.records = new Map(
        Object.entries(raw).map(([id, value]) => [
          id,
          normalizeLifecycleRecord(id, value, this.owner()),
        ]),
      );
    }
    return this.records;
  }

  /** The stored record, or a default active one (not persisted until changed). */
  async get(sessionId: string): Promise<SessionLifecycleRecord> {
    const records = await this.chain.then(() => this.load());
    return structuredClone(
      records.get(sessionId) ?? normalizeLifecycleRecord(sessionId, undefined, this.owner()),
    );
  }

  async list(): Promise<SessionLifecycleRecord[]> {
    const records = await this.chain.then(() => this.load());
    return structuredClone([...records.values()]);
  }

  /** Serialized read-modify-write; the change returns the next record or undefined to drop it. */
  update<T>(
    sessionId: string,
    change: (current: SessionLifecycleRecord) => {
      next?: SessionLifecycleRecord;
      result: T;
    },
  ): Promise<T> {
    const run = this.chain.then(async () => {
      const records = await this.load();
      const current =
        records.get(sessionId) ?? normalizeLifecycleRecord(sessionId, undefined, this.owner());
      const { next, result } = change(structuredClone(current));
      const draft = new Map(records);
      // Active records carry no information; keep the file small.
      if (next && !isDefaultLifecycleRecord(next)) draft.set(sessionId, next);
      else draft.delete(sessionId);
      await writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(draft)), { mode: 0o600 });
      this.records = draft;
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private get settingsFile(): string {
    return join(this.directory, "sessions", "auto-settle.json");
  }

  async autoSettleSettings(): Promise<AutoSettleSettings> {
    await this.chain;
    const result = await readStateFile(this.settingsFile, (text) => JSON.parse(text) as unknown);
    return normalizeAutoSettleSettings(result.status === "ok" ? result.value : undefined);
  }

  saveAutoSettleSettings(settings: AutoSettleSettings): Promise<AutoSettleSettings> {
    const next = normalizeAutoSettleSettings(settings);
    const run = this.chain.then(async () => {
      await writeFileAtomic(this.settingsFile, JSON.stringify(next), { mode: 0o600 });
      return next;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Drops records of deleted sessions. */
  async prune(exists: (sessionId: string) => boolean | Promise<boolean>): Promise<number> {
    const stale: string[] = [];
    for (const record of await this.list())
      if (!(await exists(record.sessionId))) stale.push(record.sessionId);
    for (const id of stale) await this.update(id, () => ({ result: undefined }));
    return stale.length;
  }
}
