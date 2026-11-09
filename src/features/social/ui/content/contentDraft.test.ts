import { describe, expect, it } from "vitest";
import type { SocialCampaign, TikTokVideoOptions } from "../../model/social";
import {
  DEFAULT_REPEAT,
  draftFromCampaign,
  draftName,
  emptyDraft,
  mediaOf,
  scheduledMs,
  setPlatform,
  toggleAccount,
  type ContentMedia,
} from "./contentDraft";

const tiktokOptions: TikTokVideoOptions = {
  privacy: "SELF_ONLY",
  durationSeconds: 42,
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: false,
  consent: true,
};

function campaign(
  patch: Partial<SocialCampaign["variants"][number]> = {},
  rest: Partial<SocialCampaign> = {},
): SocialCampaign {
  return {
    id: "c1",
    name: "Launch",
    projectIds: ["p1"],
    revision: 3,
    paused: false,
    createdAt: 1,
    variants: [{ accountId: "x1", text: "Hi", media: [], scheduledAt: 0, factIds: [], ...patch }],
    ...rest,
  };
}

describe("draft name", () => {
  it("prefers the trimmed campaign name, then the first line of the post, then a fixed fallback", () => {
    expect(draftName({ ...emptyDraft(), name: "  Launch  ", text: "Other" })).toBe("Launch");
    expect(draftName({ ...emptyDraft(), text: "\n  First line  \nSecond" })).toBe("First line");
    expect(draftName({ ...emptyDraft() })).toBe("Post");
  });

  it("cuts a long first line at 60 characters without splitting an emoji", () => {
    const name = draftName({ ...emptyDraft(), text: "😀".repeat(70) });
    expect(Array.from(name)).toHaveLength(60);
    expect(name).toBe("😀".repeat(60));
  });
});

describe("scheduled time", () => {
  it("means 'now' (undefined) for an immediate post, even when an old time is still typed", () => {
    expect(
      scheduledMs({ ...emptyDraft(), when: "now", scheduledAt: "2020-01-01T10:00" }),
    ).toBeUndefined();
  });

  it("is NaN for a 'later' post with no usable time, never a silent default", () => {
    expect(scheduledMs({ ...emptyDraft(), when: "later", scheduledAt: "" })).toBeNaN();
    expect(scheduledMs({ ...emptyDraft(), when: "later", scheduledAt: "not-a-date" })).toBeNaN();
  });

  it("reads the local datetime value as a local time", () => {
    expect(scheduledMs({ ...emptyDraft(), when: "later", scheduledAt: "2099-01-05T14:30" })).toBe(
      new Date(2099, 0, 5, 14, 30).getTime(),
    );
  });
});

describe("draft helpers", () => {
  it("toggles an account without changing the original list", () => {
    const ids = ["a", "b"];
    expect(toggleAccount(ids, "c")).toEqual(["a", "b", "c"]);
    expect(toggleAccount(ids, "a")).toEqual(["b"]);
    expect(ids).toEqual(["a", "b"]);
  });

  it("merges platform options per account and leaves other accounts and the old draft alone", () => {
    const draft = {
      ...emptyDraft(),
      platform: { tt: { tiktok: { privacy: "SELF_ONLY" } }, yt: { youtube: { title: "A" } } },
    };
    const next = setPlatform(draft, "tt", { tiktok: { privacy: "SELF_ONLY", consent: true } });
    expect(next.platform.tt).toEqual({ tiktok: { privacy: "SELF_ONLY", consent: true } });
    expect(next.platform.yt).toEqual({ youtube: { title: "A" } });
    expect(draft.platform.tt).toEqual({ tiktok: { privacy: "SELF_ONLY" } });
    expect(setPlatform(draft, "fb", { facebook: { target: "reel" } }).platform.tt).toEqual(
      draft.platform.tt,
    );
  });

  it("hands the Host only the media item, not the local name or probe", () => {
    const item: ContentMedia = {
      localId: "u1",
      name: "clip.mp4",
      media: { kind: "video", uploadId: "u1" },
      probe: { durationSeconds: 9 },
      mediaId: "m1",
    };
    expect(mediaOf([item])).toEqual([{ kind: "video", uploadId: "u1" }]);
  });
});

describe("draftFromCampaign", () => {
  it("reopens a future time as 'Later' with the local datetime value", () => {
    const at = new Date(2099, 0, 5, 14, 30).getTime();
    const draft = draftFromCampaign(campaign({ scheduledAt: at }));
    expect(draft.when).toBe("later");
    expect(draft.scheduledAt).toBe("2099-01-05T14:30");
  });

  it("reopens a time that has passed as 'Now' so it cannot be scheduled in the past by accident", () => {
    const draft = draftFromCampaign(
      campaign({ scheduledAt: new Date(2020, 0, 5, 9, 0).getTime() }),
    );
    expect(draft.when).toBe("now");
  });

  it("keeps the TikTok choices but moves the video length to the media probe", () => {
    const draft = draftFromCampaign(
      campaign({ tiktok: tiktokOptions, media: [{ kind: "video", uploadId: "v1" }] }),
    );
    expect(draft.platform.x1!.tiktok).toMatchObject({
      privacy: "SELF_ONLY",
      consent: true,
      allowComment: true,
    });
    expect(draft.platform.x1!.tiktok).not.toHaveProperty("durationSeconds");
    expect(draft.media[0]!.probe).toEqual({ durationSeconds: 42 });
  });

  it("restores a Facebook Reel with its size, length and frame rate", () => {
    const draft = draftFromCampaign(
      campaign({
        facebook: { target: "reel", durationSeconds: 30, width: 1080, height: 1920, frameRate: 30 },
        media: [{ kind: "video", uploadId: "v1" }],
      }),
    );
    expect(draft.platform.x1!.facebook).toEqual({ target: "reel", frameRate: 30 });
    expect(draft.media[0]!.probe).toEqual({ durationSeconds: 30, width: 1080, height: 1920 });
  });

  it("copies YouTube options and gives images no video probe", () => {
    const youtube = {
      title: "Hi",
      privacy: "private" as const,
      madeForKids: false,
      containsSyntheticMedia: false,
    };
    const draft = draftFromCampaign(
      campaign({ youtube, media: [{ kind: "image", uploadId: "i1" }] }),
    );
    expect(draft.platform.x1!.youtube).toEqual(youtube);
    expect(draft.platform.x1!.youtube).not.toBe(youtube);
    expect(draft.media[0]!.probe).toBeUndefined();
  });

  it("names saved media by title, then url, then kind, and keeps a stable local id", () => {
    const draft = draftFromCampaign(
      campaign({
        media: [
          { kind: "image", url: "https://cdn.example.com/a.png", title: "Cover" },
          { kind: "image", url: "https://cdn.example.com/b.png" },
          { kind: "image" },
        ],
      }),
    );
    expect(draft.media.map((item) => item.name)).toEqual([
      "Cover",
      "https://cdn.example.com/b.png",
      "image",
    ]);
    expect(draft.media.map((item) => item.localId)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/b.png",
      "saved-2",
    ]);
  });

  it("loads every account of the campaign and an empty campaign as an empty editable draft", () => {
    const two = campaign(
      {},
      {
        variants: [
          campaign({ accountId: "a" }).variants[0]!,
          campaign({ accountId: "b" }).variants[0]!,
        ],
      },
    );
    expect(draftFromCampaign(two).accountIds).toEqual(["a", "b"]);
    const empty = draftFromCampaign(campaign({}, { variants: [] }));
    expect(empty).toMatchObject({
      campaignId: "c1",
      revision: 3,
      text: "",
      link: "",
      accountIds: [],
      media: [],
      factIds: [],
    });
  });

  it("does not share mutable state with the saved campaign or with the default repeat", () => {
    const saved = campaign({ factIds: ["f1"], media: [{ kind: "image", uploadId: "i1" }] });
    const draft = draftFromCampaign(saved);
    draft.factIds.push("f2");
    draft.media[0]!.media.alt = "changed";
    draft.repeat.totalPosts = 99;
    expect(saved.variants[0]!.factIds).toEqual(["f1"]);
    expect(saved.variants[0]!.media[0]).toEqual({ kind: "image", uploadId: "i1" });
    expect(DEFAULT_REPEAT.totalPosts).toBe(10);
    expect(emptyDraft().repeat.totalPosts).toBe(10);
  });
});
