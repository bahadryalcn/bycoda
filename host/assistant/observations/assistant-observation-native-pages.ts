import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { HostStore } from "../../store";

const pageSchema = z.strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).max(2048), nextOffset: z.number().int().min(0).max(2048), total: z.number().int().min(0).max(2048), watermark: z.number().int().nonnegative().safe().optional(), sourceGap: z.boolean().optional(), entries: z.array(z.strictObject({ sourceId: z.string().min(1).max(200), revision: z.number().int().nonnegative().safe() })).max(8) });
export type NativePageScope = { threadId: string; installationId: string; generation: string; consumer: string; source: "note" | "server" | "native-session" };
/** fetch must verify exact signed Native page, live Host/Room/issuer and capture. */
export type NativePageFetcher = (offset: number, fingerprint?: string) => Promise<unknown>;

export class AssistantObservationNativePages {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() => store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_observation_native_pages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, installation_id TEXT NOT NULL, generation TEXT NOT NULL,
      consumer TEXT NOT NULL, source TEXT NOT NULL, fingerprint TEXT NOT NULL, count INTEGER NOT NULL,
      floor INTEGER NOT NULL, covered INTEGER NOT NULL, offered INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS assistant_observation_native_completion (
      snapshot_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, watermark INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS assistant_observation_native_coverage (
      thread_id TEXT NOT NULL, installation_id TEXT NOT NULL, generation TEXT NOT NULL, consumer TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY(thread_id, installation_id, generation, consumer, source)
    )`));
  }
  async uncertain(scope: NativePageScope) {
    await this.ready;
    return !!(await this.store.db.prepare(`SELECT 1 FROM assistant_observation_native_completion c JOIN assistant_observation_native_pages p ON p.id=c.snapshot_id
      WHERE p.thread_id=? AND p.installation_id=? AND p.generation=? AND p.consumer=? AND p.source=? LIMIT 1`)
      .get(scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source));
  }
  async covered(scope: NativePageScope) {
    await this.ready;
    return !!(await this.store.db.prepare("SELECT 1 FROM assistant_observation_native_coverage WHERE thread_id=? AND installation_id=? AND generation=? AND consumer=? AND source=?")
      .get(scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source));
  }
  async page(scope: NativePageScope, offset: number, snapshotId: string | undefined, fetch: NativePageFetcher, valid: () => boolean, finalize?: (request: { requestId: string; fingerprint: string; watermark: number }) => Promise<void>) {
    await this.ready;
    if (!valid() || !Number.isSafeInteger(offset) || offset < 0 || offset > 2048 || !["note", "server", "native-session"].includes(scope.source)) throw new Error("Native observation capture unavailable.");
    const state = snapshotId ? await this.store.db.prepare("SELECT * FROM assistant_observation_native_pages WHERE id=?").get(snapshotId) : undefined;
    if (snapshotId && (!state || state.thread_id !== scope.threadId || state.installation_id !== scope.installationId || state.generation !== scope.generation || state.consumer !== scope.consumer || state.source !== scope.source || Number(state.expires_at) <= Date.now())) throw new Error("Native observation baseline expired.");
    if (!snapshotId && offset !== 0) throw new Error("Native observation baseline must start at zero.");
    const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
    if (state && Number(state.floor) !== floor) throw new Error("Observation retention changed during baseline.");
    const page = pageSchema.parse(await fetch(offset, state ? String(state.fingerprint) : undefined));
    if (!valid() || page.watermark === undefined || page.sourceGap === undefined || page.offset !== offset || page.nextOffset !== Math.min(offset + 8, page.total) || page.entries.length !== page.nextOffset - offset || (state && (state.fingerprint !== page.fingerprint || Number(state.count) !== page.total))) throw new Error("Native observation baseline changed.");
    if (page.sourceGap && state && snapshotId && offset === page.total && Number(state.covered) === page.total) {
      const request = await this.store.transaction(async () => {
        if (!valid() || floor !== Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence)) throw new Error("Native observation capture changed.");
        if (await this.store.db.prepare("SELECT snapshot_id FROM assistant_observation_native_completion WHERE snapshot_id=?").get(snapshotId)) return null;
        if (!finalize) return null;
        const request = { requestId: randomUUID(), fingerprint: page.fingerprint, watermark: page.watermark! };
        await this.store.db.prepare("INSERT INTO assistant_observation_native_completion VALUES(?,?,?,?)").run(snapshotId, request.requestId, request.fingerprint, request.watermark);
        return request;
      });
      if (!request) return { complete: false, value: { kind: "current-metadata-baseline", coverage: [scope.source], snapshotId, missingChangesReplayed: false, reason: "Server baseline completion is unavailable or uncertain; start a fresh baseline." } };
      try { await finalize!(request); } catch { return { complete: false, value: { kind: "current-metadata-baseline", coverage: [scope.source], snapshotId, missingChangesReplayed: false, reason: "Server baseline completion is uncertain; start a fresh baseline." } }; }
      if (!valid()) throw new Error("Native observation capture changed.");
    }
    return this.store.transaction(async () => {
      if (!valid() || floor !== Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence)) throw new Error("Native observation authority or retention changed.");
      await this.store.db.prepare("DELETE FROM assistant_observation_native_pages WHERE expires_at<=? AND id NOT IN (SELECT snapshot_id FROM assistant_observation_native_completion)").run(Date.now());
      let id = snapshotId, current = state;
      if (!id) {
        if (Number((await this.store.db.prepare("SELECT COUNT(*) AS count FROM assistant_observation_native_pages").get())!.count) >= 1000) throw new Error("Native observation baseline capacity reached.");
        id = randomUUID();
        await this.store.db.prepare("INSERT INTO assistant_observation_native_pages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source, page.fingerprint, page.total, floor, -1, -1, Date.now() + 3600000);
        current = await this.store.db.prepare("SELECT * FROM assistant_observation_native_pages WHERE id=?").get(id);
      } else {
        current = await this.store.db.prepare("SELECT * FROM assistant_observation_native_pages WHERE id=?").get(id);
        if (!current || current.fingerprint !== page.fingerprint || Number(current.expires_at) <= Date.now()) throw new Error("Native observation baseline expired.");
      }
      const covered = Number(current!.covered), offered = Number(current!.offered);
      const base = { kind: "current-metadata-baseline", coverage: [scope.source], missingChangesReplayed: false };
      if (offset === page.total && covered === page.total) {
        if (page.sourceGap && !(await this.store.db.prepare("SELECT snapshot_id FROM assistant_observation_native_completion WHERE snapshot_id=?").get(id))) throw new Error("Native baseline completion receipt unavailable.");
        await this.store.db.prepare("INSERT OR IGNORE INTO assistant_observation_native_coverage VALUES(?,?,?,?,?)")
          .run(scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source);
        await this.store.db.prepare(`DELETE FROM assistant_observation_native_completion WHERE snapshot_id IN
          (SELECT id FROM assistant_observation_native_pages WHERE thread_id=? AND installation_id=? AND generation=? AND consumer=? AND source=?)`)
          .run(scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source);
        await this.store.db.prepare("DELETE FROM assistant_observation_native_pages WHERE thread_id=? AND installation_id=? AND generation=? AND consumer=? AND source=?")
          .run(scope.threadId, scope.installationId, scope.generation, scope.consumer, scope.source);
        return { complete: true, value: { ...base, entries: [], pagesDelivered: true } };
      }
      if (offset !== Math.max(0, covered) || (offered !== covered && offered !== page.nextOffset)) throw new Error("Native observation baseline pages must be delivered in order.");
      await this.store.db.prepare("UPDATE assistant_observation_native_pages SET offered=? WHERE id=?").run(page.nextOffset, id);
      if (!valid()) throw new Error("Native observation capture changed.");
      const entries = page.entries.map(item => ({ source: scope.source, sourceId: `native-${scope.source}:${createHash("sha256").update(JSON.stringify([scope.installationId, item.sourceId])).digest("hex")}`, revision: item.revision ? `native:${item.revision}` : null }));
      return { complete: false, value: { ...base, snapshotId: id, offset, nextOffset: page.nextOffset, entries } };
    });
  }
  async delivered(scope: NativePageScope, snapshotId: string, offset: number, nextOffset: number, valid: () => boolean) {
    await this.ready;
    await this.store.transaction(async () => {
      if (!valid()) throw new Error("Native observation capture changed.");
      const row = await this.store.db.prepare("SELECT * FROM assistant_observation_native_pages WHERE id=?").get(snapshotId);
      if (!row || row.thread_id !== scope.threadId || row.installation_id !== scope.installationId || row.generation !== scope.generation || row.consumer !== scope.consumer || row.source !== scope.source || Number(row.expires_at) <= Date.now()) throw new Error("Native observation baseline receipt expired.");
      if (Number(row.floor) !== Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence)) throw new Error("Observation retention changed during baseline.");
      if (Number(row.covered) === nextOffset && Number(row.offered) === nextOffset) return;
      if (Math.max(0, Number(row.covered)) !== offset || Number(row.offered) !== nextOffset || nextOffset < offset || (nextOffset === offset && Number(row.count) !== 0)) throw new Error("Native observation baseline page was not offered.");
      await this.store.db.prepare("UPDATE assistant_observation_native_pages SET covered=? WHERE id=?").run(nextOffset, snapshotId);
      if (!valid()) throw new Error("Native observation capture changed.");
    });
  }
}
