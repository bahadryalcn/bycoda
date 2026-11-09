import { stringField } from "./claudeProtocol";

/**
 * Where a compaction stands, from the `system/status` pings around it. Claude
 * Code sends `status: "compacting"` (no prose) when it starts, then a status
 * with a null/absent `status` when the pass is over; a failed pass may carry
 * `compact_result: "failed"` and `compact_error`. The finished compaction itself
 * is reported by the `compact_boundary` message, handled by `statusTextFromSystem`.
 */
export function compactionPhaseFromSystem(
  rec: Record<string, unknown>,
): { phase: "running" | "ended" | "failed"; error?: string } | undefined {
  if (stringField(rec, "type") !== "system" || stringField(rec, "subtype") !== "status") {
    return undefined;
  }
  if (stringField(rec, "compact_result")?.toLowerCase() === "failed") {
    const error = stringField(rec, "compact_error")?.trim();
    return { phase: "failed", ...(error ? { error } : {}) };
  }
  const status = stringField(rec, "status")?.trim().toLowerCase();
  if (status === "compacting") return { phase: "running" };
  if (!status && "status" in rec) return { phase: "ended" };
  return undefined;
}
