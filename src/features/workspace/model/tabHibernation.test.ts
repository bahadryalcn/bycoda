import { describe, expect, it } from "vitest";
import {
  expiredUnseenSessionIds,
  HIBERNATE_AFTER_MS,
  recordTabVisits,
  sameIdSet,
  selectHibernatedTabIds,
  trackUnseenSince,
  UNSEEN_FINISHED_TTL_MS,
} from "./tabHibernation";

const MIN = 60_000;

describe("recordTabVisits", () => {
  it("stamps the active tab and gives first-seen tabs the current time", () => {
    const visits = recordTabVisits(new Map(), ["a", "b"], "a", 1_000);
    expect(visits).toEqual(new Map([["a", 1_000], ["b", 1_000]]));
  });

  it("keeps the last visit of an inactive tab and drops tabs that are gone", () => {
    const first = recordTabVisits(new Map(), ["a", "b", "c"], "a", 1_000);
    const next = recordTabVisits(first, ["a", "b"], "b", 5_000);
    expect(next).toEqual(new Map([["a", 1_000], ["b", 5_000]]));
  });
});

describe("selectHibernatedTabIds", () => {
  const base = { activeTabId: "active", now: 20 * MIN };

  it("hibernates an eligible tab only once its visit is at least the window old", () => {
    const visits = new Map([
      ["active", 20 * MIN],
      ["old", 20 * MIN - HIBERNATE_AFTER_MS],
      ["recent", 20 * MIN - HIBERNATE_AFTER_MS + 1],
    ]);
    const hibernated = selectHibernatedTabIds({
      ...base,
      tabIds: ["active", "old", "recent"],
      visits,
      eligibleIds: new Set(["active", "old", "recent"]),
    });
    expect([...hibernated]).toEqual(["old"]);
  });

  it("never hibernates the active tab or an ineligible tab", () => {
    const visits = new Map([
      ["active", 0],
      ["busy", 0],
      ["idle", 0],
    ]);
    const hibernated = selectHibernatedTabIds({
      ...base,
      tabIds: ["active", "busy", "idle"],
      visits,
      eligibleIds: new Set(["idle"]),
    });
    expect([...hibernated]).toEqual(["idle"]);
  });

  it("does not hibernate a tab without a recorded visit", () => {
    const hibernated = selectHibernatedTabIds({
      ...base,
      tabIds: ["unknown"],
      visits: new Map(),
      eligibleIds: new Set(["unknown"]),
    });
    expect(hibernated.size).toBe(0);
  });
});

describe("sameIdSet", () => {
  it("compares membership, not order", () => {
    expect(sameIdSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameIdSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameIdSet(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(false);
  });
});

describe("unseen finished TTL", () => {
  it("expires a badge only after the TTL and restarts it when the session finishes again", () => {
    let since = trackUnseenSince(new Map(), new Set(["a"]), 1_000);
    since = trackUnseenSince(since, new Set(["a", "b"]), 5_000);
    expect(since).toEqual(new Map([["a", 1_000], ["b", 5_000]]));
    expect([...expiredUnseenSessionIds(since, 1_000 + UNSEEN_FINISHED_TTL_MS - 1)]).toEqual([]);
    expect([...expiredUnseenSessionIds(since, 1_000 + UNSEEN_FINISHED_TTL_MS)]).toEqual(["a"]);

    since = trackUnseenSince(since, new Set(["b"]), 9_000);
    since = trackUnseenSince(since, new Set(["a", "b"]), 10_000);
    expect(since.get("a")).toBe(10_000);
    expect(since.get("b")).toBe(5_000);
  });
});
