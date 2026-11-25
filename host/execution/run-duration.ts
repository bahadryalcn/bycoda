import { ObservedRunDuration } from "../../src/features/automations/model/automationLimits";
import type { HostStore } from "../store";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";

// Monotonic samples belong only to this process. A run's duration is the sum of the intervals
// between consecutive close-enough samples; a gap (sleep, stall, restart) adds nothing and the
// run keeps accruing from the next sample. A restarted Host continues from the persisted
// checkpoint, and its first sample only sets the baseline. The `uncertain` columns are kept for
// existing databases and always written 0.
const stores = new WeakMap<HostStore, Map<string, ObservedRunDuration>>();

export function localRunDay(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function forgetRunSamples(store: HostStore, sessionId?: string, runId?: string): void {
  if (sessionId && runId) stores.get(store)?.delete(JSON.stringify([sessionId, runId]));
}

/**
 * Withdraws an admitted run that never dispatched (a crew waiting for an eligible model), so
 * the wait is not charged as run time. A later dispatch admits the same run again from zero.
 */
export async function retractRunDuration(
  store: HostStore,
  sessionId: string,
  runId: string,
): Promise<void> {
  forgetRunSamples(store, sessionId, runId);
  for (const table of ["run_duration_checkpoints", "run_duration_daily"]) {
    const exists = await store.db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (exists)
      await store.db
        .prepare(`DELETE FROM ${table} WHERE session_id=? AND run_id=?`)
        .run(sessionId, runId);
  }
}

/** Called only when the Host creates a new exact run, before dispatch. */
export async function admitRunDuration(
  store: HostStore,
  sessionId: string,
  runId: string,
  wall = Date.now(),
  monotonic = monotonicNow(),
): Promise<void> {
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS run_duration_checkpoints (session_id TEXT NOT NULL, run_id TEXT NOT NULL, elapsed REAL NOT NULL, uncertain INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,run_id))",
  );
  const inserted = await store.db
    .prepare("INSERT OR IGNORE INTO run_duration_checkpoints VALUES (?,?,0,0)")
    .run(sessionId, runId);
  if (Number(inserted.changes) !== 1) return;
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS run_duration_daily (session_id TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL, ms REAL NOT NULL, PRIMARY KEY(session_id,run_id,day))",
  );
  await store.db
    .prepare("INSERT OR IGNORE INTO run_duration_daily VALUES (?,?,?,0)")
    .run(sessionId, runId, localRunDay(wall));
  let entries = stores.get(store);
  if (!entries) stores.set(store, (entries = new Map()));
  const key = JSON.stringify([sessionId, runId]);
  const previous = entries.get(key);
  if (previous) return;
  const admitted = new ObservedRunDuration(wall, monotonic);
  // onAccepted may inspect this exact run before the enclosing SQL commit.
  // Only real process observation grants a known origin, never a SQL row alone.
  entries.set(key, admitted);
  store.afterRollback(() => {
    if (entries.get(key) === admitted) entries.delete(key);
  });
}

export async function confirmedRunElapsed(
  store: HostStore,
  sessionId: string,
  runId: string,
  wall: number,
  monotonic = monotonicNow(),
): Promise<number> {
  return await store.transaction(async () => {
    const finished = await finishedRunElapsed(store, sessionId, runId);
    if (finished !== null) return finished;
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS run_duration_checkpoints (session_id TEXT NOT NULL, run_id TEXT NOT NULL, elapsed REAL NOT NULL, uncertain INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,run_id))",
    );
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS run_duration_daily (session_id TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL, ms REAL NOT NULL, PRIMARY KEY(session_id,run_id,day))",
    );
    let entries = stores.get(store);
    if (!entries) stores.set(store, (entries = new Map()));
    const key = JSON.stringify([sessionId, runId]);
    const row = await store.db
      .prepare("SELECT elapsed FROM run_duration_checkpoints WHERE session_id=? AND run_id=?")
      .get(sessionId, runId);
    // No in-process sample (a Host restart): continue from the checkpoint, baseline is now.
    const duration =
      entries.get(key)?.clone() ??
      new ObservedRunDuration(wall, monotonic, Number(row?.elapsed ?? 0));
    const elapsed = duration.sample(wall, monotonic, 90_000);
    const increment = Math.max(0, elapsed - Number(row?.elapsed ?? 0));
    if (increment > 0) {
      const add = store.db.prepare(
        "INSERT INTO run_duration_daily VALUES (?,?,?,?) ON CONFLICT(session_id,run_id,day) DO UPDATE SET ms=ms+excluded.ms",
      );
      for (let start = wall - increment; start < wall;) {
        const midnight = new Date(start);
        midnight.setHours(0, 0, 0, 0);
        midnight.setDate(midnight.getDate() + 1);
        const end = Math.min(wall, midnight.getTime());
        await add.run(sessionId, runId, localRunDay(start), end - start);
        start = end;
      }
    }
    await store.db
      .prepare(
        "INSERT INTO run_duration_checkpoints VALUES (?,?,?,0) ON CONFLICT(session_id,run_id) DO UPDATE SET elapsed=max(elapsed,excluded.elapsed)",
      )
      .run(sessionId, runId, elapsed);
    store.afterCommit(() => {
      if (!entries.has(key) && entries.size >= 4096) entries.delete(entries.keys().next().value!);
      entries.set(key, duration);
    });
    return elapsed;
  });
}

/** The last persisted checkpoint of a run, without sampling; 0 when none exists. */
export async function checkpointRunElapsed(
  store: HostStore,
  sessionId: string,
  runId: string,
): Promise<number> {
  const exists = await store.db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_duration_checkpoints'")
    .get();
  if (!exists) return 0;
  const row = await store.db
    .prepare("SELECT elapsed FROM run_duration_checkpoints WHERE session_id=? AND run_id=?")
    .get(sessionId, runId);
  return Number(row?.elapsed ?? 0);
}

/** Finalize only at the owned execution lifecycle boundary, not a later poll. */
export async function finishRunDuration(
  store: HostStore,
  sessionId: string,
  runId: string,
  wall?: number,
  monotonic?: number,
): Promise<void> {
  await store.transaction(async () => {
    await store.db.exec(
      "CREATE TABLE IF NOT EXISTS run_duration_finished (session_id TEXT NOT NULL, run_id TEXT NOT NULL, elapsed REAL NOT NULL, uncertain INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,run_id))",
    );
    const existing = await store.db
      .prepare("SELECT 1 FROM run_duration_finished WHERE session_id=? AND run_id=?")
      .get(sessionId, runId);
    if (existing) return;
    const elapsed = await confirmedRunElapsed(
      store,
      sessionId,
      runId,
      wall ?? Date.now(),
      monotonic ?? monotonicNow(),
    );
    await store.db
      .prepare(
        "INSERT INTO run_duration_finished (session_id,run_id,elapsed,uncertain) VALUES (?,?,?,0)",
      )
      .run(sessionId, runId, elapsed);
    store.afterCommit(() => forgetRunSamples(store, sessionId, runId));
  });
}

/** The closing elapsed time of a run, or null while the run has no close record. */
export async function finishedRunElapsed(
  store: HostStore,
  sessionId: string,
  runId: string,
): Promise<number | null> {
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS run_duration_finished (session_id TEXT NOT NULL, run_id TEXT NOT NULL, elapsed REAL NOT NULL, uncertain INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,run_id))",
  );
  const row = await store.db
    .prepare("SELECT elapsed FROM run_duration_finished WHERE session_id=? AND run_id=?")
    .get(sessionId, runId);
  return row ? Number(row.elapsed) : null;
}
