import { describe, expect, it } from "vitest";
import { mapTikTokEvent, mapViewer } from "./tiktok-map";

const legacyUser = { userId: "42", uniqueId: "ayse", nickname: "Ayşe", profilePicture: { urls: ["http://x", "https://cdn/a.jpg"] } };
const v3User = { id: "43", displayId: "mehmet", nickname: "Mehmet", avatarThumb: { urlList: ["https://cdn/m.jpg"] } };

describe("TikTok event mapping", () => {
  it("reads both user shapes and keeps only https avatars", () => {
    expect(mapViewer(legacyUser)).toEqual({ id: "42", handle: "ayse", name: "Ayşe", avatarUrl: "https://cdn/a.jpg" });
    expect(mapViewer(v3User)).toEqual({ id: "43", handle: "mehmet", name: "Mehmet", avatarUrl: "https://cdn/m.jpg" });
    expect(mapViewer({})).toBeUndefined();
  });

  it("maps comments from either field and keeps the message id", () => {
    expect(mapTikTokEvent("chat", { user: legacyUser, comment: "halay", common: { msgId: "9" } }, 1)).toMatchObject({
      id: "chat:9",
      kind: "comment",
      text: "halay",
    });
    expect(mapTikTokEvent("chat", { user: v3User, content: "selam" }, 1)).toMatchObject({ kind: "comment", text: "selam" });
    expect(mapTikTokEvent("chat", { user: legacyUser }, 1)).toBeUndefined();
  });

  it("counts a streak gift once, when the streak ends", () => {
    const step = { user: legacyUser, giftId: 5655, repeatCount: 3, repeatEnd: 0, giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 1 } };
    expect(mapTikTokEvent("gift", step, 1)).toBeUndefined();
    expect(mapTikTokEvent("gift", { ...step, repeatEnd: 1, repeatCount: 7 }, 1)).toMatchObject({
      kind: "gift",
      giftName: "Rose",
      diamonds: 1,
      count: 7,
    });
  });

  it("maps a non-streak gift from extended info", () => {
    expect(mapTikTokEvent("gift", { user: legacyUser, giftId: "99", extendedGiftInfo: { name: "Lion", diamond_count: 29999, type: 2 } }, 1)).toMatchObject({
      giftId: 99,
      giftName: "Lion",
      diamonds: 29999,
      count: 1,
    });
  });

  it("uses connector 2.5 raw gift and like fields", () => {
    const gift = { user: v3User, gift: { id: "8", type: 1, diamondCount: 50, name: "Balloon" }, repeatCount: 3 };
    expect(mapTikTokEvent("gift", gift, 1)).toBeUndefined();
    expect(mapTikTokEvent("gift", { ...gift, repeatEnd: 1 }, 1)).toMatchObject({
      giftId: 8, giftName: "Balloon", diamonds: 50, count: 3,
    });
    expect(mapTikTokEvent("like", { user: v3User, count: 27 }, 1)).toMatchObject({ count: 27 });
  });

  it("maps likes, viewers and stream end", () => {
    expect(mapTikTokEvent("like", { user: legacyUser, likeCount: 15 }, 1)).toMatchObject({ kind: "like", count: 15 });
    expect(mapTikTokEvent("roomUser", { viewerCount: 321 }, 1)).toMatchObject({ kind: "viewers", count: 321 });
    expect(mapTikTokEvent("roomUser", { total: "12" }, 1)).toMatchObject({ kind: "viewers", count: 12 });
    expect(mapTikTokEvent("streamEnd", {}, 1)).toMatchObject({ kind: "stream-end" });
    expect(mapTikTokEvent("emote", { user: legacyUser }, 1)).toBeUndefined();
  });
});
