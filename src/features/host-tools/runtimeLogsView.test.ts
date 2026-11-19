import { describe, expect, it } from "vitest";
import { runtimeLogDisplayLevel } from "./runtimeLogPresentation";
import {
  clearRuntimeLogs,
  createRuntimeLogsBuffer,
  filterRuntimeLogs,
  groupRuntimeLogs,
  mergeRuntimeLogs,
  type RuntimeLogFilters,
} from "./runtimeLogsModel";
import { RuntimeLogsView } from "./runtimeLogsView";
import type { RuntimeLogEntry, RuntimeLogSnapshot } from "./runtimeLogTypes";

const entry = (cursor: number, patch: Partial<RuntimeLogEntry> = {}): RuntimeLogEntry => ({
  id: "event-" + cursor,
  cursor,
  timestamp: 1_750_000_000_000 + cursor * 1000,
  sourceId: "browser-one",
  source: "browser",
  level: "error",
  message: "Failed to fetch account",
  ...patch,
});
const page = (entries: RuntimeLogEntry[]): RuntimeLogSnapshot => ({
  entries,
  cursor: entries.at(-1)?.cursor ?? 0,
  dropped: 0,
  sources: [],
});

/** What the panel computed from scratch on every poll before the view was incremental. */
function reference(
  entries: readonly RuntimeLogEntry[],
  filters: RuntimeLogFilters,
  grouped: boolean,
) {
  const filtered = filterRuntimeLogs(entries, filters);
  return {
    groups: groupRuntimeLogs(filtered, grouped),
    count: filtered.length,
    errorCount: filtered.filter((value) => runtimeLogDisplayLevel(value) === "error").length,
    warningCount: filtered.filter((value) => value.level === "warn").length,
    typeCounts: {
      browser: entries.filter((value) => value.source === "browser").length,
      server: entries.filter((value) => value.source === "server").length,
    },
  };
}

const variants = (cursor: number): Partial<RuntimeLogEntry> => {
  const kind = cursor % 5;
  return {
    level: kind === 0 ? "warn" : kind === 1 ? "info" : "error",
    message: kind === 3 ? "Other failure " + (cursor % 2) : "Failed to fetch account",
    source: cursor % 3 === 0 ? "server" : "browser",
    sourceId: cursor % 3 === 0 ? "server-one" : "browser-one",
    // Asynchronous browser captures arrive out of event order now and then.
    timestamp: 1_750_000_000_000 + cursor * 1000 - (cursor % 7 === 0 ? 40_000 : 0),
  };
};

describe("runtime logs view", () => {
  it.each([
    ["all", {}, true],
    ["ungrouped", {}, false],
    ["search", { search: "OTHER" }, true],
    ["errors from the server", { source: "server", levels: ["error", "warn"] }, true],
  ] as const)("matches a full recomputation across polls and trimming: %s", (_name, filters, grouped) => {
    const view = new RuntimeLogsView();
    let buffer = createRuntimeLogsBuffer();
    for (let from = 1; from <= 60; from += 7) {
      const entries = Array.from({ length: 7 }, (_, index) =>
        entry(from + index, variants(from + index)),
      );
      // Overlap the previous page like a host that replays its last events.
      const overlap = buffer.entries.slice(-2);
      buffer = mergeRuntimeLogs(buffer, page([...overlap, ...entries]), 25);
      const state = view.update(buffer, filters as RuntimeLogFilters, grouped);
      const expected = reference(buffer.entries, filters as RuntimeLogFilters, grouped);
      expect(state.groups).toEqual(expected.groups);
      expect(state.entries()).toEqual(filterRuntimeLogs(buffer.entries, filters as RuntimeLogFilters));
      expect({
        count: state.count,
        errorCount: state.errorCount,
        warningCount: state.warningCount,
        typeCounts: state.typeCounts,
      }).toEqual({
        count: expected.count,
        errorCount: expected.errorCount,
        warningCount: expected.warningCount,
        typeCounts: expected.typeCounts,
      });
    }
    expect(buffer.entries).toHaveLength(25);
  });

  it("does not re-read retained entries when a poll appends rows", () => {
    let reads = 0;
    const counted = (cursor: number) => {
      const value = entry(cursor, { level: "info" });
      let message = value.message;
      Object.defineProperty(value, "message", {
        get: () => (reads++, message),
        set: (next: string) => (message = next),
        enumerable: true,
      });
      return value;
    };
    const filters = { search: "account" };
    const view = new RuntimeLogsView();
    let buffer = mergeRuntimeLogs(
      createRuntimeLogsBuffer(),
      page(Array.from({ length: 50 }, (_, index) => counted(index + 1))),
      50,
    );
    view.update(buffer, filters, true);
    reads = 0;
    buffer = mergeRuntimeLogs(buffer, page([counted(51), counted(52)]), 50);
    const state = view.update(buffer, filters, true);
    expect(reads).toBe(2);
    expect(state.count).toBe(50);
    expect(state.groups.at(-1)?.entry.cursor).toBe(52);
    expect(view.update(buffer, filters, true)).toBe(state);
  });

  it("keeps the identity of groups that did not change", () => {
    const view = new RuntimeLogsView();
    let buffer = mergeRuntimeLogs(
      createRuntimeLogsBuffer(),
      page([entry(1), entry(2, { message: "Another" }), entry(3)]),
    );
    const first = view.update(buffer, {}, true);
    buffer = mergeRuntimeLogs(buffer, page([entry(4)]));
    const next = view.update(buffer, {}, true);
    const untouched = first.groups.find((group) => group.entry.message === "Another");
    expect(next.groups).toContain(untouched);
    expect(next.groups.find((group) => group.entry.cursor === 4)?.entries).toHaveLength(3);
  });

  it("rebuilds for a changed filter, a clear and a restarted stream", () => {
    const view = new RuntimeLogsView();
    let buffer = mergeRuntimeLogs(
      createRuntimeLogsBuffer(),
      page([entry(1), entry(2, { source: "server", sourceId: "server-one" })]),
    );
    expect(view.update(buffer, {}, true).count).toBe(2);
    expect(view.update(buffer, { source: "server" }, true).entries().map((v) => v.cursor)).toEqual([
      2,
    ]);
    expect(view.update(buffer, {}, true).count).toBe(2);
    buffer = clearRuntimeLogs(buffer);
    const cleared = view.update(buffer, {}, true);
    expect(cleared.count).toBe(0);
    expect(cleared.groups).toHaveLength(0);
    expect(cleared.typeCounts).toEqual({ browser: 0, server: 0 });
    buffer = mergeRuntimeLogs(buffer, { ...page([entry(1)]), streamId: "new" });
    buffer = mergeRuntimeLogs(buffer, { ...page([entry(1, { message: "fresh" })]), streamId: "x" });
    expect(view.update(buffer, {}, true).groups.map((group) => group.entry.message)).toEqual([
      "fresh",
    ]);
  });
});
