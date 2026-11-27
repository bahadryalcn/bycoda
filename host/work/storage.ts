import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  WorkRecordSchema,
  WorkSubmissionSchema,
  type WorkRecord,
  type WorkSubmission,
} from "../../src/shared/model/host-contracts/work";
import type { HostStore } from "../store";

const HOUR_MS = 60 * 60 * 1000;
const COMPLETED_QUEUE_RETENTION_MS = 30 * 24 * HOUR_MS;
const ARCHIVE_BATCH_SIZE = 512;
const PENDING = "(json_extract(value,'$.state') IN ('queued','waiting'))";
const RESERVED = "json_extract(value,'$.reserved')";
const COMPLETED = `json_extract(value,'$.state') = 'completed' AND ${RESERVED} = 0`;
const UPDATED_AT = "json_extract(value,'$.updatedAt')";
const WORK_COLUMNS =
  "sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, source_key TEXT NOT NULL UNIQUE, value TEXT NOT NULL";

/** Durable queue shares the Host SQL owner and critical transactions. */
export class WorkStorage {
  readonly ready: Promise<void>;
  private nextArchiveAt = 0;

  constructor(
    readonly store: HostStore,
    private readonly now: () => number,
  ) {
    this.ready = store.ready.then(() => this.initialize());
  }

  private initialize(): Promise<void> {
    const { db } = this.store;
    return this.store.transaction(async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS work_queue (${WORK_COLUMNS})`);
      const columns = await db.prepare("PRAGMA table_info(work_queue)").all();
      if (!columns.some((column) => column.name === "sequence")) {
        // Preserve the legacy insertion order and keep it stable through VACUUM.
        await db.exec(`
          ALTER TABLE work_queue RENAME TO work_queue_legacy;
          CREATE TABLE work_queue (${WORK_COLUMNS});
          INSERT INTO work_queue(sequence,id,source_key,value)
            SELECT rowid,id,source_key,value FROM work_queue_legacy;
          DROP TABLE work_queue_legacy;
        `);
      }
      await db.exec(`
        CREATE TABLE IF NOT EXISTS work_history (${WORK_COLUMNS});
        CREATE INDEX IF NOT EXISTS work_queue_pending ON work_queue (${PENDING}) WHERE ${PENDING} = 1;
        CREATE INDEX IF NOT EXISTS work_queue_reserved ON work_queue (${RESERVED}) WHERE ${RESERVED} = 1;
        CREATE INDEX IF NOT EXISTS work_queue_completed ON work_queue (${UPDATED_AT}) WHERE ${COMPLETED};
      `);
    });
  }

  async get(id: string): Promise<WorkRecord> {
    await this.ready;
    const row = await this.store.db
      .prepare(
        "SELECT value FROM work_queue WHERE id=? UNION ALL SELECT value FROM work_history WHERE id=?",
      )
      .get(id, id);
    if (!row) throw new Error(`Work not found: ${id}`);
    return WorkRecordSchema.parse(JSON.parse(String(row.value)));
  }

  async list(): Promise<WorkRecord[]> {
    await this.ready;
    const rows = await this.store.db
      .prepare(
        "SELECT value, sequence FROM work_queue UNION ALL SELECT value, sequence FROM work_history ORDER BY sequence",
      )
      .all();
    return rows.map((row) => WorkRecordSchema.parse(JSON.parse(String(row.value))));
  }

  listPending(): Promise<WorkRecord[]> {
    return this.listQueue(`${PENDING} = 1`);
  }

  listReserved(): Promise<WorkRecord[]> {
    return this.listQueue(`${RESERVED} = 1`);
  }

  private async listQueue(predicate: string): Promise<WorkRecord[]> {
    await this.ready;
    const rows = await this.store.readScope(() =>
      this.store.db
        .prepare(`SELECT value FROM work_queue WHERE ${predicate} ORDER BY sequence`)
        .all(),
    );
    return rows.map((row) => WorkRecordSchema.parse(JSON.parse(String(row.value))));
  }

  /** Keep exact outcome and occurrence replay while removing old completions from the live queue. */
  async archiveCompleted(): Promise<void> {
    const now = this.now();
    if (now < this.nextArchiveAt) return;
    await this.ready;
    const cutoff = now - COMPLETED_QUEUE_RETENTION_MS;
    const batch = `FROM work_queue WHERE ${COMPLETED} AND ${UPDATED_AT} < ? ORDER BY ${UPDATED_AT}, sequence LIMIT ?`;
    const count = await this.store.transaction(async () => {
      await this.store.db
        .prepare(
          `INSERT INTO work_history(sequence,id,source_key,value) SELECT sequence,id,source_key,value ${batch}`,
        )
        .run(cutoff, ARCHIVE_BATCH_SIZE);
      return (
        await this.store.db
          .prepare(`DELETE FROM work_queue WHERE sequence IN (SELECT sequence ${batch})`)
          .run(cutoff, ARCHIVE_BATCH_SIZE)
      ).changes;
    }, "checkpoint");
    // Drain an existing backlog in bounded batches, yielding between scheduler ticks.
    if (Number(count) < ARCHIVE_BATCH_SIZE) this.nextArchiveAt = now + HOUR_MS;
  }

  async save(work: WorkRecord): Promise<WorkRecord> {
    const next = WorkRecordSchema.parse({ ...work, updatedAt: this.now() });
    const value = JSON.stringify(next);
    const saved = await this.store.db
      .prepare("UPDATE work_queue SET value=? WHERE id=?")
      .run(value, next.id);
    if (Number(saved.changes) === 0)
      await this.store.db.prepare("UPDATE work_history SET value=? WHERE id=?").run(value, next.id);
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
        .prepare(
          "SELECT value FROM work_queue WHERE source_key=? UNION ALL SELECT value FROM work_history WHERE source_key=?",
        )
        .get(key, key);
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
        .prepare(`INSERT INTO work_queue(sequence,id,source_key,value) VALUES (
          MAX(COALESCE((SELECT MAX(sequence) FROM work_queue),0),
              COALESCE((SELECT MAX(sequence) FROM work_history),0)) + 1, ?, ?, ?)`)
        .run(id, key, JSON.stringify(work));
      return work;
    }, "critical");
  }
}
