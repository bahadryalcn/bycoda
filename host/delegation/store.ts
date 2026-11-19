import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  DelegateModelRef,
  DelegationKind,
} from "../../src/shared/model/host-contracts/delegation";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

/** One delegated child run. Authority comes from these rows, never from a model setting. */
export type DelegationRecord = {
  runId: string;
  kind: DelegationKind;
  parentSessionId: string;
  /** Original parent execution groups siblings; later chat work cannot discover old peers. */
  groupId?: string;
  childSessionId: string;
  /** Latest child turn; an owner follow-up turn moves it forward. */
  childRunId?: string;
  /** Original unattended allowance; immutable across child continuation turns. */
  rootWorkId?: string;
  budgetScope?: { taskId?: string; parentTaskId?: string; goalId?: string };
  ownerFollowUp?: boolean;
  /** `files: false`: the child runs in this record's scratch folder, removed with the record. */
  chatOnly?: true;
  /** Opt-in asynchronous completion delivery to the original parent. */
  notifyOnCompletion?: boolean;
  /** Parent Stop revokes peer sends and queued wakes for this group member. */
  communicationClosed?: boolean;
  pending?: { args: Record<string, unknown>; callerFingerprint: string };
  model: DelegateModelRef;
  title: string;
  requestKey: string;
  payloadHash: string;
  /** Durable idempotency receipts for continuation turns. */
  replies?: { requestKey: string; payloadHash: string }[];
  modelSettings?: Record<string, string>;
  startedAt: number;
  finishedAt?: number;
  status?: "succeeded" | "failed" | "cancelled";
  /** Why the run never started or failed before the Host saw its turn. */
  error?: string;
};

export const MAX_DELEGATION_RECORDS = 500;

const parseRecords = (text: string): DelegationRecord[] => {
  const value = JSON.parse(text);
  return Array.isArray(value) ? (value as DelegationRecord[]) : [];
};

/** Records live in one state file; the oldest finished rows go first when it is full. */
export class DelegationStore {
  private records?: DelegationRecord[];
  /** Memory holds changes the file does not yet have (a failed write keeps it set). */
  private dirty = false;
  private queued = 0;
  private waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private get file(): string {
    return join(this.directory, "delegation", "runs.json");
  }

  private async load(): Promise<DelegationRecord[]> {
    if (!this.records) {
      const result = await readStateFile(this.file, parseRecords);
      this.records = result.status === "ok" ? result.value : [];
      // A missing or corrupt file is rewritten by the next change, as before.
      if (result.status !== "ok") this.dirty = true;
    }
    return this.records;
  }

  /**
   * Serialized read-modify-write so concurrent tool calls never drop a row. A change settles only
   * after a write that contains it. When more changes are queued behind it, the last one in the
   * queue writes once for the whole group instead of once per change.
   */
  private update(change: (records: DelegationRecord[]) => boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queued += 1;
      const next = this.chain.then(async () => {
        this.queued -= 1;
        let records: DelegationRecord[];
        try {
          records = await this.load();
        } catch (error) {
          reject(error);
          return;
        }
        let changed = true;
        let failed = false;
        try {
          changed = change(records);
        } catch (error) {
          failed = true;
          reject(error);
        }
        if (changed) this.dirty = true;
        if (!failed) this.waiting.push({ resolve, reject });
        if (this.queued === 0) await this.flush(records);
      });
      this.chain = next.catch(() => undefined);
    });
  }

  /** One write for the whole group; each change settles only after it, or after its failure. */
  private async flush(records: DelegationRecord[]): Promise<void> {
    const group = this.waiting;
    this.waiting = [];
    const size = records.length;
    const dropped = this.trim(records);
    if (records.length !== size) this.dirty = true;
    if (this.dirty) {
      try {
        await writeFileAtomic(this.file, JSON.stringify(records), { mode: 0o600 });
      } catch (error) {
        for (const entry of group) entry.reject(error);
        return;
      }
      this.dirty = false;
    }
    // After the row is gone: a failed cleanup leaves an unreferenced empty folder, never a dangling row.
    for (const runId of dropped) await this.removeScratch(runId);
    for (const entry of group) entry.resolve();
  }

  /** Drops the oldest finished rows; returns the run ids of the chat-only ones. */
  private trim(records: DelegationRecord[]): string[] {
    const dropped: string[] = [];
    while (records.length > MAX_DELEGATION_RECORDS) {
      const index = records.findIndex((record) => record.finishedAt !== undefined);
      if (index < 0) break;
      const [record] = records.splice(index, 1);
      if (record?.chatOnly) dropped.push(record.runId);
    }
    return dropped;
  }

  /** The empty folder of a chat-only child. Created once; the same child reuses it on every reply. */
  async scratchDir(runId: string): Promise<string> {
    const path = join(this.directory, "delegation", "scratch", runId);
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }

  private async removeScratch(runId: string): Promise<void> {
    await rm(join(this.directory, "delegation", "scratch", runId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }

  async list(): Promise<DelegationRecord[]> {
    return [...(await this.load())];
  }

  async find(runId: string): Promise<DelegationRecord | undefined> {
    return (await this.load()).find((record) => record.runId === runId);
  }

  async findByRequestKey(requestKey: string): Promise<DelegationRecord | undefined> {
    return (await this.load()).find(
      (record) =>
        record.requestKey === requestKey ||
        record.replies?.some((reply) => reply.requestKey === requestKey),
    );
  }

  async isChild(sessionId: string): Promise<boolean> {
    return (await this.load()).some((record) => record.childSessionId === sessionId);
  }

  add(record: DelegationRecord): Promise<void> {
    return this.update((records) => {
      records.push(record);
      return true;
    });
  }

  patch(runId: string, change: Partial<DelegationRecord>): Promise<void> {
    return this.update((records) => {
      const record = records.find((entry) => entry.runId === runId);
      if (!record) return false;
      // A patch that repeats stored values does not rewrite the file.
      const keys = Object.keys(change) as (keyof DelegationRecord)[];
      const changed = keys.some((key) => !(key in record) || record[key] !== change[key]);
      if (changed) Object.assign(record, change);
      return changed;
    });
  }
}
