import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearKnownInboxItems,
  knownInboxEntries,
  rememberInboxItems,
  inboxHasUnseenItems,
  inboxSeenIsSeeded,
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  seedInboxSeenIfNeeded,
} from "./inboxSeen";

const KEY = "bycoda.inboxSeen";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

function entry(key: string, updatedAt: string): { key: string; updatedAt: string } {
  return { key, updatedAt };
}

describe("inbox seen items", () => {
  beforeEach(() => {
    mockLocalStorage();
    clearKnownInboxItems();
  });
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("parses one shared snapshot and observes changed or corrupt storage", () => {
    localStorage.setItem(KEY, JSON.stringify({ seeded: true, items: { item: 100 } }));
    const parse = vi.spyOn(JSON, "parse");
    for (let index = 0; index < 100; index++)
      isInboxEntryUnseen(entry("item", new Date(100).toISOString()));
    expect(parse).toHaveBeenCalledTimes(1);
    localStorage.setItem(KEY, JSON.stringify({ seeded: true, items: { item: 0 } }));
    expect(isInboxEntryUnseen(entry("item", new Date(100).toISOString()))).toBe(true);
    localStorage.setItem(KEY, "{");
    expect(inboxSeenIsSeeded()).toBe(false);
    expect(inboxSeenIsSeeded()).toBe(false);
    expect(parse).toHaveBeenCalledTimes(3);
    localStorage.setItem(KEY, "[]");
    expect(inboxSeenIsSeeded()).toBe(false);
    expect(inboxSeenIsSeeded()).toBe(false);
    expect(parse).toHaveBeenCalledTimes(4);
    parse.mockRestore();
  });

  it("bounds new seen identities without evicting existing or blocking updates", () => {
    // Records must sit inside the 90-day window, or pruning would drop them first.
    const recent = Date.now();
    const items = Object.fromEntries(
      Array.from({ length: 50_000 }, (_, index) => [`key-${index}`, recent - 1_000]),
    );
    localStorage.setItem(KEY, JSON.stringify({ seeded: true, items }));
    expect(markInboxItemSeen(entry("new-key", new Date(recent).toISOString()))).toBe(false);
    expect(markInboxItemSeen(entry("key-0", new Date(recent + 1).toISOString()))).toBe(true);
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(saved.items)).toHaveLength(50_000);
    expect(saved.items["key-0"]).toBe(recent + 1);
    expect(saved.items["key-49999"]).toBe(recent - 1_000);
  });

  it("prunes seen records older than 90 days and keeps an old item without a record seen", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        seeded: true,
        items: { "old-key": now - 100 * day, "recent-key": now - 10 * day },
      }),
    );
    expect(markInboxItemSeen(entry("fresh-key", new Date(now).toISOString()))).toBe(true);
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(saved.items).sort()).toEqual(["fresh-key", "recent-key"]);
    // Pruning must not resurface an old item as unread.
    expect(inboxHasUnseenItems([entry("old-key", new Date(now - 100 * day).toISOString())])).toBe(
      false,
    );
  });

  it("seeds current items so a long-standing inbox does not badge", () => {
    seedInboxSeenIfNeeded([
      entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
      entry("github:acme/web:issue:4", "2026-08-27T11:00:00Z"),
    ]);
    expect(
      inboxHasUnseenItems([
        entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
        entry("github:acme/web:issue:4", "2026-08-27T11:00:00Z"),
      ]),
    ).toBe(false);
  });

  it("flags a newly appeared item", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    expect(
      inboxHasUnseenItems([
        entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
        entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
      ]),
    ).toBe(true);
  });

  it("flags an existing item that got a newer update", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    expect(inboxHasUnseenItems([entry("linear:ENG-1", "2026-08-27T11:00:00Z")])).toBe(true);
  });

  it("does not flag the same items again", () => {
    const items = [entry("linear:ENG-1", "2026-08-27T10:00:00Z")];
    seedInboxSeenIfNeeded(items);
    expect(inboxHasUnseenItems(items)).toBe(false);
  });

  it("clears one item when that card is opened, leaving other unseen", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    const next = [
      entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
      entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
    ];
    expect(inboxHasUnseenItems(next)).toBe(true);
    markInboxItemSeen(next[1]!);
    expect(isInboxEntryUnseen(next[1]!)).toBe(false);
    expect(isInboxEntryUnseen(next[0]!)).toBe(false);
    expect(inboxHasUnseenItems(next)).toBe(false);
  });

  it("keeps the badge until every new card has been opened", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    const next = [
      entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
      entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
      entry("linear:ENG-3", "2026-08-27T10:02:00Z"),
    ];
    expect(inboxHasUnseenItems(next)).toBe(true);
    markInboxItemSeen(next[1]!);
    expect(inboxHasUnseenItems(next)).toBe(true);
    markInboxItemSeen(next[2]!);
    expect(inboxHasUnseenItems(next)).toBe(false);
  });

  it("marks all supplied items as seen", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    const next = [
      entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
      entry("linear:ENG-3", "2026-08-27T10:02:00Z"),
    ];
    expect(inboxHasUnseenItems(next)).toBe(true);
    markInboxItemsSeen(next);
    expect(inboxHasUnseenItems(next)).toBe(false);
  });

  it("marks an unchanged item read from either local checkout after an older snapshot arrives", () => {
    const older = entry("github:acme/web:issue:4", "2026-08-27T10:00:00Z");
    const current = { ...older, updatedAt: "2026-08-27T11:00:00Z" };
    seedInboxSeenIfNeeded([older]);
    rememberInboxItems([{ ...current, projectPath: "/repos/old" }]);
    rememberInboxItems([{ ...current, projectPath: "/repos/new" }]);
    rememberInboxItems([{ ...older, projectPath: "/repos/old" }]);

    for (const path of ["/repos/old", "/repos/new"]) {
      expect(knownInboxEntries([path])).toEqual([expect.objectContaining(current)]);
    }
    expect(knownInboxEntries(["/repos/unrelated"])).toEqual([]);
    markInboxItemsSeen(knownInboxEntries(["/repos/new"]));
    expect(isInboxEntryUnseen(current)).toBe(false);
    expect(isInboxEntryUnseen({ ...current, updatedAt: "2026-08-27T12:00:00Z" })).toBe(true);
  });

  it("treats a new item with an unreadable timestamp as unseen", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    expect(inboxHasUnseenItems([entry("linear:ENG-2", "not-a-date")])).toBe(true);
  });

  it("is seeded after the first snapshot", () => {
    expect(inboxSeenIsSeeded()).toBe(false);
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    expect(inboxSeenIsSeeded()).toBe(true);
  });

  it("does not treat existing items as new if a card is opened before seed", () => {
    markInboxItemSeen(entry("linear:ENG-2", "2026-08-27T10:01:00Z"));
    expect(inboxSeenIsSeeded()).toBe(false);
    seedInboxSeenIfNeeded([
      entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
      entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
    ]);
    expect(
      inboxHasUnseenItems([
        entry("linear:ENG-1", "2026-08-27T10:00:00Z"),
        entry("linear:ENG-2", "2026-08-27T10:01:00Z"),
      ]),
    ).toBe(false);
  });
});
