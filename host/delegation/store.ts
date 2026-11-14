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
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  private get file(): string {
    return join(this.directory, "delegation", "runs.json");
  }

  private async load(): Promise<DelegationRecord[]> {
    if (!this.records) {
      const result = await readStateFile(this.file, parseRecords);
      this.records = result.status === "ok" ? result.value : [];
    }
    return this.records;
  }

  /** Serialized read-modify-write so concurrent tool calls never drop a row. */
  private update<T>(change: (records: DelegationRecord[]) => T | Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const records = await this.load();
      const result = await change(records);
      const dropped = this.trim(records);
      await writeFileAtomic(this.file, JSON.stringify(records), { mode: 0o600 });
      // After the row is gone: a failed cleanup leaves an unreferenced empty folder, never a dangling row.
      for (const runId of dropped) await this.removeScratch(runId);
      return result;
    });
    this.chain = next.catch(() => undefined);
    return next;
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
    });
  }

  patch(runId: string, change: Partial<DelegationRecord>): Promise<void> {
    return this.update((records) => {
      const record = records.find((entry) => entry.runId === runId);
      if (record) Object.assign(record, change);
    });
  }
}
