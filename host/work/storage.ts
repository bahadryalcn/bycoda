import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  WorkRecordSchema,
  WorkSubmissionSchema,
  type WorkRecord,
  type WorkSubmission,
} from "../../src/shared/model/host-contracts/work";
import type { HostStore } from "../store";

/** Durable queue shares the Host SQL owner and critical transactions. */
export class WorkStorage {
  readonly ready: Promise<void>;
  constructor(
    readonly store: HostStore,
    private readonly now: () => number,
  ) {
    this.ready = store.ready.then(() =>
      store.db.exec(
        "CREATE TABLE IF NOT EXISTS work_queue (id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, value TEXT NOT NULL)",
      ),
    );
  }

  async get(id: string): Promise<WorkRecord> {
    await this.ready;
    const row = await this.store.db.prepare("SELECT value FROM work_queue WHERE id=?").get(id);
    if (!row) throw new Error(`Work not found: ${id}`);
    return WorkRecordSchema.parse(JSON.parse(String(row.value)));
  }

  async list(): Promise<WorkRecord[]> {
    await this.ready;
    const rows = await this.store.db.prepare("SELECT value FROM work_queue ORDER BY rowid").all();
    return rows.map((row) => WorkRecordSchema.parse(JSON.parse(String(row.value))));
  }

  async save(work: WorkRecord): Promise<WorkRecord> {
    const next = WorkRecordSchema.parse({ ...work, updatedAt: this.now() });
    await this.store.db
      .prepare("UPDATE work_queue SET value=? WHERE id=?")
      .run(JSON.stringify(next), next.id);
    return next;
  }

  async submit(raw: WorkSubmission): Promise<WorkRecord> {
    const input = WorkSubmissionSchema.parse(raw);
    if (!isDeepStrictEqual(input.payload, JSON.parse(JSON.stringify(input.payload)))) {
      throw new Error("Work payload must contain only JSON values.");
    }
    await this.ready;
    return this.store.transaction(async () => {
      const key = JSON.stringify([input.source.kind, input.source.id, input.source.occurrence]);
      const row = await this.store.db
        .prepare("SELECT value FROM work_queue WHERE source_key=?")
        .get(key);
      if (row) {
        const work = WorkRecordSchema.parse(JSON.parse(String(row.value)));
        if (
          work.projectId !== input.projectId ||
          work.rootWorkId !== input.rootWorkId ||
          !isDeepStrictEqual(work.source, input.source) ||
          !isDeepStrictEqual(work.payload, input.payload)
        ) {
          throw new Error("Work occurrence already has different input.");
        }
        return work;
      }
      const id = randomUUID();
      const work: WorkRecord = {
        ...input,
        id,
        requestId: `work:${id}`,
        state: "queued",
        createdAt: this.now(),
        updatedAt: this.now(),
        reserved: false,
        dispatchStarted: false,
        stopRequested: false,
      };
      await this.store.db
        .prepare("INSERT INTO work_queue(id,source_key,value) VALUES(?,?,?)")
        .run(id, key, JSON.stringify(work));
      return work;
    }, "critical");
  }
}
