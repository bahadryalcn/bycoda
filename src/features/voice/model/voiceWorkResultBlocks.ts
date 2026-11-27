import { t } from "../../../shared/i18n";
import type { VoiceLiveResult } from "./voiceLiveWork";

/**
 * Pure work-result logic for the live voice answer. Records, counts and sources come only from the
 * live work state the caller passes in. The OpenUI program carries enums and sort choices, never data.
 */
export const workStatuses = ["running", "done", "failed", "stopped", "interrupted"] as const;
export type WorkStatus = (typeof workStatuses)[number];
export const workFilters = ["all", ...workStatuses] as const;
export type WorkFilter = (typeof workFilters)[number];
export const workResultSortKinds = ["activity", "status", "source"] as const;
export type WorkResultSort = (typeof workResultSortKinds)[number];

export type WorkRecord = { id: string; title: string; status: WorkStatus; source: string };
export type WorkTableRow = WorkRecord & { statusLabel: string };

const observedResultLabels = () =>
  ({
    tests: t("Test run"),
    build: t("Build"),
    checks: t("Checks"),
    changes: t("Changes"),
    commands: t("Commands"),
  }) as const;

/** Represent each observed summary once and preserve individual voice action receipts. */
export function observedWorkRecords(results: readonly VoiceLiveResult[]): WorkRecord[] {
  return results.flatMap((result) => {
    if (result.kind === "actions") {
      return result.actions.map((action) => ({
        id: `action:${action.id}`,
        title: action.name,
        status: action.status,
        source: t("Voice actions"),
      }));
    }
    return [
      {
        id: `result:${result.kind}`,
        title: observedResultLabels()[result.kind],
        status: result.status,
        source: t("Commands"),
      },
    ];
  });
}

export function workFilterLabel(value: WorkFilter) {
  return {
    all: t("All"),
    running: t("Working"),
    done: t("Completed"),
    failed: t("Failed"),
    stopped: t("Cancelled"),
    interrupted: t("Unknown"),
  }[value];
}

export function isWorkStatus(value: string | null | undefined): value is WorkStatus {
  return (workStatuses as readonly string[]).includes(value ?? "");
}

export function countWorkStatuses(records: readonly WorkRecord[]): Record<WorkStatus, number> {
  const counts = { running: 0, done: 0, failed: 0, stopped: 0, interrupted: 0 };
  for (const record of records) counts[record.status]++;
  return counts;
}

/** Sources in first-seen order, each with the number of records it reported. */
export function countWorkSources(records: readonly WorkRecord[]) {
  const sources = new Map<string, number>();
  for (const record of records) sources.set(record.source, (sources.get(record.source) ?? 0) + 1);
  return Array.from(sources, ([source, count]) => ({ source, count }));
}

/** The records a filter leaves visible. A status with no records shows none, never all. */
export function filterWorkRecords(records: readonly WorkRecord[], filter: WorkFilter) {
  return filter === "all" ? [...records] : records.filter((record) => record.status === filter);
}

export function toWorkTableRows(records: readonly WorkRecord[]): WorkTableRow[] {
  return records.map((record) => ({
    ...record,
    statusLabel: workFilterLabel(record.status),
  }));
}

export const workTableSort = {
  activity: undefined,
  status: { key: "statusLabel", direction: "asc" },
  source: { key: "source", direction: "asc" },
} as const;

/** A source comparison needs at least two sources; with one it would repeat the table. */
export function workSourceComparisonVisible(records: readonly WorkRecord[]) {
  return countWorkSources(records).length >= 2;
}
