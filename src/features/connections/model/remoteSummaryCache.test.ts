// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  writeRemoteSummaryCache,
  queueRemoteSummaryCache,
  REMOTE_SUMMARY_CACHE_ENTRIES,
  REMOTE_SUMMARY_CACHE_BYTES,
} from "./remoteSummaryCache";
it("evicts only disposable summaries at count and byte limits", () => {
  localStorage.clear();
  localStorage.setItem("draft", "keep");
  for (let index = 0; index < REMOTE_SUMMARY_CACHE_ENTRIES + 3; index++)
    writeRemoteSummaryCache(`bycoda.remote-history.v2:${index}`, "[]");
  expect(localStorage.getItem("draft")).toBe("keep");
  expect(localStorage.length).toBe(REMOTE_SUMMARY_CACHE_ENTRIES + 1);
  expect(localStorage.getItem("bycoda.remote-history.v2:0")).toBeNull();
  writeRemoteSummaryCache("bycoda.remote-history.v2:big", "x".repeat(REMOTE_SUMMARY_CACHE_BYTES));
  expect(localStorage.getItem("bycoda.remote-history.v2:big")).toBeNull();
});

it("coalesces pending summary writes and yields before storage", () => {
  vi.useFakeTimers();
  localStorage.clear();
  const key = "bycoda.remote-history.v2:coalesced";
  try {
    queueRemoteSummaryCache(key, "old");
    queueRemoteSummaryCache(key, "new");
    expect(localStorage.getItem(key)).toBeNull();
    vi.runAllTimers();
    expect(localStorage.getItem(key)).toBe("new");
  } finally {
    vi.useRealTimers();
  }
});
