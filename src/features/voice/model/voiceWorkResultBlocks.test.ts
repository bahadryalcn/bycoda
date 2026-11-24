import { expect, it } from "vitest";
import {
  countWorkSources,
  countWorkStatuses,
  filterWorkRecords,
  observedWorkRecords,
  toWorkTableRows,
  workSourceComparisonVisible,
  type WorkRecord,
} from "./voiceWorkResultBlocks";

it("keeps command summaries and individual action receipts distinct", () => {
  const rows = observedWorkRecords([
    { kind: "tests", status: "failed", passed: 8, failed: 2, skipped: 0 },
    {
      kind: "actions",
      status: "interrupted",
      actions: [
        { id: "tests", name: "notes.create", status: "done" },
        { id: "other", name: "tasks.create", status: "interrupted" },
      ],
    },
  ]);
  expect(rows.map(({ id, status }) => [id, status])).toEqual([
    ["result:tests", "failed"],
    ["action:tests", "done"],
    ["action:other", "interrupted"],
  ]);
  expect(new Set(rows.map(({ source }) => source)).size).toBe(2);
  expect(observedWorkRecords([])).toEqual([]);
});

const records: WorkRecord[] = [
  { id: "a", title: "Review patch", status: "done", source: "Command" },
  { id: "b", title: "Build package", status: "failed", source: "Voice" },
  { id: "c", title: "Check results", status: "done", source: "Command" },
];

it("counts only supplied records, per status and per source in first-seen order", () => {
  expect(countWorkStatuses(records)).toEqual({
    running: 0,
    done: 2,
    failed: 1,
    stopped: 0,
    interrupted: 0,
  });
  expect(countWorkSources(records)).toEqual([
    { source: "Command", count: 2 },
    { source: "Voice", count: 1 },
  ]);
  expect(countWorkStatuses([])).toEqual({
    running: 0,
    done: 0,
    failed: 0,
    stopped: 0,
    interrupted: 0,
  });
});

it("filters to exactly the chosen status, and a status with no records shows none", () => {
  expect(filterWorkRecords(records, "all").map((record) => record.id)).toEqual(["a", "b", "c"]);
  expect(filterWorkRecords(records, "done").map((record) => record.id)).toEqual(["a", "c"]);
  expect(filterWorkRecords(records, "stopped")).toEqual([]);
  // "all" returns a copy, so the caller cannot mutate the live records through it.
  expect(filterWorkRecords(records, "all")).not.toBe(records);
});

it("labels table rows from their status and keeps the record fields unchanged", () => {
  expect(toWorkTableRows(records)[1]).toEqual({
    id: "b",
    title: "Build package",
    status: "failed",
    source: "Voice",
    statusLabel: "Failed",
  });
});

it("shows a source comparison only from at least two sources", () => {
  expect(workSourceComparisonVisible(records)).toBe(true);
  expect(workSourceComparisonVisible([records[0]!, records[2]!])).toBe(false);
  expect(workSourceComparisonVisible([])).toBe(false);
});
