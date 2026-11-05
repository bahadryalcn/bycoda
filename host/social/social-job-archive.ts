import type { HostStore } from "../store";
import type { SocialJob } from "../../src/features/social/model/social";

/** Cold rows preserve the complete original payload and dedupe key; no evidence is discarded. */
export class SocialJobArchive {
  private nextCompactionAt = performance.now() + 60_000;
  constructor(private readonly store: HostStore) {}
  async initialize(): Promise<void> {
    await this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS social_jobs_cold (id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,status TEXT NOT NULL,scheduled_at INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS social_jobs_cold_order ON social_jobs_cold(scheduled_at,id);
      CREATE INDEX IF NOT EXISTS social_jobs_cold_account ON social_jobs_cold(account_id,status,scheduled_at,id);
      CREATE INDEX IF NOT EXISTS social_jobs_cold_campaign ON social_jobs_cold(json_extract(value,'$.campaignId'),status,scheduled_at,id);
      CREATE INDEX IF NOT EXISTS social_jobs_cold_platform ON social_jobs_cold(account_id,json_extract(value,'$.platformId'));
      CREATE INDEX IF NOT EXISTS social_jobs_cold_program ON social_jobs_cold(account_id,json_extract(value,'$.programId'),json_extract(value,'$.dispatchedAt'));
      CREATE VIEW IF NOT EXISTS social_jobs_all AS SELECT * FROM social_jobs UNION ALL SELECT * FROM social_jobs_cold;
    `);
  }

  /** Never silently truncate legacy arrays: direct large callers to bounded reads. */
  async legacyJobs(where: string, values: (string | number)[]): Promise<SocialJob[]> {
    const rows = await this.store.db
      .prepare(
        `SELECT value FROM social_jobs_all WHERE ${where} ORDER BY scheduled_at,id LIMIT 1001`,
      )
      .all(...values);
    if (rows.length > 1000)
      throw new Error(
        "Social job history exceeds the legacy response capacity. Use jobs.status or campaigns.status with page=true, or workspace.snapshot for the workspace.",
      );
    return rows.map((row) => JSON.parse(String(row.value)) as SocialJob);
  }
  async jobPage(where: string, values: (string | number)[], input: Record<string, unknown>) {
    const offset = finite(input.offset ?? 0, "job offset", 0, Number.MAX_SAFE_INTEGER);
    const limit = finite(input.limit ?? 50, "job limit", 1, 100);
    if (!Number.isInteger(offset) || !Number.isInteger(limit)) throw new Error("Invalid job page.");
    const total = await this.jobCount(where, values);
    const jobs = (
      await this.store.db
        .prepare(
          `SELECT value FROM social_jobs_all WHERE ${where} ORDER BY scheduled_at,id LIMIT ? OFFSET ?`,
        )
        .all(...values, limit, offset)
    ).map((row) => JSON.parse(String(row.value)) as SocialJob);
    return {
      jobs,
      page: {
        offset,
        limit,
        total,
        ...(offset + jobs.length < total ? { nextOffset: offset + jobs.length } : {}),
      },
    };
  }
  async jobExists(where: string, values: (string | number)[] = []): Promise<boolean> {
    return !!(await this.store.db
      .prepare(`SELECT 1 FROM social_jobs_all WHERE ${where} LIMIT 1`)
      .get(...values));
  }
  async firstJob(where: string, values: (string | number)[]): Promise<SocialJob | undefined> {
    const row = await this.store.db
      .prepare(`SELECT value FROM social_jobs_all WHERE ${where} ORDER BY scheduled_at,id LIMIT 1`)
      .get(...values);
    return row ? (JSON.parse(String(row.value)) as SocialJob) : undefined;
  }
  async jobCount(where: string, values: (string | number)[]): Promise<number> {
    return Number(
      (await this.store.db
        .prepare(`SELECT COUNT(*) AS total FROM social_jobs_all WHERE ${where}`)
        .get(...values))!.total,
    );
  }
  /** Recovery/mutation walks keep every relevant owner without materializing history. */
  async *jobPages(where: string, values: (string | number)[]): AsyncGenerator<SocialJob[]> {
    let after: string | undefined;
    for (;;) {
      const rows = await this.store.db
        .prepare(
          `SELECT id,value FROM social_jobs_all WHERE ${where}${after === undefined ? "" : " AND id>?"} ORDER BY id LIMIT 128`,
        )
        .all(...values, ...(after === undefined ? [] : [after]));
      if (!rows.length) return;
      yield rows.map((row) => JSON.parse(String(row.value)) as SocialJob);
      after = String(rows[rows.length - 1].id);
      if (rows.length < 128) return;
    }
  }
  async status() {
    const row = await this.store.db
      .prepare(`SELECT
      (SELECT count(*) FROM social_jobs) AS hot,
      (SELECT count(*) FROM social_jobs_cold) AS cold`)
      .get();
    return { hot: Number(row?.hot ?? 0), cold: Number(row?.cold ?? 0), settledHotTarget: 1000 };
  }

  async compactIfDue(): Promise<void> {
    const now = performance.now();
    if (now < this.nextCompactionAt) return;
    this.nextCompactionAt = now + 60_000;
    await this.compact();
  }

  /** Keep recent settled work hot; all cold payloads and dedupe evidence stay readable. */
  async compact(): Promise<void> {
    const rows = await this.store.db
      .prepare(`SELECT id FROM social_jobs
      WHERE json_type(value,'$.preparation') IS NULL AND json_type(value,'$.delivery') IS NULL
        AND ((status IN ('cancelled','failed') AND json_type(value,'$.dispatchedAt') IS NULL)
          OR (status='succeeded' AND COALESCE(json_extract(value,'$.platformId'),'')!=''))
      ORDER BY scheduled_at DESC,id DESC LIMIT 100 OFFSET 1000`)
      .all();
    if (rows.length) await this.archive(rows.map((row) => String(row.id)));
  }

  /** Owner-initiated bounded move. Exclude unresolved, prepared or dispatched failures. */
  async archive(ids: string[]): Promise<{ archived: string[]; retained: string[] }> {
    if (
      !ids.length ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !id || id.length > 200)
    )
      throw new Error("Choose one to 100 distinct social job IDs.");
    return this.store.transaction(async () => {
      const archived: string[] = [],
        retained: string[] = [];
      for (const id of ids) {
        const row = await this.store.db.prepare("SELECT * FROM social_jobs WHERE id=?").get(id);
        if (!row) {
          retained.push(id);
          continue;
        }
        const job = JSON.parse(String(row.value)) as {
          status: string;
          dispatchedAt?: number;
          preparation?: unknown;
          platformId?: string;
          delivery?: unknown;
        };
        const eligible =
          job.status === row.status &&
          !job.preparation &&
          !job.delivery &&
          ((job.status === "cancelled" && job.dispatchedAt === undefined) ||
            (job.status === "failed" && job.dispatchedAt === undefined) ||
            (job.status === "succeeded" && typeof job.platformId === "string" && !!job.platformId));
        if (!eligible) {
          retained.push(id);
          continue;
        }
        await this.store.db
          .prepare("INSERT INTO social_jobs_cold VALUES (?,?,?,?,?,?)")
          .run(row.id, row.dedupe_key, row.account_id, row.status, row.scheduled_at, row.value);
        const removed = await this.store.db
          .prepare("DELETE FROM social_jobs WHERE id=? AND value=?")
          .run(id, row.value);
        if (Number(removed.changes) !== 1) throw new Error("Social job changed during archival.");
        archived.push(id);
      }
      return { archived, retained };
    });
  }
}

function finite(
  value: unknown,
  field: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${field}.`);
  return value;
}
