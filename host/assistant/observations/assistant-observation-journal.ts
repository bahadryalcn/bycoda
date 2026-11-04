import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { HostStore } from "../../store";

/** A canonical owner may append only metadata, inside the same store transaction as its change. */
export type AssistantObservation = {
  source: "session" | "native-session" | "task" | "goal" | "crew" | "note" | "social" | "server";
  sourceId: string;
  sourceRevision: string;
  change: "created" | "updated" | "deleted";
  projectIds: string[];
  accountId?: string;
  /** Trusted installation identity, only for unscoped Native-owned records. */
  nativeInstallationId?: string;
  hostLibrary?: true;
  producerInstallationId?: string;
  occurredAt: number;
};
type Scope = { projectId: string; accountId?: never; nativeInstallationId?: never; hostLibrary?: never } | { accountId: string; projectId?: never; nativeInstallationId?: never; hostLibrary?: never } | { nativeInstallationId: string; accountId?: never; projectId?: never; hostLibrary?: never } | { hostLibrary: true; projectId?: never; accountId?: never; nativeInstallationId?: never };
const validId = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeIdentity = (scope: Scope) => {
  if (!scope || typeof scope !== "object" || Object.keys(scope).length !== 1)
    throw new Error("Invalid observation scope.");
  if ("projectId" in scope && validId(scope.projectId!)) return `project:${scope.projectId}`;
  if ("accountId" in scope && validId(scope.accountId!)) return `account:${scope.accountId}`;
  if ("nativeInstallationId" in scope && validId(scope.nativeInstallationId!)) return `native:${scope.nativeInstallationId}`;
  if ("hostLibrary" in scope && scope.hostLibrary === true) return "host-library";
  throw new Error("Invalid observation scope.");
};

/** Durable local journal. Producer coverage must be reported separately from journal availability. */
export class AssistantObservationJournal {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(async () => { await store.db.exec(`
      CREATE TABLE IF NOT EXISTS assistant_observation_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
        dedupe TEXT NOT NULL UNIQUE, environment_id TEXT NOT NULL, source TEXT NOT NULL,
        source_id TEXT NOT NULL, source_revision TEXT NOT NULL, change_kind TEXT NOT NULL,
        project_ids TEXT NOT NULL, account_id TEXT, occurred_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS assistant_observation_source_identity
        ON assistant_observation_events(environment_id,source,source_id,source_revision);
      CREATE TABLE IF NOT EXISTS assistant_observation_consumers (
        consumer TEXT NOT NULL, scope TEXT NOT NULL, acknowledged INTEGER NOT NULL,
        offered INTEGER NOT NULL, PRIMARY KEY(consumer,scope)
      );
      CREATE TABLE IF NOT EXISTS assistant_observation_floor (
        id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO assistant_observation_floor VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS assistant_observation_retention AFTER INSERT ON assistant_observation_events BEGIN
        UPDATE assistant_observation_floor SET sequence=max(sequence,
          COALESCE((SELECT MAX(sequence) FROM assistant_observation_events WHERE expires_at<=CAST(strftime('%s','now') AS INTEGER)*1000),0),
          COALESCE((SELECT sequence FROM assistant_observation_events ORDER BY sequence DESC LIMIT 1 OFFSET 10000),0)) WHERE id=1;
        DELETE FROM assistant_observation_events WHERE sequence <= (SELECT sequence FROM assistant_observation_floor WHERE id=1);
      END;
    `);
      const columns = await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='native_installation_id'").get();
      if (!columns) {
        try { await store.db.exec("ALTER TABLE assistant_observation_events ADD COLUMN native_installation_id TEXT"); }
        catch (error) {
          if (!(await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='native_installation_id'").get())) throw error;
        }
      }
      if (!(await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='host_library'").get())) {
        try { await store.db.exec("ALTER TABLE assistant_observation_events ADD COLUMN host_library INTEGER NOT NULL DEFAULT 0"); }
        catch (error) { if (!(await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='host_library'").get())) throw error; }
      }
      if (!(await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='producer_installation_id'").get())) {
        try { await store.db.exec("ALTER TABLE assistant_observation_events ADD COLUMN producer_installation_id TEXT"); }
        catch (error) { if (!(await store.db.prepare("SELECT name FROM pragma_table_info('assistant_observation_events') WHERE name='producer_installation_id'").get())) throw error; }
      }
    });
  }
  /** Domain owners call this around their canonical mutation; failure rolls back both writes. */
  async recordMutation<T>(input: AssistantObservation, mutate: () => Promise<T>): Promise<T> {
    await this.ready;
    return this.store.transaction(async () => {
      const result = await mutate();
      await this.append(input);
      return result;
    });
  }
  async append(input: AssistantObservation) {
    await this.ready;
    if (!this.store.db.ownsScope) throw new Error("Observation must share its source transaction.");
    if (!validId(input.sourceId) || !validId(input.sourceRevision) ||
        !["session", "native-session", "task", "goal", "crew", "note", "social", "server"].includes(input.source) ||
        !["created", "updated", "deleted"].includes(input.change) ||
        !Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0 ||
        !Array.isArray(input.projectIds) || input.projectIds.length > 100 ||
        input.projectIds.some((id) => !validId(id)) ||
        (input.accountId !== undefined && !validId(input.accountId)) ||
        (input.nativeInstallationId !== undefined && (!validId(input.nativeInstallationId) || input.projectIds.length > 0 || input.accountId !== undefined)) ||
        (input.hostLibrary !== undefined && (input.hostLibrary !== true || input.projectIds.length > 0 || input.accountId !== undefined || input.nativeInstallationId !== undefined)) ||
        (input.producerInstallationId !== undefined && (!validId(input.producerInstallationId) || input.source !== "native-session" || input.projectIds.length === 0)) ||
        (input.source === "native-session" && input.producerInstallationId === undefined) ||
        (!input.projectIds.length && !input.accountId && !input.nativeInstallationId && !input.hostLibrary))
      throw new Error("Invalid observation identity or scope.");
    const projects = [...new Set(input.projectIds)].sort();
    const value = { ...input, projectIds: projects };
    const key = digest([this.store.environmentId, input.source, input.sourceId, input.sourceRevision]);
    const existing = await this.store.db.prepare("SELECT * FROM assistant_observation_events WHERE environment_id=? AND source=? AND source_id=? AND source_revision=?").get(this.store.environmentId, input.source, input.sourceId, input.sourceRevision);
    if (existing) {
      const old = { source: existing.source, sourceId: existing.source_id, sourceRevision: existing.source_revision,
        change: existing.change_kind, projectIds: JSON.parse(String(existing.project_ids)),
        ...(existing.account_id ? { accountId: existing.account_id } : {}), ...(existing.native_installation_id ? { nativeInstallationId: existing.native_installation_id } : {}), ...(existing.host_library ? { hostLibrary: true } : {}), ...(existing.producer_installation_id ? { producerInstallationId: existing.producer_installation_id } : {}), occurredAt: existing.occurred_at };
      if (!isDeepStrictEqual(old, value)) throw new Error("Observation identity was reused with different metadata.");
      return { id: String(existing.event_id), sequence: Number(existing.sequence) };
    }
    const id = randomUUID();
    const result = await this.store.db.prepare(`INSERT INTO assistant_observation_events
      (event_id,dedupe,environment_id,source,source_id,source_revision,change_kind,project_ids,account_id,occurred_at,expires_at,native_installation_id,host_library,producer_installation_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, key, this.store.environmentId, input.source, input.sourceId,
      input.sourceRevision, input.change, JSON.stringify(projects), input.accountId ?? null, input.occurredAt, Date.now() + 30 * 86400_000, input.nativeInstallationId ?? null, input.hostLibrary ? 1 : 0, input.producerInstallationId ?? null);
    return { id, sequence: Number(result.lastInsertRowid) };
  }
  async read(consumer: string, scope: Scope, authorizeScope: () => Promise<boolean>, authorize: (event: AssistantObservation) => Promise<boolean>, guard: () => boolean, limit = 50, maxBytes = 32768, source?: AssistantObservation["source"], producerInstallationId?: string) {
    await this.ready;
    if (!validId(consumer) || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 32768 ||
        ("projectId" in scope ? !validId(scope.projectId!) : "accountId" in scope ? !validId(scope.accountId!) : "nativeInstallationId" in scope ? !validId(scope.nativeInstallationId!) : scope.hostLibrary !== true))
      throw new Error("Invalid observation consumer, scope or page size.");
    const scopeKey = scopeIdentity(scope);
    if (!(await authorizeScope()) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    await this.pruneExpired();
    const snapshot = await this.store.db.scope(async () => {
      const state = await this.store.db.prepare("SELECT acknowledged FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      const cursor = Number(state?.acknowledged ?? 0);
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      if (cursor < floor) return { cursor, floor, rows: [] };
      const predicate = "projectId" in scope
        ? "EXISTS (SELECT 1 FROM json_each(e.project_ids) WHERE value=?)"
        : "accountId" in scope ? "e.account_id=? AND json_array_length(e.project_ids)=0" : "nativeInstallationId" in scope ? "e.native_installation_id=? AND e.account_id IS NULL AND json_array_length(e.project_ids)=0" : "e.host_library=? AND e.account_id IS NULL AND e.native_installation_id IS NULL AND json_array_length(e.project_ids)=0";
      const target = "projectId" in scope ? scope.projectId : "accountId" in scope ? scope.accountId : "nativeInstallationId" in scope ? scope.nativeInstallationId : 1;
      const rows = source && producerInstallationId
        ? await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? AND e.producer_installation_id=? ORDER BY e.sequence LIMIT ?`).all(cursor, target!, source, producerInstallationId, limit)
        : source
        ? await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? ORDER BY e.sequence LIMIT ?`).all(cursor, target!, source, limit)
        : await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} ORDER BY e.sequence LIMIT ?`).all(cursor, target!, limit);
      return { cursor, floor, rows };
    });
    if (!guard()) throw new Error("Observation source is unavailable or revoked.");
    if (snapshot.cursor < snapshot.floor)
      return { status: "gap" as const, cursor: snapshot.cursor, retainedAfter: snapshot.floor, events: [] };
    const events: (AssistantObservation & { environmentId: string; id: string; sequence: number; expiresAt: number })[] = [];
    let bytes = 0, oversized = false;
    for (const row of snapshot.rows) {
      const event: AssistantObservation = { source: row.source, sourceId: row.source_id, sourceRevision: row.source_revision,
        change: row.change_kind, projectIds: JSON.parse(String(row.project_ids)),
        ...(row.account_id ? { accountId: String(row.account_id) } : {}), ...(row.native_installation_id ? { nativeInstallationId: String(row.native_installation_id) } : {}), ...(row.host_library ? { hostLibrary: true as const } : {}), ...(row.producer_installation_id ? { producerInstallationId: String(row.producer_installation_id) } : {}), occurredAt: Number(row.occurred_at) };
      if (!(await authorize(event)) || !guard()) throw new Error("Observation source is unavailable or revoked.");
      const result = { ...event, environmentId: String(row.environment_id), id: String(row.event_id), sequence: Number(row.sequence), expiresAt: Number(row.expires_at) };
      const size = Buffer.byteLength(JSON.stringify(result), "utf8") + 1;
      if (bytes + size > maxBytes) { oversized = true; break; }
      bytes += size;
      events.push(result);
    }
    const offered = events.at(-1)?.sequence ?? snapshot.cursor;
    return this.store.transaction(async () => {
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      const state = await this.store.db.prepare("SELECT acknowledged FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      if (Number(state?.acknowledged ?? 0) !== snapshot.cursor || floor !== snapshot.floor)
        throw new Error("Observation cursor or retention changed. Refresh again.");
      await this.store.db.prepare(`INSERT INTO assistant_observation_consumers VALUES(?,?,?,?)
        ON CONFLICT(consumer,scope) DO UPDATE SET offered=max(offered,excluded.offered)`).run(consumer, scopeKey, snapshot.cursor, offered);
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      return { status: "ok" as const, cursor: snapshot.cursor, nextCursor: offered, events, ...(oversized ? { truncated: true } : {}) };
    });
  }
  /** Recovery status without offering any event for acknowledgement. */
  async inspectCursor(consumer: string, scope: Scope, authorizeScope: () => Promise<boolean>, guard: () => boolean) {
    await this.ready;
    if (!validId(consumer) || !(await authorizeScope()) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    const scopeKey = scopeIdentity(scope);
    await this.pruneExpired();
    const result = await this.store.db.scope(async () => {
      const state = await this.store.db.prepare("SELECT acknowledged FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      const cursor = Number(state?.acknowledged ?? 0);
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      return cursor < floor ? { status: "gap" as const, cursor, retainedAfter: floor } : { status: "ok" as const, cursor };
    });
    if (!guard() || !(await authorizeScope()) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    return result;
  }
  /** Internal recovery ticket; never return its sequence as an acknowledgement offer. */
  async inspectOversized(consumer: string, scope: Scope, authorizeScope: () => Promise<boolean>, authorizeEvent: (event: AssistantObservation) => Promise<boolean>, guard: () => boolean, maxBytes = 3000, source?: AssistantObservation["source"], producerInstallationId?: string, optional = false) {
    await this.ready;
    const scopeKey = scopeIdentity(scope);
    if (!validId(consumer) || !(await authorizeScope()) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    const snapshot = await this.store.db.scope(async () => {
      const state = await this.store.db.prepare("SELECT acknowledged FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      const cursor = Number(state?.acknowledged ?? 0);
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      if (cursor < floor) throw new Error("Observation retention changed. Refresh again.");
      const predicate = "projectId" in scope ? "EXISTS (SELECT 1 FROM json_each(e.project_ids) WHERE value=?)" : "accountId" in scope ? "e.account_id=? AND json_array_length(e.project_ids)=0" : "nativeInstallationId" in scope ? "e.native_installation_id=? AND e.account_id IS NULL AND json_array_length(e.project_ids)=0" : "e.host_library=? AND e.account_id IS NULL AND e.native_installation_id IS NULL AND json_array_length(e.project_ids)=0";
      const target = "projectId" in scope ? scope.projectId : "accountId" in scope ? scope.accountId : "nativeInstallationId" in scope ? scope.nativeInstallationId : 1;
      const row = source && producerInstallationId
        ? await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? AND e.producer_installation_id=? ORDER BY e.sequence LIMIT 1`).get(cursor, target!, source, producerInstallationId)
        : source
        ? await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? ORDER BY e.sequence LIMIT 1`).get(cursor, target!, source)
        : await this.store.db.prepare(`SELECT * FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} ORDER BY e.sequence LIMIT 1`).get(cursor, target!);
      return { cursor, floor, row };
    });
    if (!snapshot.row) { if (optional) return undefined; throw new Error("No oversized observation requires recovery."); }
    const row = snapshot.row;
    const event: AssistantObservation = { source: row.source, sourceId: row.source_id, sourceRevision: row.source_revision, change: row.change_kind, projectIds: JSON.parse(String(row.project_ids)), ...(row.account_id ? { accountId: String(row.account_id) } : {}), ...(row.native_installation_id ? { nativeInstallationId: String(row.native_installation_id) } : {}), ...(row.host_library ? { hostLibrary: true as const } : {}), ...(row.producer_installation_id ? { producerInstallationId: String(row.producer_installation_id) } : {}), occurredAt: Number(row.occurred_at) };
    const visible = { ...event, environmentId: String(row.environment_id), id: String(row.event_id), sequence: Number(row.sequence), expiresAt: Number(row.expires_at) };
    if (Buffer.byteLength(JSON.stringify(visible), "utf8") + 1 <= maxBytes) { if (optional) return undefined; throw new Error("Observation fits the normal page."); }
    if (!(await authorizeEvent(event)) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    return { cursor: snapshot.cursor, floor: snapshot.floor, sequence: Number(row.sequence), eventId: String(row.event_id), event };
  }
  async completeOversizedRecovery(consumer: string, scope: Scope, ticket: { cursor: number; floor: number; sequence: number; eventId: string; event: AssistantObservation }, authorizeScope: () => Promise<boolean>, authorizeEvent: (event: AssistantObservation) => Promise<boolean>, guard: () => boolean, source?: AssistantObservation["source"], producerInstallationId?: string) {
    const scopeKey = scopeIdentity(scope);
    if (!(await authorizeScope()) || !(await authorizeEvent(ticket.event)) || !guard()) throw new Error("Observation source is unavailable or revoked.");
    return this.store.transaction(async () => {
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      const state = await this.store.db.prepare("SELECT acknowledged FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      const predicate = "projectId" in scope ? "EXISTS (SELECT 1 FROM json_each(e.project_ids) WHERE value=?)" : "accountId" in scope ? "e.account_id=? AND json_array_length(e.project_ids)=0" : "nativeInstallationId" in scope ? "e.native_installation_id=? AND e.account_id IS NULL AND json_array_length(e.project_ids)=0" : "e.host_library=? AND e.account_id IS NULL AND e.native_installation_id IS NULL AND json_array_length(e.project_ids)=0";
      const target = "projectId" in scope ? scope.projectId : "accountId" in scope ? scope.accountId : "nativeInstallationId" in scope ? scope.nativeInstallationId : 1;
      const row = source && producerInstallationId
        ? await this.store.db.prepare(`SELECT event_id,sequence,expires_at FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? AND e.producer_installation_id=? ORDER BY e.sequence LIMIT 1`).get(ticket.cursor, target!, source, producerInstallationId)
        : source
        ? await this.store.db.prepare(`SELECT event_id,sequence,expires_at FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} AND e.source=? ORDER BY e.sequence LIMIT 1`).get(ticket.cursor, target!, source)
        : await this.store.db.prepare(`SELECT event_id,sequence,expires_at FROM assistant_observation_events e WHERE e.sequence>? AND ${predicate} ORDER BY e.sequence LIMIT 1`).get(ticket.cursor, target!);
      if (Number(state?.acknowledged ?? 0) !== ticket.cursor || floor !== ticket.floor || row?.event_id !== ticket.eventId || Number(row?.sequence) !== ticket.sequence || Number(row?.expires_at) <= Date.now())
        throw new Error("Observation cursor or retention changed. Refresh again.");
      await this.store.db.prepare(`INSERT INTO assistant_observation_consumers VALUES(?,?,?,?)
        ON CONFLICT(consumer,scope) DO UPDATE SET acknowledged=excluded.acknowledged,offered=max(offered,excluded.offered)`).run(consumer, scopeKey, ticket.sequence, ticket.sequence);
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      return ticket.sequence;
    });
  }
  async acknowledge(consumer: string, scope: Scope, sequence: number, authorize: () => Promise<boolean>, guard: () => boolean) {
    await this.ready;
    if (!validId(consumer) || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid observation acknowledgement.");
    if (!(await authorize())) throw new Error("Observation source is unavailable or revoked.");
    const scopeKey = scopeIdentity(scope);
    return this.store.transaction(async () => {
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      const state = await this.store.db.prepare("SELECT acknowledged,offered FROM assistant_observation_consumers WHERE consumer=? AND scope=?").get(consumer, scopeKey);
      if (!state || sequence < Number(state.acknowledged) || sequence > Number(state.offered)) throw new Error("Observation cursor was not offered.");
      await this.store.db.prepare("UPDATE assistant_observation_consumers SET acknowledged=? WHERE consumer=? AND scope=?").run(sequence, consumer, scopeKey);
    });
  }
  /** Called only after the owner has completed a bounded, authorized resnapshot. */
  async resumeAfterResnapshot(consumer: string, scope: Scope, expectedFloor: number, authorize: () => Promise<boolean>, guard: () => boolean) {
    await this.ready;
    if (!validId(consumer) || !Number.isSafeInteger(expectedFloor) || expectedFloor < 0 || !(await authorize())) throw new Error("Observation source is unavailable or revoked.");
    const scopeKey = scopeIdentity(scope);
    return this.store.transaction(async () => {
      if (!guard()) throw new Error("Observation source is unavailable or revoked.");
      const floor = Number((await this.store.db.prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1").get())!.sequence);
      if (floor !== expectedFloor) throw new Error("Observation retention changed during resnapshot. Refresh again.");
      await this.store.db.prepare(`INSERT INTO assistant_observation_consumers VALUES(?,?,?,?)
        ON CONFLICT(consumer,scope) DO UPDATE SET acknowledged=max(acknowledged,excluded.acknowledged),offered=max(offered,excluded.offered)`).run(consumer, scopeKey, floor, floor);
      return floor;
    });
  }
  async pruneExpired() {
    await this.ready;
    return this.store.transaction(async () => {
      await this.store.db.prepare(`UPDATE assistant_observation_floor SET sequence=max(sequence,
        COALESCE((SELECT MAX(sequence) FROM assistant_observation_events WHERE expires_at<=?),0)) WHERE id=1`).run(Date.now());
      await this.store.db.exec("DELETE FROM assistant_observation_events WHERE sequence <= (SELECT sequence FROM assistant_observation_floor WHERE id=1)");
    });
  }
  async pruneBefore(sequence: number) {
    await this.ready;
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid observation retention boundary.");
    return this.store.transaction(async () => {
      const max = Number((await this.store.db.prepare("SELECT COALESCE(MAX(sequence),0) AS value FROM assistant_observation_events").get())!.value);
      const floor = Math.min(sequence, max);
      await this.store.db.prepare("DELETE FROM assistant_observation_events WHERE sequence<=?").run(floor);
      await this.store.db.prepare("UPDATE assistant_observation_floor SET sequence=max(sequence,?) WHERE id=1").run(floor);
    });
  }
}
