import type { HostStore } from "../store";
import type { CrewRun } from "../../src/features/crews/model/crew";
import type { CrewDefaultsState } from "./crew-defaults";

type CrewState = CrewDefaultsState & { runs: CrewRun[] };

const legacyKey = "crews.v1";
const stateKey = "crews.v2.state";
const markerKey = "crews.v2.migrated";

/** One atomic migration, retaining the exact legacy source as a recovery backup. */
export async function initializeCrewSchedulerProjection(store: HostStore): Promise<void> {
  await store.transaction(async () => {
    await store.db.exec(`CREATE TABLE IF NOT EXISTS crew_runs_v2 (
      ordinal INTEGER PRIMARY KEY, run_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL,
      coordinator_session_id TEXT, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS crew_runs_v2_id ON crew_runs_v2(run_id, ordinal);
      CREATE INDEX IF NOT EXISTS crew_runs_v2_project ON crew_runs_v2(project_id, ordinal);
      CREATE INDEX IF NOT EXISTS crew_runs_v2_project_status ON crew_runs_v2(project_id, status, ordinal);
      CREATE INDEX IF NOT EXISTS crew_runs_v2_history ON crew_runs_v2(project_id, status, finished_at DESC, run_id DESC);
      CREATE TABLE IF NOT EXISTS crew_finish_sequence (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO crew_finish_sequence(singleton,value) VALUES(1,0);
      CREATE INDEX IF NOT EXISTS crew_runs_v2_active ON crew_runs_v2(status, coordinator_session_id, ordinal);
      DROP TRIGGER IF EXISTS crew_scheduler_insert_v1;
      DROP TRIGGER IF EXISTS crew_scheduler_update_v1;
      DROP TRIGGER IF EXISTS crew_scheduler_delete_v1;`);
    const marker = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(markerKey);
    if (marker) {
      if (marker.value !== "1") throw new Error("Unsupported Crew storage version");
      return;
    }
    const old = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(legacyKey);
    const raw = old ? String(old.value) : '{"definitions":[],"runs":[]}';
    const parsed = JSON.parse(raw) as CrewState;
    if (!parsed || !Array.isArray(parsed.definitions) || !Array.isArray(parsed.runs))
      throw new Error("Crew history is invalid; legacy source was retained");
    if (new Set(parsed.runs.map((run) => run.id)).size !== parsed.runs.length)
      throw new Error("Crew run identities are duplicated; legacy source was retained");
    const { runs, ...state } = parsed;
    await store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?)").run(stateKey, JSON.stringify(state));
    for (let ordinal = 0; ordinal < runs.length; ordinal++) await saveRun(store, ordinal, runs[ordinal]);
    // The original crews.v1 value is intentionally retained, never rewritten.
    await store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?)").run(markerKey, "1");
  });
}

async function saveRun(store: HostStore, ordinal: number, run: CrewRun): Promise<void> {
  if (!run || typeof run.id !== "string" || typeof run.projectId !== "string" || typeof run.status !== "string" || !Number.isSafeInteger(run.createdAt) ||
      (run.coordinatorSessionId != null && typeof run.coordinatorSessionId !== "string"))
    throw new Error("Crew run is invalid");
  const prior = run.status === "finished"
    ? await store.db.prepare("SELECT finished_at FROM crew_runs_v2 WHERE run_id=? AND status='finished' ORDER BY ordinal LIMIT 1").get(run.id)
    : undefined;
  let finishedAt: number | null = null;
  if (run.status === "finished") {
    if (prior?.finished_at != null) finishedAt = Number(prior.finished_at);
    else {
      await store.db.prepare("UPDATE crew_finish_sequence SET value=value+1 WHERE singleton=1 AND value<?").run(Number.MAX_SAFE_INTEGER);
      const sequence = await store.db.prepare("SELECT value FROM crew_finish_sequence WHERE singleton=1").get();
      finishedAt = Number(sequence?.value);
      if (!Number.isSafeInteger(finishedAt) || finishedAt >= Number.MAX_SAFE_INTEGER)
        throw new Error("Crew finish sequence is exhausted");
    }
  }
  if (finishedAt !== null && !Number.isSafeInteger(finishedAt)) throw new Error("Crew finish time is invalid");
  await store.db.prepare(`INSERT INTO crew_runs_v2(ordinal,run_id,project_id,created_at,finished_at,status,coordinator_session_id,payload)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ordinal) DO UPDATE SET run_id=excluded.run_id, project_id=excluded.project_id, created_at=excluded.created_at, finished_at=excluded.finished_at,
    status=excluded.status, coordinator_session_id=excluded.coordinator_session_id, payload=excluded.payload
    WHERE crew_runs_v2.payload <> excluded.payload`).run(
      ordinal, run.id, run.projectId, run.createdAt, finishedAt, run.status, run.coordinatorSessionId ?? null, JSON.stringify(run),
    );
}

export async function readCrewProjectState(store: HostStore, projectId: string, history?: { cursor?: string; limit: number }): Promise<CrewState & { historyNextCursor?: string }> {
  return store.db.scope(async () => {
    const row = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(stateKey);
    if (!row) throw new Error("Crew storage is unavailable");
    const state = JSON.parse(String(row.value));
    if (!history) {
      const runs = await store.db.prepare("SELECT payload FROM crew_runs_v2 WHERE project_id=? ORDER BY ordinal").all(projectId);
      return { ...state, runs: runs.map((entry) => JSON.parse(String(entry.payload)) as CrewRun) };
    }
    const ongoing = await store.db.prepare("SELECT payload FROM crew_runs_v2 WHERE project_id=? AND status<>'finished' ORDER BY ordinal").all(projectId);
    let before: [number, string] | undefined;
    if (history.cursor !== undefined) {
      const value = JSON.parse(history.cursor) as unknown;
      if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || typeof value[1] !== "string" || value[1].length > 512)
        throw new Error("Invalid Crew history cursor");
      before = value as [number, string];
    }
    const finished = await store.db.prepare(`SELECT payload,finished_at,run_id FROM crew_runs_v2
      WHERE project_id=? AND status='finished' AND (? IS NULL OR finished_at<? OR (finished_at=? AND run_id<?))
      ORDER BY finished_at DESC,run_id DESC LIMIT ?`)
      .all(projectId, before?.[0] ?? null, before?.[0] ?? null, before?.[0] ?? null, before?.[1] ?? null, history.limit + 1);
    const last = finished[history.limit - 1];
    return { ...state, runs: [...ongoing, ...finished.slice(0, history.limit)].map((entry) => JSON.parse(String(entry.payload)) as CrewRun),
      ...(finished.length > history.limit && last ? { historyNextCursor: JSON.stringify([Number(last.finished_at), String(last.run_id)]) } : {}) };
  });
}

export async function readCrewDefinitions(store: HostStore): Promise<CrewDefaultsState> {
  const row = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(stateKey);
  if (!row) throw new Error("Crew storage is unavailable");
  return JSON.parse(String(row.value)) as CrewDefaultsState;
}

export async function readCrewState(store: HostStore): Promise<CrewState> {
  return store.db.scope(async () => {
    const row = await store.db.prepare("SELECT value FROM metadata WHERE key=?").get(stateKey);
    if (!row) throw new Error("Crew storage is unavailable");
    const state = JSON.parse(String(row.value));
    const rows = await store.db.prepare("SELECT payload FROM crew_runs_v2 ORDER BY ordinal").all();
    return { ...state, runs: rows.map((entry) => JSON.parse(String(entry.payload)) as CrewRun) };
  });
}

export async function writeCrewState(store: HostStore, state: CrewState): Promise<void> {
  if (!store.transactionActive) throw new Error("Crew writes require a transaction");
  const { runs, ...rest } = state;
  if (new Set(runs.map((run) => run.id)).size !== runs.length) throw new Error("Crew run identities are duplicated");
  await store.db.prepare("UPDATE metadata SET value=? WHERE key=? AND value<>?")
    .run(JSON.stringify(rest), stateKey, JSON.stringify(rest));
  const existing = await store.db.prepare("SELECT ordinal,payload FROM crew_runs_v2 ORDER BY ordinal").all();
  for (let ordinal = 0; ordinal < runs.length; ordinal++)
    if (Number(existing[ordinal]?.ordinal) !== ordinal || existing[ordinal]?.payload !== JSON.stringify(runs[ordinal]))
      await saveRun(store, ordinal, runs[ordinal]);
  if (existing.length > runs.length)
    await store.db.prepare("DELETE FROM crew_runs_v2 WHERE ordinal>=?").run(runs.length);
}

export async function readCrewSchedulerRuns(store: HostStore): Promise<CrewRun[]> {
  const state = await store.db.prepare(`SELECT CASE WHEN json_valid(value)
    THEN json_type(value,'$.definitions')='array' ELSE 0 END AS valid FROM metadata WHERE key=?`).get(stateKey);
  if (!state || Number(state.valid) !== 1) throw new Error("Crew storage is invalid or unavailable");
  const rows = await store.db.prepare(`SELECT payload FROM crew_runs_v2
    WHERE status='active' AND coordinator_session_id IS NOT NULL AND coordinator_session_id<>''
    ORDER BY ordinal`).all();
  return rows.map((row) => JSON.parse(String(row.payload)) as CrewRun);
}

export async function readCrewSchedulerRun(store: HostStore, id: string) {
  if (!store.transactionActive) throw new Error("Crew scheduler run reads require a transaction.");
  const row = await store.db.prepare("SELECT ordinal,payload FROM crew_runs_v2 WHERE run_id=? ORDER BY ordinal LIMIT 1").get(id);
  return row ? { ordinal: Number(row.ordinal), run: JSON.parse(String(row.payload)) as CrewRun } : undefined;
}

export async function readCrewRun(store: HostStore, id: string): Promise<CrewRun | undefined> {
  const row = await store.db.prepare("SELECT payload FROM crew_runs_v2 WHERE run_id=? ORDER BY ordinal LIMIT 1").get(id);
  return row ? JSON.parse(String(row.payload)) as CrewRun : undefined;
}

export async function patchCrewSchedulerRun(
  store: HostStore, ordinal: number, run: CrewRun, _fields: ReadonlyArray<keyof CrewRun>,
): Promise<void> {
  if (!store.transactionActive) throw new Error("Crew scheduler patches require a transaction.");
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error("Invalid Crew run ordinal.");
  const existing = await store.db.prepare("SELECT run_id FROM crew_runs_v2 WHERE ordinal=?").get(ordinal);
  if (!existing || existing.run_id !== run.id) throw new Error("Crew run changed; retry");
  await saveRun(store, ordinal, run);
  store.afterCommit(() => store.changes.notify());
}
