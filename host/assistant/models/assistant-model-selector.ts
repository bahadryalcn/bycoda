import type {
  AssistantModelPool,
  AssistantModelPoolRole,
  AssistantModelPoolRow,
} from "../../../src/shared/model/assistantModelPool";
import type { AssistantQuotaReading } from "./assistant-quota-reader";

export type AssistantPoolSelection =
  | { row: AssistantModelPoolRow; reason: "first" | `skipped:${string}` }
  | { row: null; reason: "noRowForRole" | "allBelowThreshold"; nextResetAt?: number };

/** Pure: first row in pool order that serves the role and is not below its own threshold.
 * Unknown quota follows the row's `unknownLimit`; it is never treated as 0 or 100. */
export function selectPoolRow(
  role: AssistantModelPoolRole,
  pool: Pick<AssistantModelPool, "rows">,
  quota: (row: AssistantModelPoolRow) => AssistantQuotaReading,
): AssistantPoolSelection {
  const candidates = pool.rows.filter((row) => row.roles.includes(role));
  if (!candidates.length) return { row: null, reason: "noRowForRole" };
  const skipped: string[] = [];
  let nextResetAt: number | undefined;
  for (const row of candidates) {
    const reading = quota(row);
    if ("unknown" in reading) {
      if (row.unknownLimit === "use") return pick(row, skipped);
      skipped.push(row.id);
      continue;
    }
    if (reading.leftPercent >= (row.minRemainingPercent ?? 0)) return pick(row, skipped);
    skipped.push(row.id);
    if (
      reading.resetsAt !== undefined &&
      (nextResetAt === undefined || reading.resetsAt < nextResetAt)
    )
      nextResetAt = reading.resetsAt;
  }
  return {
    row: null,
    reason: "allBelowThreshold",
    ...(nextResetAt === undefined ? {} : { nextResetAt }),
  };
}

function pick(row: AssistantModelPoolRow, skipped: string[]): AssistantPoolSelection {
  return { row, reason: skipped.length ? `skipped:${skipped.join(",")}` : "first" };
}
