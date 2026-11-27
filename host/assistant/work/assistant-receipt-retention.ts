import type { HostStore } from "../../store";

const DAY = 86400000;
/** Non-head voice provenance versions older than this are dropped once nothing references them. */
export const VOICE_VERSION_RETENTION_MS = 90 * DAY;
/** Newest Chief read receipt rows kept; the pending intent's own rows are always kept. */
export const CHIEF_READ_RECEIPT_ROWS = 500;
const VOICE_VERSION_BATCH = 1000;

async function existingTables(store: HostStore, names: string[]) {
  const rows = await store.db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${names.map(() => "?").join(",")})`,
    )
    .all(...names);
  return new Set(rows.map((row) => String(row.name)));
}

/**
 * Drops superseded voice-context version rows that no replay or proof can still name.
 *
 * Kept: every context's head version (the row `assistant_voice_contexts` mirrors), every
 * version a message scope proof (`messageScopeVoice:*`) or an owner question source names, and
 * anything younger than the retention window. The rest of the voice tables are replay and
 * disclosure receipts (request, disclosure and generation keys) and are never swept here.
 * Any unreadable reference makes the whole sweep a no-op instead of guessing.
 */
export async function pruneVoiceContextVersions(store: HostStore, now: number): Promise<number> {
  const present = await existingTables(store, [
    "assistant_voice_context_versions",
    "assistant_voice_contexts",
    "assistant_runtime",
    "assistant_owner_questions",
  ]);
  if (present.size < 4) return 0;
  const versions = new Set<string>(),
    contexts = new Set<string>();
  try {
    const proofs = await store.db
      .prepare("SELECT value FROM assistant_runtime WHERE id>=? AND id<?")
      .all("messageScopeVoice:", "messageScopeVoice;");
    for (const row of proofs) {
      const proof = (
        JSON.parse(String(row.value)) as { value?: { contextId?: unknown; version?: unknown } }
      ).value;
      if (
        typeof proof?.contextId !== "string" ||
        typeof proof.version !== "number" ||
        !Number.isSafeInteger(proof.version)
      )
        return 0;
      versions.add(`${proof.contextId}:${proof.version}`);
    }
    const questions = await store.db
      .prepare(
        "SELECT source FROM assistant_owner_questions WHERE json_extract(source,'$.causalContextId') IS NOT NULL",
      )
      .all();
    for (const row of questions) {
      const source = JSON.parse(String(row.source)) as {
        causalContextId?: unknown;
        causalContextVersion?: unknown;
      };
      if (typeof source.causalContextId !== "string") return 0;
      // A question that names no version resolves the head at read time, so keep the whole context.
      if (source.causalContextVersion === undefined) contexts.add(source.causalContextId);
      else if (
        typeof source.causalContextVersion === "number" &&
        Number.isSafeInteger(source.causalContextVersion)
      )
        versions.add(`${source.causalContextId}:${source.causalContextVersion}`);
      else return 0;
    }
  } catch {
    return 0;
  }
  const result = await store.db
    .prepare(
      `DELETE FROM assistant_voice_context_versions WHERE rowid IN (
        SELECT v.rowid FROM assistant_voice_context_versions v
        JOIN assistant_voice_contexts c ON c.id=v.context_id
        WHERE v.version<json_extract(c.value,'$.version')
          AND json_extract(v.value,'$.updatedAt')<?
          AND (v.context_id||':'||v.version) NOT IN (SELECT value FROM json_each(?))
          AND v.context_id NOT IN (SELECT value FROM json_each(?))
        ORDER BY v.rowid LIMIT ?)`,
    )
    .run(
      now - VOICE_VERSION_RETENTION_MS,
      JSON.stringify([...versions]),
      JSON.stringify([...contexts]),
      VOICE_VERSION_BATCH,
    );
  return Number(result.changes);
}

/**
 * Trims settled Chief read receipts, which store the full disclosed result per read.
 *
 * Operation ids are fresh per Chief intent, so only the pending intent can retry an operation;
 * its rows are exempt. The `latest` row (the card's accepted read results) is never touched.
 * Rows carry no timestamp, so retention is by insertion order.
 */
export async function pruneChiefReadReceipts(
  store: HostStore,
  activeOperationIds: string[],
): Promise<number> {
  if (!(await existingTables(store, ["assistant_chief_reads"])).size) return 0;
  const keep = [...new Set(activeOperationIds)].map((operationId) => `${operationId}:`);
  const result = await store.db
    .prepare(
      `DELETE FROM assistant_chief_reads WHERE id<>'latest'
        AND rowid NOT IN (SELECT rowid FROM assistant_chief_reads ORDER BY rowid DESC LIMIT ?)${keep
          .map(() => " AND substr(id,1,?)<>?")
          .join("")}`,
    )
    .run(CHIEF_READ_RECEIPT_ROWS, ...keep.flatMap((prefix) => [prefix.length, prefix]));
  return Number(result.changes);
}

/**
 * Drops the supervisor session receipts and nudge counters of a permanently purged job.
 *
 * A purged job can no longer be targeted, so nothing can retry, replay or count those
 * receipts. Question claims and `manual:` supervision receipts are left alone: claims guard
 * a question occurrence that is not owned by the job, and grants have their own lifecycle.
 */
export async function purgeJobSessionReceipts(store: HostStore, jobId: string): Promise<void> {
  const present = await existingTables(store, [
    "assistant_session_receipts",
    "assistant_session_counts",
  ]);
  const from = `${jobId}:`,
    to = `${jobId};`;
  for (const table of ["assistant_session_receipts", "assistant_session_counts"])
    if (present.has(table))
      await store.db.prepare(`DELETE FROM ${table} WHERE id>=? AND id<?`).run(from, to);
}
