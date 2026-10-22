import type { HostStore } from "./store";

export type UsageTurnMetadata = {
  startedAt: unknown; durationMs: unknown; draft: unknown; continuationOf: unknown;
  inputTokens: unknown; outputTokens: unknown; cacheReadTokens: unknown; cacheWriteTokens: unknown;
};
export type UsageMetadataPage = {
  sessions: { sessionId: string; provider: string; turns: UsageTurnMetadata[]; turnsTruncated: boolean }[];
  nextCursor: string | null; scannedSessions: number; skippedSessions: number;
};
const tokenKeys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
type TokenKey = typeof tokenKeys[number];
export type SessionUsageRow = { sessionId: string; provider: string; turns: number; timedTurns: number; durationMs: number | null; cost: null } & Record<TokenKey, number | null>;
export type SessionUsageReport = {
  environmentId: string; projectId: string; scope: "host-observed-sessions"; sampledAt: number;
  window: { start: number; end: number; timeZone: "UTC"; attribution: "turn-start" };
  coverage: { source: "host-store"; truncated: boolean; scannedSessions: number; skippedSessions: number; undatedTurns: number; unavailableFields: string[] };
  totals: Omit<SessionUsageRow, "sessionId" | "provider">;
  rows: SessionUsageRow[]; nextCursor: string | null;
};
export function usageParams(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid usage report request");
  const { projectId, sinceMs, untilMs, limit = 50, cursor } = value as Record<string, unknown>;
  if (typeof projectId !== "string" || !projectId || projectId.length > 256 || typeof sinceMs !== "number" || !Number.isSafeInteger(sinceMs) || sinceMs < 0 || typeof untilMs !== "number" || !Number.isSafeInteger(untilMs) || untilMs <= sinceMs || untilMs - sinceMs > 31 * 86400000 || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 256 || cursor.includes("\0")))
    throw new Error("Invalid usage report window or page");
  return { projectId, sinceMs, untilMs, limit, cursor: cursor as string | undefined };
}
const reading = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const add = (left: number | null, right: number | null): number | null => left === null || right === null || !Number.isSafeInteger(left + right) ? null : left + right;
function blank() { return { turns: 0, timedTurns: 0, durationMs: 0 as number | null, inputTokens: 0 as number | null, outputTokens: 0 as number | null, cacheReadTokens: 0 as number | null, cacheWriteTokens: 0 as number | null, cost: null }; }

/** Bounded metadata only. Token readings belong to turns that start in [start,end),
 * not account usage; duration is the entire settled turn, never a running timer. */
export function readSessionUsage(store: HostStore, value: unknown, sampledAt = Date.now()): SessionUsageReport {
  const params = usageParams(value);
  store.project(params.projectId);
  const page = store.usageMetadataPage(params.projectId, params.cursor, params.limit);
  const totals = blank(); const rows: SessionUsageRow[] = []; let undatedTurns = 0;
  for (const session of page.sessions) {
    const row: SessionUsageRow = { sessionId: session.sessionId, provider: session.provider, ...blank() };
    for (const turn of session.turns) {
      if (turn.draft || turn.continuationOf) continue;
      const started = reading(turn.startedAt);
      if (started === null) { undatedTurns++; continue; }
      if (started < params.sinceMs || started >= params.untilMs) continue;
      row.turns++;
      const duration = reading(turn.durationMs);
      if (duration !== null) row.timedTurns++;
      row.durationMs = add(row.durationMs, duration);
      for (const key of tokenKeys) row[key] = add(row[key], reading(turn[key]));
    }
    if (!row.turns) continue;
    rows.push(row); totals.turns += row.turns; totals.timedTurns += row.timedTurns;
    totals.durationMs = add(totals.durationMs, row.durationMs);
    for (const key of tokenKeys) totals[key] = add(totals[key], row[key]);
  }
  const omitted = page.skippedSessions > 0 || undatedTurns > 0 || page.sessions.some((session) => session.turnsTruncated);
  const truncated = page.nextCursor !== null || omitted;
  if (omitted) {
    totals.durationMs = null;
    for (const key of tokenKeys) totals[key] = null;
  }
  // Totals describe this page's observed turns, and coverage makes omissions explicit.
  return { environmentId: store.environmentId, projectId: params.projectId, scope: "host-observed-sessions", sampledAt,
    window: { start: params.sinceMs, end: params.untilMs, timeZone: "UTC", attribution: "turn-start" },
    coverage: { source: "host-store", truncated, scannedSessions: page.scannedSessions, skippedSessions: page.skippedSessions, undatedTurns, unavailableFields: ["cost", "accountQuota", "budget", ...tokenKeys.filter((key) => totals[key] === null)] },
    totals, rows, nextCursor: page.nextCursor };
}
