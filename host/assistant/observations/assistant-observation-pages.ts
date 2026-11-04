import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../../store";

type Entry = { source: "social"; sourceId: string; revision: string | null };
type PageScope = { threadId: string; accountId: string; version: string; consumer: string };

/** Metadata-only page receipts; no page is covered until its actual provider call settles. */
export class AssistantObservationPages {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() => store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_observation_pages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, account_id TEXT NOT NULL, version TEXT NOT NULL,
      consumer TEXT NOT NULL, fingerprint TEXT NOT NULL, count INTEGER NOT NULL, covered INTEGER NOT NULL,
      offered INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`));
  }
  private async baseline(accountId: string) {
    const rows = await this.store.db.prepare(`SELECT source.source_id,revision.version FROM (SELECT kind || ':' || id AS source_id FROM social_records
      WHERE kind IN ('thread','draft') AND json_extract(value,'$.accountId')=?
        AND (json_extract(value,'$.projectId') IS NULL OR json_extract(value,'$.projectId')='')
      UNION ALL SELECT 'job:' || id AS source_id FROM social_jobs
      WHERE account_id=? AND COALESCE(json_array_length(json_extract(value,'$.projectIds')),0)=0
      ) AS source LEFT JOIN assistant_observation_source_revisions revision ON revision.source='social' AND revision.source_id=source.source_id
      ORDER BY source.source_id LIMIT 2049`).all(accountId, accountId);
    const entries: Entry[] = rows.map(row => ({ source: "social", sourceId: String(row.source_id), revision: row.version == null ? null : `db:${row.version}` }));
    const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
    return { entries, fingerprint: createHash("sha256").update(JSON.stringify([entries, floor])).digest("hex") };
  }
  async page(scope: PageScope, offset: number, snapshotId: string | undefined, valid: () => boolean) {
    await this.ready;
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Observation source access changed.");
      await this.store.db.prepare("DELETE FROM assistant_observation_pages WHERE expires_at<=?").run(Date.now());
      const { entries, fingerprint } = await this.baseline(scope.accountId);
      const base = { kind: "current-metadata-baseline", coverage: ["social-thread", "social-draft", "social-job"], missingChangesReplayed: false };
      if (entries.length > 2048 || Buffer.byteLength(JSON.stringify(entries), "utf8") > 524288) return { complete: false, value: { ...base, reason: "Baseline exceeds the 2048-row or 512 KiB metadata limit; recovery requires a narrower source." } };
      let id = snapshotId;
      let state = id ? await this.store.db.prepare("SELECT * FROM assistant_observation_pages WHERE id=?").get(id) : undefined;
      if (!id && offset === 0) {
        const count = Number((await this.store.db.prepare("SELECT COUNT(*) AS count FROM assistant_observation_pages").get())!.count);
        if (count >= 1000) throw new Error("Observation baseline receipt capacity reached.");
        id = randomUUID();
        await this.store.db.prepare("INSERT INTO assistant_observation_pages VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, scope.threadId, scope.accountId, scope.version, scope.consumer, fingerprint, entries.length, -1, -1, Date.now() + 3600000);
        state = await this.store.db.prepare("SELECT * FROM assistant_observation_pages WHERE id=?").get(id);
      }
      if (!state || state.thread_id !== scope.threadId || state.account_id !== scope.accountId || state.version !== scope.version || state.consumer !== scope.consumer || state.fingerprint !== fingerprint || Number(state.count) !== entries.length)
        throw new Error("Observation baseline changed or expired. Restart at offset zero.");
      if (!id) throw new Error("Observation baseline identity is unavailable.");
      const covered = Number(state.covered), offered = Number(state.offered);
      if (offset === entries.length && covered === entries.length) {
        await this.store.db.prepare("DELETE FROM assistant_observation_pages WHERE id=?").run(id);
        return { complete: true, value: { ...base, entries: [], pagesDelivered: true } };
      }
      if (offset !== Math.max(0, covered) || (offered !== covered && offered !== Math.min(offset + 8, entries.length))) throw new Error("Observation baseline pages must be delivered in order.");
      const end = Math.min(offset + 8, entries.length);
      await this.store.db.prepare("UPDATE assistant_observation_pages SET offered=? WHERE id=?").run(end, id);
      if (!valid()) throw new Error("Observation source access changed.");
      return { complete: false, value: { ...base, snapshotId: id, offset, nextOffset: end, entries: entries.slice(offset, end) } };
    });
  }
  async delivered(scope: PageScope, snapshotId: string, offset: number, nextOffset: number, valid: () => boolean) {
    await this.ready;
    await this.store.transaction(async () => {
      if (!valid()) throw new Error("Observation source access changed.");
      const row = await this.store.db.prepare("SELECT * FROM assistant_observation_pages WHERE id=?").get(snapshotId);
      if (!row || row.thread_id !== scope.threadId || row.account_id !== scope.accountId || row.version !== scope.version || row.consumer !== scope.consumer || Number(row.expires_at) <= Date.now()) throw new Error("Observation baseline receipt expired.");
      const current = await this.baseline(scope.accountId);
      if (current.fingerprint !== row.fingerprint) throw new Error("Observation baseline changed. Restart at offset zero.");
      if (Number(row.covered) === nextOffset && Number(row.offered) === nextOffset) return;
      if (Math.max(0, Number(row.covered)) !== offset || Number(row.offered) !== nextOffset || nextOffset < offset || (nextOffset === offset && Number(row.count) !== 0)) throw new Error("Observation baseline page was not offered.");
      await this.store.db.prepare("UPDATE assistant_observation_pages SET covered=? WHERE id=?").run(nextOffset, snapshotId);
      if (!valid()) throw new Error("Observation source access changed.");
    });
  }
}
