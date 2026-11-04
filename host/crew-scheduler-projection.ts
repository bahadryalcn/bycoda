import type { HostStore } from "./store";
import type { CrewRun } from "../src/features/crews/model/crew";

const key = "crews.v1";
// Built-in SQLite JSON only: legacy writers need no process-local hook. Invalid
// source remains invalid, rather than turning a failed read into an idle crew.
const valid = (source: string) => `CASE WHEN json_valid(${source}) THEN CASE
  WHEN json_type(${source})='object' AND json_type(${source},'$.runs')='array'
  THEN NOT EXISTS(SELECT 1 FROM json_each(${source},'$.runs') WHERE CASE
    WHEN type!='object' THEN 1
    WHEN json_type(value,'$.coordinatorSessionId') NOT IN ('text','null') THEN 1
    ELSE 0 END)
  ELSE 0 END ELSE 0 END`;
// Delete then insert avoids inheriting an outer legacy INSERT OR IGNORE/REPLACE
// conflict policy when refreshing the singleton marker inside its trigger.
const rebuild = (source: string) => `
  DELETE FROM crew_scheduler_active_v1;
  DELETE FROM crew_scheduler_source_v1;
  INSERT INTO crew_scheduler_source_v1(singleton,valid) VALUES(1,${valid(source)});
  INSERT INTO crew_scheduler_active_v1(ordinal,payload)
  SELECT CAST(key AS INTEGER),value FROM json_each(
    CASE WHEN (SELECT valid FROM crew_scheduler_source_v1 WHERE singleton=1)=1 THEN ${source} ELSE '{"runs":[]}' END,'$.runs')
  WHERE json_extract(value,'$.status')='active'
    AND COALESCE(json_extract(value,'$.coordinatorSessionId'),'')!='';`;

/** Startup backfill and all subsequent legacy writes share SQLite atomicity. */
export async function initializeCrewSchedulerProjection(store: HostStore): Promise<void> {
  await store.transaction(async () => {
    await store.db.exec(`
      CREATE TABLE IF NOT EXISTS crew_scheduler_source_v1 (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), valid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS crew_scheduler_active_v1 (
        ordinal INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS crew_scheduler_insert_v1 AFTER INSERT ON metadata
        WHEN NEW.key='crews.v1' BEGIN ${rebuild("NEW.value")} END;
      CREATE TRIGGER IF NOT EXISTS crew_scheduler_update_v1 AFTER UPDATE ON metadata
        WHEN OLD.key='crews.v1' OR NEW.key='crews.v1' BEGIN
        ${rebuild("CASE WHEN NEW.key='crews.v1' THEN NEW.value ELSE '{\"runs\":[]}' END")} END;
      CREATE TRIGGER IF NOT EXISTS crew_scheduler_delete_v1 AFTER DELETE ON metadata
        WHEN OLD.key='crews.v1' BEGIN ${rebuild("'{\"runs\":[]}'")} END;
      ${rebuild("COALESCE((SELECT value FROM metadata WHERE key='crews.v1'),'{\"runs\":[]}')")}
    `);
  });
}

export async function readCrewSchedulerRuns(store: HostStore): Promise<CrewRun[]> {
  // One statement means marker and payloads observe the same committed snapshot,
  // including another connection's activation/deletion and transaction rollback.
  const rows = await store.db.prepare(`SELECT source.valid,active.payload
    FROM crew_scheduler_source_v1 source LEFT JOIN crew_scheduler_active_v1 active ON 1=1
    WHERE source.singleton=1 ORDER BY active.ordinal`).all();
  if (!rows.length || rows.some((row) => row.valid !== 1))
    throw new Error("Crew scheduler source is invalid or unavailable.");
  return rows.flatMap((row) => row.payload === null ? [] : [JSON.parse(String(row.payload)) as CrewRun]);
}

/** Caller holds BEGIN IMMEDIATE. Decode one current run, never canonical history. */
export async function readCrewSchedulerRun(store: HostStore, id: string) {
  if (!store.transactionActive) throw new Error("Crew scheduler run reads require a transaction.");
  const row = await store.db.prepare(`SELECT CAST(entry.key AS INTEGER) AS ordinal,entry.value AS payload
    FROM metadata,json_each(metadata.value,'$.runs') entry
    WHERE metadata.key=? AND json_extract(entry.value,'$.id')=? ORDER BY CAST(entry.key AS INTEGER) LIMIT 1`)
    .get(key, id);
  return row ? { ordinal: Number(row.ordinal), run: JSON.parse(String(row.payload)) as CrewRun } : undefined;
}

/** Preserve every unrelated field and run; JSON traversal/rewrite stays in SQLite. */
export async function patchCrewSchedulerRun(
  store: HostStore, ordinal: number, run: CrewRun, fields: ReadonlyArray<keyof CrewRun>,
): Promise<void> {
  if (!store.transactionActive) throw new Error("Crew scheduler patches require a transaction.");
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error("Invalid Crew run ordinal.");
  const set: string[] = [];
  const remove: string[] = [];
  const setParams: string[] = [];
  const removeParams: string[] = [];
  for (const field of fields) {
    const path = `$.runs[${ordinal}].${field}`;
    if (run[field] === undefined) {
      remove.push("?");
      removeParams.push(path);
    } else {
      set.push("?,json(?)");
      setParams.push(path, JSON.stringify(run[field]));
    }
  }
  let expression = set.length ? `json_set(value,${set.join(",")})` : "value";
  if (remove.length) expression = `json_remove(${expression},${remove.join(",")})`;
  const params = [...setParams, ...removeParams];
  await store.db.prepare(`UPDATE metadata SET value=${expression} WHERE key=?`).run(...params, key);
  store.afterCommit(() => store.changes.notify());
}
