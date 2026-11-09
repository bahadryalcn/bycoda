import type { Announcement } from "@bycoda/account-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_POLL_MS,
  createAnnouncementFeed,
  startAnnouncementPolling,
  unseenAnnouncements,
} from "./announcementFeed";
import { memoryStorage } from "./testFixtures";

const item = (
  id: string,
  severity: Announcement["severity"],
  publishedAt: string,
): Announcement => ({ id, title: id, body: "body", severity, publishedAt });
const ids = (feed: ReturnType<typeof createAnnouncementFeed>) =>
  unseenAnnouncements(feed.getSnapshot()).map((entry) => entry.id);

describe("announcement feed", () => {
  it("lists unseen announcements critical first, then newest first", () => {
    const feed = createAnnouncementFeed(memoryStorage());
    feed.setItems([
      item("a", "info", "2026-11-01T00:00:00Z"),
      item("b", "info", "2026-11-05T00:00:00Z"),
      item("c", "critical", "2026-10-01T00:00:00Z"),
    ]);
    expect(ids(feed)).toEqual(["c", "b", "a"]);
  });

  it("remembers a dismissal per id across restarts", () => {
    const storage = memoryStorage();
    const feed = createAnnouncementFeed(storage);
    feed.setItems([
      item("a", "info", "2026-11-01T00:00:00Z"),
      item("b", "info", "2026-11-02T00:00:00Z"),
    ]);
    feed.dismiss("a");
    expect(ids(feed)).toEqual(["b"]);

    const restarted = createAnnouncementFeed(storage);
    restarted.setItems(feed.getSnapshot().items);
    expect(ids(restarted)).toEqual(["b"]);
  });

  it("survives unreadable storage", () => {
    const feed = createAnnouncementFeed(
      memoryStorage({ "bycoda.account.announcements.dismissed.v1": "{oops" }),
    );
    expect(feed.getSnapshot().dismissed).toEqual([]);
  });
});

describe("announcement polling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (
    overrides: { online?: () => boolean; fetchItems?: () => Promise<Announcement[]> } = {},
  ) => {
    const feed = { setItems: vi.fn() };
    const fetchItems = vi.fn(
      overrides.fetchItems ?? (async () => [item("a", "info", "2026-11-01T00:00:00Z")]),
    );
    const stop = startAnnouncementPolling({ feed, fetchItems, isOnline: overrides.online });
    return { feed, fetchItems, stop };
  };

  it("fetches at start and every interval until stopped", async () => {
    const { feed, fetchItems, stop } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(feed.setItems).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_POLL_MS);
    expect(fetchItems).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_POLL_MS);
    expect(fetchItems).toHaveBeenCalledTimes(2);
  });

  it("does nothing while offline", async () => {
    const { fetchItems, stop } = setup({ online: () => false });
    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_POLL_MS);
    expect(fetchItems).not.toHaveBeenCalled();
    stop();
  });

  it("does not start a second fetch while one is in flight", async () => {
    let release: (items: Announcement[]) => void = () => undefined;
    const { fetchItems, stop } = setup({
      fetchItems: () => new Promise((resolve) => (release = resolve)),
    });
    await vi.advanceTimersByTimeAsync(ANNOUNCEMENT_POLL_MS);
    expect(fetchItems).toHaveBeenCalledTimes(1);
    release([]);
    stop();
  });

  it("keeps the last list when a fetch fails", async () => {
    const { feed, stop } = setup({ fetchItems: async () => Promise.reject(new Error("down")) });
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.setItems).not.toHaveBeenCalled();
    stop();
  });
});
