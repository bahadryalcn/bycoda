import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync, backup } from "node:sqlite";

const db = new DatabaseSync(workerData.path);
let active;
let databaseClosed = false;
let cursorSequence = 0;
const cursors = new Map();
const closeCursors = (owner) => {
  for (const [id, cursor] of cursors)
    if (!owner || cursor.owner === owner) {
      cursor.iterator.return?.();
      cursors.delete(id);
    }
};
const closed = new Set();
parentPort.postMessage({ ready: true });
parentPort.on("message", async ({ id, owner, method, sql, params }) => {
  try {
    if (!Number.isSafeInteger(id) || typeof owner !== "string" || !Array.isArray(params))
      throw new Error("Invalid database request.");
    if (method === "enter") {
      if (active || closed.has(owner)) throw new Error("Database owner is unavailable or closed.");
      active = owner;
    } else {
      if (owner !== active) throw new Error("Database operation does not own the current scope.");
      if (method === "leave") {
        closeCursors(owner);
        active = undefined;
        closed.add(owner);
        if (closed.size > 1024) closed.delete(closed.values().next().value);
        if (!databaseClosed && db.isTransaction) {
          db.exec("ROLLBACK");
          throw new Error("Database owner left an open transaction; it was rolled back.");
        }
      } else if (method === "rollbackOpen") {
        if (db.isTransaction) db.exec("ROLLBACK");
      } else if (method === "durability") {
        if (db.isTransaction)
          throw new Error("Critical durability must be selected before a transaction starts.");
        if (params[0] !== 1 && params[0] !== 2) throw new Error("Invalid durability class.");
        db.exec(`PRAGMA synchronous=${params[0]}`);
      } else if (method === "backup") {
        if (db.isTransaction) throw new Error("Backup requires a settled transaction boundary.");
        if (typeof params[0] !== "string") throw new Error("Invalid backup destination.");
        const pageSize = Number(db.prepare("PRAGMA page_size").get().page_size);
        const pages = Number(db.prepare("PRAGMA page_count").get().page_count);
        if (pageSize * pages > 2 * 1024 * 1024 * 1024)
          throw new Error("Snapshot database size limit exceeded.");
        await backup(db, params[0]);
      } else if (method === "exec") db.exec(sql);
      else if (method === "close") {
        closeCursors();
        db.close();
        databaseClosed = true;
      } else if (method === "registerFunction") {
        if (sql !== "social_text_matches") throw new Error("Unknown database function.");
        db.function(sql, { deterministic: true }, (value, query, language) =>
          String(value ?? "")
            .toLocaleLowerCase(String(language || "en"))
            .includes(String(query ?? "").toLocaleLowerCase(String(language || "en")))
            ? 1
            : 0,
        );
      } else if (method === "cursorOpen") {
        if (cursors.size >= 16) throw new Error("Too many open database cursors.");
        const cursor = ++cursorSequence;
        cursors.set(cursor, { owner, iterator: db.prepare(sql).iterate(...params) });
        parentPort.postMessage({ id, value: cursor });
        return;
      } else if (method === "cursorNext" || method === "cursorClose") {
        const cursor = cursors.get(params[0]);
        if (!cursor || cursor.owner !== owner)
          throw new Error("Database cursor has no live owner.");
        if (method === "cursorClose") {
          cursor.iterator.return?.();
          cursors.delete(params[0]);
        } else {
          const rows = [];
          let bytes = 0,
            done = false;
          while (rows.length < 64 && bytes < 256 * 1024) {
            const next = cursor.iterator.next();
            if (next.done) {
              done = true;
              break;
            }
            rows.push(next.value);
            for (const value of Object.values(next.value))
              bytes +=
                typeof value === "string"
                  ? Buffer.byteLength(value)
                  : ArrayBuffer.isView(value)
                    ? value.byteLength
                    : 8;
          }
          parentPort.postMessage({ id, value: { rows, done } });
          return;
        }
      } else if (method === "get" || method === "all" || method === "run") {
        const value = db.prepare(sql)[method](...params);
        parentPort.postMessage({ id, value });
        return;
      } else throw new Error("Unknown database operation.");
    }
    parentPort.postMessage({ id });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : "Database operation failed.",
      code: error?.code,
      errcode: error?.errcode,
    });
  }
});
