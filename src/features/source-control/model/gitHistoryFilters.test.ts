import { describe, expect, it } from "vitest";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { EMPTY_HISTORY_FILTERS, matchesHistoryFilters } from "./gitHistoryFilters";

const commit: GitHistoryCommit = {
  sha: "abcdef0123456789",
  shortSha: "abcdef0",
  subject: "Fix workspace navigation",
  author: "Ada Lovelace",
  timestamp: new Date(2026, 9, 18, 23, 59, 59).getTime() / 1000,
  parents: [],
  refs: [],
  head: false,
};

describe("history column filters", () => {
  it("combines case-insensitive column matches, including the full SHA", () => {
    expect(
      matchesHistoryFilters(commit, {
        ...EMPTY_HISTORY_FILTERS,
        subject: " WORKSPACE ",
        author: "ADA",
        sha: "23456789",
      }),
    ).toBe(true);
    expect(
      matchesHistoryFilters(commit, {
        ...EMPTY_HISTORY_FILTERS,
        subject: "workspace",
        author: "Grace",
      }),
    ).toBe(false);
  });
  it("includes both local date boundaries and excludes adjacent days", () => {
    expect(
      matchesHistoryFilters(commit, {
        ...EMPTY_HISTORY_FILTERS,
        after: "2026-10-18",
        before: "2026-10-18",
      }),
    ).toBe(true);
    expect(matchesHistoryFilters(commit, { ...EMPTY_HISTORY_FILTERS, before: "2026-10-17" })).toBe(
      false,
    );
    expect(matchesHistoryFilters(commit, { ...EMPTY_HISTORY_FILTERS, after: "2026-10-19" })).toBe(
      false,
    );
  });
});
