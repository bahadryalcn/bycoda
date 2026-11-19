import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readInboxSeenStorage } from "./inboxSeenStorage";

vi.mock("./inboxSeenStorage", () => ({
  readInboxSeenStorage: vi.fn(),
  mergeInboxSeenStorage: vi.fn(),
  seedInboxSeenStorage: vi.fn(),
}));

const NOW = Date.now();
const iso = (offset: number) => new Date(NOW + offset).toISOString();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  vi.mocked(readInboxSeenStorage).mockImplementation(async (keys) => ({
    seeded: true,
    items: new Map(keys.map((key) => [key, key === "github:a#1" ? NOW : undefined])),
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("reads every visible row's seen state in one storage read when the window regains focus", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen({ key: "warm", updatedAt: iso(0) });
  const unsubscribe = api.subscribeInboxSeen(() => {});
  try {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      key: `github:repo#${index}`,
      updatedAt: iso(1000),
    }));
    vi.mocked(readInboxSeenStorage).mockClear();
    window.dispatchEvent(new Event("focus"));
    // Each row re-reads because the generation changed; the reads must coalesce.
    const reads = rows.map((row) => api.readInboxEntryUnseen(row));
    await Promise.all(reads);
    expect(readInboxSeenStorage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readInboxSeenStorage).mock.calls[0]![0]).toEqual(rows.map((row) => row.key));
  } finally {
    unsubscribe();
  }
});

it("keeps each entry's own key, timestamp and seen record in a shared read", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen({ key: "warm", updatedAt: iso(0) });
  vi.mocked(readInboxSeenStorage).mockClear();
  const results = await Promise.all([
    // Seen at NOW: an update at NOW is seen, a later one is unseen.
    api.readInboxEntryUnseen({ key: "github:a#1", updatedAt: new Date(NOW).toISOString() }),
    api.readInboxEntryUnseen({ key: "github:a#1", updatedAt: iso(5000) }),
    // The same number in another scope is a different identity with no record.
    api.readInboxEntryUnseen({ key: "github:b#1", updatedAt: iso(0) }),
    api.readInboxEntryUnseen({ key: "", updatedAt: iso(0) }),
  ]);
  expect(results).toEqual([false, true, true, false]);
  expect(readInboxSeenStorage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(readInboxSeenStorage).mock.calls[0]![0]).toEqual(["github:a#1", "github:b#1", ""]);
});

it("reads again after a batch finished, so a later change is never served stale", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen({ key: "warm", updatedAt: iso(0) });
  vi.mocked(readInboxSeenStorage).mockClear();
  const entry = { key: "github:c#1", updatedAt: iso(0) };
  await api.readInboxEntryUnseen(entry);
  await api.readInboxEntryUnseen(entry);
  expect(readInboxSeenStorage).toHaveBeenCalledTimes(2);
});

it("fails every row of a shared read when storage fails and reports the error status", async () => {
  const api = await import("./inboxSeen");
  await api.readInboxEntryUnseen({ key: "warm", updatedAt: iso(0) });
  vi.mocked(readInboxSeenStorage).mockRejectedValueOnce(new Error("storage unavailable"));
  const results = await Promise.all([
    api.readInboxEntryUnseen({ key: "a", updatedAt: iso(0) }),
    api.readInboxEntryUnseen({ key: "b", updatedAt: iso(0) }),
  ]);
  expect(results).toEqual([false, false]);
  expect(api.inboxSeenStatus()).toEqual({ state: "error", error: "storage unavailable" });
});
