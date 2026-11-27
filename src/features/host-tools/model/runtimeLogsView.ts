import {
  compareRuntimeLogGroups,
  createRuntimeLogFilter,
  createRuntimeLogGroup,
  runtimeLogGroupId,
  type RuntimeLogFilters,
  type RuntimeLogGroup,
  type RuntimeLogsBuffer,
} from "../runtimeLogsModel";
import { runtimeLogDisplayLevel, type RuntimeLogDisplayLevel } from "../runtimeLogPresentation";
import type { RuntimeLogEntry } from "../runtimeLogTypes";

export type RuntimeLogsViewState = {
  /** Groups in display order; a group keeps its identity until an entry joins or leaves it. */
  groups: readonly RuntimeLogGroup[];
  /** Entries that pass the filters. */
  count: number;
  errorCount: number;
  warningCount: number;
  /** Retained entries per source, before filtering. */
  typeCounts: { browser: number; server: number };
  /** Every entry that passes the filters, in cursor order. */
  entries: () => RuntimeLogEntry[];
};

type Item = { entry: RuntimeLogEntry; group: string; level: RuntimeLogDisplayLevel };

/**
 * The filtered, grouped and counted view of a logs buffer. A poll appends a few entries and may
 * trim the front, so the view applies just those two deltas instead of re-reading all retained
 * entries. A filter change or a buffer that is not a continuation of the last one rebuilds it.
 * State is internal; `update` is idempotent for the same inputs.
 */
export class RuntimeLogsView {
  private buffer: RuntimeLogsBuffer | undefined;
  private signature = "";
  private items: Item[] = [];
  private groups = new Map<string, RuntimeLogGroup>();
  private sorted: RuntimeLogGroup[] = [];
  private errorCount = 0;
  private warningCount = 0;
  private browser = 0;
  private server = 0;
  private state: RuntimeLogsViewState | undefined;

  update(
    buffer: RuntimeLogsBuffer,
    filters: RuntimeLogFilters,
    groupRepeated: boolean,
  ): RuntimeLogsViewState {
    const signature = JSON.stringify([
      filters.source,
      filters.sourceIds,
      filters.levels,
      filters.search?.trim().toLocaleLowerCase(),
      groupRepeated,
    ]);
    if (this.state && buffer === this.buffer && signature === this.signature) return this.state;
    const delta = signature === this.signature ? this.continuation(buffer) : undefined;
    const groupsBeforeReset = delta ? undefined : this.groups;
    if (!delta) this.reset();
    this.signature = signature;
    this.buffer = buffer;
    const pass = createRuntimeLogFilter(filters);
    const touched = new Map<string, { removed: number; added: RuntimeLogEntry[] }>();
    const touch = (id: string) => {
      let value = touched.get(id);
      if (!value) touched.set(id, (value = { removed: 0, added: [] }));
      return value;
    };

    if (delta) {
      for (const entry of delta.removed) this.countSource(entry, -1);
      const firstCursor = buffer.entries[0].cursor;
      let drop = 0;
      while (drop < this.items.length && this.items[drop].entry.cursor < firstCursor) {
        const item = this.items[drop++];
        this.countLevel(item.level, -1);
        touch(item.group).removed++;
      }
      if (drop) this.items = this.items.slice(drop);
    }
    for (const entry of delta ? delta.added : buffer.entries) {
      this.countSource(entry, 1);
      const message = entry.message;
      const level = runtimeLogDisplayLevel(entry, message);
      if (!pass(entry, message, level)) continue;
      const group = runtimeLogGroupId(entry, groupRepeated, message);
      this.items.push({ entry, group, level });
      this.countLevel(level, 1);
      touch(group).added.push(entry);
    }

    if (touched.size) {
      const next = [...touched].flatMap(([id, change]) => {
        const kept = this.groups.get(id)?.entries.slice(change.removed) ?? [];
        const entries = change.added.length ? kept.concat(change.added) : kept;
        if (!entries.length) {
          this.groups.delete(id);
          return [];
        }
        const previous = groupsBeforeReset?.get(id);
        const group =
          previous?.entries.length === entries.length &&
          entries.every((entry, index) => entry === previous.entries[index])
            ? previous
            : createRuntimeLogGroup(id, entries);
        this.groups.set(id, group);
        return [group];
      });
      const sorted = this.sorted.filter((group) => !touched.has(group.id));
      for (const group of next) {
        let low = 0;
        let high = sorted.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (compareRuntimeLogGroups(sorted[middle], group) < 0) low = middle + 1;
          else high = middle;
        }
        sorted.splice(low, 0, group);
      }
      this.sorted = sorted;
    }

    const items = this.items;
    this.state = {
      groups: this.sorted,
      count: items.length,
      errorCount: this.errorCount,
      warningCount: this.warningCount,
      typeCounts: { browser: this.browser, server: this.server },
      entries: () => items.map((item) => item.entry),
    };
    return this.state;
  }

  /** The delta from the last processed buffer, or undefined when it is not a continuation. */
  private continuation(buffer: RuntimeLogsBuffer) {
    const previous = this.buffer?.entries;
    const next = buffer.entries;
    const last = previous?.[previous.length - 1];
    if (!previous || !last || !next.length) return undefined;
    let start = next.length;
    while (start > 0 && next[start - 1].cursor > last.cursor) start--;
    const removed = previous.length - start;
    if (start === 0 || removed < 0 || next[start - 1] !== last || previous[removed] !== next[0])
      return undefined;
    return { removed: previous.slice(0, removed), added: next.slice(start) };
  }

  private reset() {
    this.items = [];
    this.groups = new Map();
    this.sorted = [];
    this.errorCount = 0;
    this.warningCount = 0;
    this.browser = 0;
    this.server = 0;
  }

  private countSource(entry: RuntimeLogEntry, step: 1 | -1) {
    if (entry.source === "browser") this.browser += step;
    else if (entry.source === "server") this.server += step;
  }

  private countLevel(level: RuntimeLogDisplayLevel, step: 1 | -1) {
    if (level === "error") this.errorCount += step;
    if (level === "warn") this.warningCount += step;
  }
}
