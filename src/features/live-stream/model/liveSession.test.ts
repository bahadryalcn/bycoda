import { describe, expect, it } from "vitest";
import type { LiveEvent, LiveViewer } from "./liveEvents";
import { emptyLiveSession, liveSessionSnapshot, reduceLiveSession } from "./liveSession";

const viewer = (id: string, name = id): LiveViewer => ({ id, handle: id, name });
const at = 1;

function fold(events: LiveEvent[]) {
  return events.reduce(reduceLiveSession, emptyLiveSession());
}

describe("live session", () => {
  it("counts comments, likes, follows, gifts and the peak viewer count", () => {
    const state = fold([
      { id: "1", at, kind: "comment", viewer: viewer("a"), text: "hi" },
      { id: "2", at, kind: "like", viewer: viewer("a"), count: 7 },
      { id: "3", at, kind: "follow", viewer: viewer("b") },
      {
        id: "4",
        at,
        kind: "gift",
        viewer: viewer("a"),
        giftId: 1,
        giftName: "Rose",
        diamonds: 5,
        count: 3,
      },
      { id: "5", at, kind: "viewers", count: 40 },
      { id: "6", at, kind: "viewers", count: 25 },
    ]);
    expect(state.totals).toEqual({
      diamonds: 15,
      gifts: 3,
      comments: 1,
      likes: 7,
      follows: 1,
      peakViewers: 40,
    });
    expect(state.viewers).toBe(25);
  });

  it("ignores a repeated event id", () => {
    const comment: LiveEvent = { id: "1", at, kind: "comment", viewer: viewer("a"), text: "hi" };
    const once = fold([comment]);
    expect(reduceLiveSession(once, comment)).toBe(once);
  });

  it("ranks top gifters by total diamonds", () => {
    const gift = (id: string, who: string, diamonds: number): LiveEvent => ({
      id,
      at,
      kind: "gift",
      viewer: viewer(who, who.toUpperCase()),
      giftId: 1,
      giftName: "Rose",
      diamonds,
      count: 1,
    });
    const state = fold([gift("1", "a", 5), gift("2", "b", 30), gift("3", "a", 40)]);
    expect(liveSessionSnapshot(state).topGifters.map((gifter) => gifter.name)).toEqual(["A", "B"]);
  });
});
