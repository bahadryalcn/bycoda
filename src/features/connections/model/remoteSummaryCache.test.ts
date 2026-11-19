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

const cacheKey = (name: string | number) => `bycoda.remote-history.v2:${name}`;

it("does not re-read cached values on later writes and evicts the least recently written", () => {
  localStorage.clear();
  for (let index = 0; index < REMOTE_SUMMARY_CACHE_ENTRIES; index++)
    writeRemoteSummaryCache(cacheKey(index), "[]");
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  try {
    writeRemoteSummaryCache(cacheKey(0), "[1]"); // refresh the oldest entry
    writeRemoteSummaryCache(cacheKey("next"), "[]");
    expect(getItem).not.toHaveBeenCalled();
  } finally {
    getItem.mockRestore();
  }
  expect(localStorage.getItem(cacheKey(0))).toBe("[1]");
  expect(localStorage.getItem(cacheKey(1))).toBeNull();
  expect(localStorage.getItem(cacheKey("next"))).toBe("[]");
  expect(localStorage.length).toBe(REMOTE_SUMMARY_CACHE_ENTRIES);
});

it("keeps byte accounting correct for entries written by other windows or outside the cache", () => {
  localStorage.clear();
  const quarter = "x".repeat(REMOTE_SUMMARY_CACHE_BYTES / 8);
  writeRemoteSummaryCache(cacheKey("a"), "[]");
  // Another window stores a large entry; the storage event carries its new value.
  localStorage.setItem(cacheKey("other"), quarter + quarter);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: cacheKey("other"),
      newValue: quarter + quarter,
      storageArea: localStorage,
    }),
  );
  // A same-window foreign write (no event) is found through the length check.
  localStorage.setItem(cacheKey("foreign"), quarter);
  localStorage.setItem("draft", "keep");
  writeRemoteSummaryCache(cacheKey("b"), quarter);
  expect(localStorage.getItem(cacheKey("a"))).toBeNull();
  expect(localStorage.getItem(cacheKey("other"))).toBe(quarter + quarter);
  expect(localStorage.getItem(cacheKey("foreign"))).toBe(quarter);
  expect(localStorage.getItem(cacheKey("b"))).toBe(quarter);
  expect(localStorage.getItem("draft")).toBe("keep");
  // Removal in another window releases its bytes: the next write evicts nothing.
  localStorage.removeItem(cacheKey("other"));
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: cacheKey("other"),
      newValue: null,
      storageArea: localStorage,
    }),
  );
  writeRemoteSummaryCache(cacheKey("c"), quarter + quarter);
  expect(localStorage.getItem(cacheKey("foreign"))).toBe(quarter);
  expect(localStorage.getItem(cacheKey("b"))).toBe(quarter);
  expect(localStorage.getItem(cacheKey("c"))).toBe(quarter + quarter);
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
