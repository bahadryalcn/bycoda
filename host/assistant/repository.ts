import type { HostStore } from "../store";

export const assistantTables = [
  "profile",
  "memory",
  "threads",
  "messages",
  "jobs",
  "activity",
  "runtime",
  "notetrash",
] as const;
export type AssistantTable = (typeof assistantTables)[number];
export type RecordValue = { id: string; version: number; createdAt: number; updatedAt: number };
export class AssistantRepository {
  constructor(readonly store: HostStore) {}
  async initialize() {
    await this.store.ready;
    await this.store.db.scope(async () => {
      for (const table of assistantTables) {
        await this.store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_${table} (
          id TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, deleted_at INTEGER, request_key TEXT UNIQUE
        ); CREATE INDEX IF NOT EXISTS assistant_${table}_recent ON assistant_${table}(deleted_at,updated_at DESC);`);
      }
      await this.store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_request_tombstones(
        table_name TEXT NOT NULL,request_key TEXT NOT NULL,record_id TEXT NOT NULL,
        PRIMARY KEY(table_name,request_key)
      );`);
      await this.store.db
        .exec(`CREATE VIRTUAL TABLE IF NOT EXISTS assistant_messages_search USING fts5(id UNINDEXED,thread_id UNINDEXED,text);
        CREATE TRIGGER IF NOT EXISTS assistant_messages_search_insert AFTER INSERT ON assistant_messages WHEN NEW.deleted_at IS NULL BEGIN
          INSERT INTO assistant_messages_search(id,thread_id,text) VALUES(NEW.id,json_extract(NEW.value,'$.threadId'),json_extract(NEW.value,'$.text')); END;
        CREATE TRIGGER IF NOT EXISTS assistant_messages_search_update AFTER UPDATE ON assistant_messages BEGIN
          DELETE FROM assistant_messages_search WHERE id=OLD.id;
          INSERT INTO assistant_messages_search(id,thread_id,text) SELECT NEW.id,json_extract(NEW.value,'$.threadId'),json_extract(NEW.value,'$.text') WHERE NEW.deleted_at IS NULL; END;
        CREATE TRIGGER IF NOT EXISTS assistant_messages_search_delete AFTER DELETE ON assistant_messages BEGIN
          DELETE FROM assistant_messages_search WHERE id=OLD.id; END;
        INSERT INTO assistant_messages_search(id,thread_id,text) SELECT id,json_extract(value,'$.threadId'),json_extract(value,'$.text') FROM assistant_messages
          WHERE deleted_at IS NULL AND id NOT IN (SELECT id FROM assistant_messages_search);`);
      await this.store.db.exec(
        "CREATE INDEX IF NOT EXISTS assistant_messages_thread_created ON assistant_messages(json_extract(value,'$.threadId'),json_extract(value,'$.createdAt') DESC) WHERE deleted_at IS NULL",
      );
    });
  }
  async get<T>(table: AssistantTable, id: string, deleted = false): Promise<T | undefined> {
    const row = await this.store.db
      .prepare(
        `SELECT value FROM assistant_${table} WHERE id=? ${deleted ? "" : "AND deleted_at IS NULL"}`,
      )
      .get(id);
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  async byKey<T>(table: AssistantTable, key: string): Promise<T | undefined> {
    const row = await this.store.db
      .prepare(`SELECT value,deleted_at FROM assistant_${table} WHERE request_key=?`)
      .get(key);
    if (row?.deleted_at != null)
      throw new Error("This request was deleted; restore it instead of replaying it.");
    if (
      !row &&
      (await this.store.db
        .prepare(
          "SELECT record_id FROM assistant_request_tombstones WHERE table_name=? AND request_key=?",
        )
        .get(table, key))
    )
      throw new Error("This request was permanently deleted and cannot be replayed.");
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  async list<T>(table: AssistantTable, limit = 100): Promise<T[]> {
    const rows = await this.store.db
      .prepare(
        `SELECT value FROM assistant_${table} WHERE deleted_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((row) => JSON.parse(row.value) as T);
  }
  async memory<T>(limit = 10000): Promise<T[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_memory WHERE deleted_at IS NULL ORDER BY CASE json_extract(value,'$.kind') WHEN 'rule' THEN 0 WHEN 'profile' THEN 1 ELSE 2 END,updated_at DESC,id DESC LIMIT ?",
      )
      .all(limit);
    return rows.map((row) => JSON.parse(row.value) as T);
  }
  async searchMemory<T>(query: string, scope: string | undefined, limit: number): Promise<T[]> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_memory WHERE deleted_at IS NULL AND instr(lower(json_extract(value,'$.text')),lower(?))>0 AND (? IS NULL OR json_extract(value,'$.scope')='all' OR json_extract(value,'$.scope')=?) ORDER BY updated_at DESC,id DESC LIMIT ?",
      )
      .all(query, scope ?? null, scope ?? null, limit);
    return rows.map((row) => JSON.parse(row.value) as T);
  }
  async messages<T>(
    threadId: string,
    limit: number,
    before?: number,
    beforeId?: string,
  ): Promise<T[]> {
    if (beforeId !== undefined)
      return this.store.transaction(async () => {
        const cursor = await this.store.db
          .prepare(
            "SELECT rowid AS cursor_rowid,json_extract(value,'$.threadId') AS thread_id,json_extract(value,'$.createdAt') AS created_at FROM assistant_messages WHERE id=? AND deleted_at IS NULL",
          )
          .get(beforeId);
        if (
          before === undefined ||
          !cursor ||
          cursor.thread_id !== threadId ||
          cursor.created_at !== before
        )
          throw new Error(
            "The conversation history cursor changed or is unavailable. Reload its original conversation.",
          );
        const rows = await this.store.db
          .prepare(
            "SELECT value FROM assistant_messages WHERE deleted_at IS NULL AND json_extract(value,'$.threadId')=? AND (json_extract(value,'$.createdAt')<? OR (json_extract(value,'$.createdAt')=? AND rowid<?)) ORDER BY json_extract(value,'$.createdAt') DESC,rowid DESC LIMIT ?",
          )
          .all(threadId, before, before, cursor.cursor_rowid, limit);
        return rows.map((row) => JSON.parse(row.value) as T).reverse();
      }, "critical");
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_messages WHERE deleted_at IS NULL AND json_extract(value,'$.threadId')=? AND (? IS NULL OR json_extract(value,'$.createdAt')<?) ORDER BY json_extract(value,'$.createdAt') DESC,rowid DESC LIMIT ?",
      )
      .all(threadId, before ?? null, before ?? null, limit);
    return rows.map((row) => JSON.parse(row.value) as T).reverse();
  }
  async searchMessages<T>(
    query: string,
    threadId: string | undefined,
    limit: number,
  ): Promise<T[]> {
    const phrase = `"${query.replaceAll('"', '""')}"`;
    const rows = await this.store.db
      .prepare(
        "SELECT m.value FROM assistant_messages m JOIN assistant_messages_search s ON s.id=m.id WHERE assistant_messages_search MATCH ? AND m.deleted_at IS NULL AND (? IS NULL OR s.thread_id=?) ORDER BY rank LIMIT ?",
      )
      .all(phrase, threadId ?? null, threadId ?? null, limit);
    return rows.map((row) => JSON.parse(row.value) as T);
  }
  async put<T extends RecordValue>(
    table: AssistantTable,
    value: T,
    expectedVersion?: number,
    key?: string,
  ) {
    const row = await this.store.db
      .prepare(`SELECT version,deleted_at FROM assistant_${table} WHERE id=?`)
      .get(value.id);
    if (row && row.deleted_at != null) throw new Error("Record is deleted; restore it first.");
    if (expectedVersion !== undefined && (row?.version ?? 0) !== expectedVersion)
      throw new Error("Assistant record changed; reload before saving.");
    const next = { ...value, version: (row?.version ?? 0) + 1 };
    await this.store.db
      .prepare(`INSERT INTO assistant_${table}(id,value,version,updated_at,request_key) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at`)
      .run(next.id, JSON.stringify(next), next.version, next.updatedAt, key ?? null);
    return next;
  }
  async purge(table: AssistantTable, id: string) {
    const row = await this.store.db
      .prepare(`SELECT request_key,deleted_at FROM assistant_${table} WHERE id=?`)
      .get(id);
    if (!row || row.deleted_at == null)
      throw new Error("Only a deleted assistant record can be permanently removed.");
    if (row.request_key)
      await this.store.db
        .prepare(
          "INSERT OR IGNORE INTO assistant_request_tombstones(table_name,request_key,record_id) VALUES (?,?,?)",
        )
        .run(table, row.request_key, id);
    await this.store.db.prepare(`DELETE FROM assistant_${table} WHERE id=?`).run(id);
  }
  async trash(table: AssistantTable, id: string, expectedVersion: number, now: number) {
    const row = await this.store.db
      .prepare(`SELECT version FROM assistant_${table} WHERE id=? AND deleted_at IS NULL`)
      .get(id);
    if (!row || row.version !== expectedVersion)
      throw new Error("Assistant record changed; reload before deleting.");
    await this.store.db
      .prepare(`UPDATE assistant_${table} SET deleted_at=? WHERE id=?`)
      .run(now, id);
  }
}
