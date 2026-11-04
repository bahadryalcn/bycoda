import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_SEEN_MAX_AGE_MS,
  INBOX_SEEN_MAX_ENTRIES,
  clearKnownInboxItems,
  knownInboxEntries,
  rememberInboxItems,
  inboxHasUnseenItems,
  inboxSeenIsSeeded,
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
  unseenInboxKeys,
} from "./inboxSeen";

const KEY = "bycoda.inboxSeen";
/** The fixtures below are dated 2026-08-27; pin "now" so the 90-day prune never reaches them. */
const NOW = Date.parse("2026-09-01T00:00:00Z");

function mockLocalStorage() {
  const data = new Map<string, string>();
  const reads: string[] = [];
  const storage = {
    getItem: (key: string) => {
      reads.push(key);
      return data.get(key) ?? null;
    },
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
  return { data, reads };
}

function entry(key: string, updatedAt: string): { key: string; updatedAt: string } {
  return { key, updatedAt };
}

describe("inbox seen items", () => {
  let storage: ReturnType<typeof mockLocalStorage>;
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    storage = mockLocalStorage();
    clearKnownInboxItems();
  });
  afterEach(() => {
    localStorage.removeItem(KEY);
    vi.useRealTimers();
  });

  it("parses the stored value once per distinct string, not once per read", () => {
    seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
    const parse = vi.spyOn(JSON, "parse");
    const list = [entry("linear:ENG-1", "2026-08-27T10:00:00Z"), entry("linear:ENG-2", "2026-08-27T11:00:00Z")];
    for (let index = 0; index < 50; index++) {
      expect(isInboxEntryUnseen(list[1]!)).toBe(true);
      expect(inboxHasUnseenItems(list)).toBe(true);
    }
    expect(unseenInboxKeys(list)).toEqual(new Set(["linear:ENG-2"]));
    expect(parse).not.toHaveBeenCalled();
    // A value written by another window is a different string and is parsed again.
    storage.data.set(KEY, JSON.stringify({ seeded: true, items: { "linear:ENG-2": Date.parse(list[1]!.updatedAt) } }));
    expect(isInboxEntryUnseen(list[1]!)).toBe(false);
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });

  it("invalidates the parsed cache and notifies subscribers on another window's storage event", () => {
    const listener = vi.fn();
    const dispatch = vi.fn();
    vi.stubGlobal("window", { addEventListener: dispatch, removeEventListener: vi.fn() });
    try {
      const stop = subscribeInboxSeen(listener);
      const onStorage = dispatch.mock.calls.find(([type]) => type === "storage")?.[1] as (
        event: { key: string | null },
      ) => void;
      expect(onStorage).toBeTypeOf("function");
      seedInboxSeenIfNeeded([entry("linear:ENG-1", "2026-08-27T10:00:00Z")]);
      listener.mockClear();
      onStorage({ key: "unrelated" });
      expect(listener).not.toHaveBeenCalled();
      storage.data.set(KEY, JSON.stringify({ seeded: true, items: {} }));
      onStorage({ key: KEY });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(isInboxEntryUnseen(entry("linear:ENG-1", "2026-08-27T10:00:00Z"))).toBe(true);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops entries older than the retention and keeps the newest ones under the cap", () => {
    const stale = new Date(NOW - INBOX_SEEN_MAX_AGE_MS - 86_400_000).toISOString();
    const fresh = new Date(NOW - 86_400_000).toISOString();
    seedInboxSeenIfNeeded([entry("linear:OLD", stale), entry("linear:NEW", fresh)]);
    expect(Object.keys(JSON.parse(storage.data.get(KEY)!).items)).toEqual(["linear:NEW"]);

    const many = Array.from({ length: INBOX_SEEN_MAX_ENTRIES + 10 }, (_, index) =>
      entry(`github:acme/web:issue:${index}`, new Date(NOW - 3_600_000 * (index + 1)).toISOString()),
    );
    markInboxItemsSeen(many);
    const items = JSON.parse(storage.data.get(KEY)!).items as Record<string, number>;
    expect(Object.keys(items)).toHaveLength(INBOX_SEEN_MAX_ENTRIES);
    expect(items["github:acme/web:issue:0"]).toBeDefined();
    expect(items[`github:acme/web:issue:${INBOX_SEEN_MAX_ENTRIES + 9}`]).toBeUndefined();
    expect(isInboxEntryUnseen(many[0]!)).toBe(false);
  });

  it("keeps an old entry for an item the Inbox still lists so it does not flip back to new", () => {
    const stale = new Date(NOW - INBOX_SEEN_MAX_AGE_MS - 86_400_000).toISOString();
    rememberInboxItems([{ key: "linear:STALE", updatedAt: stale, projectPath: "/repos/old" }]);
    seedInboxSeenIfNeeded([entry("linear:STALE", stale)]);
    markInboxItemSeen(entry("linear:OTHER", "2026-08-27T10:00:00Z"));
    expect(isInboxEntryUnseen(entry("linear:STALE", stale))).toBe(false);
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
