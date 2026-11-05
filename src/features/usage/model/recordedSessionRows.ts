import type { sessionUsage } from "./usageAnalytics";

/** Preserve missing measurements as unavailable in the continuous session table. */
export function recordedSessionRows(rows: ReturnType<typeof sessionUsage>) {
  return rows.map((row) => ({
    ...row,
    label: row.title || row.key,
    duration: row.timedTurns ? row.duration : null,
    cost: row.meteredTurns > row.unpricedTurns ? row.cost : null,
    tokens: row.meteredTurns ? row.tokens : null,
    input: row.meteredTurns ? row.input : null,
    output: row.meteredTurns ? row.output : null,
    cacheRead: row.meteredTurns ? row.cacheRead : null,
    cacheWrite: row.meteredTurns ? row.cacheWrite : null,
  }));
}
