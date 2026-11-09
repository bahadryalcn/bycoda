import { describe, expect, it } from "vitest";
import type {
  Capability,
  SocialAccount,
  SocialPolicies,
  TikTokCreatorInfo,
} from "../../model/social";
import { emptyDraft, type ContentDraft, type ContentMedia } from "./contentDraft";
import {
  buildVariants,
  characterCount,
  draftProblems,
  mediaProblems,
  redditProblems,
  reelProblems,
  tiktokProblems,
  youtubeProblems,
  type RuleInput,
} from "./contentRules";

const NOW = Date.UTC(2026, 10, 7, 9, 0);

function account(
  patch: Partial<SocialAccount> & { id: string; platform: SocialAccount["platform"] },
): SocialAccount {
  return {
    platformId: `${patch.id}-platform`,
    name: `${patch.platform} account`,
    accountType: "member",
    scopes: [],
    accessApproved: true,
    connected: true,
    connection: "oauth",
    paused: false,
    executorId: "exec",
    grants: { p1: ["read", "draft", "publish"] },
    createdAt: 1,
    ...patch,
  } as SocialAccount;
}

function capability(status: Capability["status"], reasonCode = "api.ready"): Capability {
  return { operation: "publish", status, reason: "", reasonCode, scopes: [], source: "test" };
}

function video(probe: ContentMedia["probe"] = {}, id = "v1"): ContentMedia {
  return { localId: id, name: `${id}.mp4`, media: { kind: "video", uploadId: id }, probe };
}

function image(id: string): ContentMedia {
  return { localId: id, name: `${id}.jpg`, media: { kind: "image", uploadId: id } };
}

function input(
  draft: Partial<ContentDraft>,
  accounts: SocialAccount[],
  extra: Partial<RuleInput> = {},
): RuleInput {
  const base = {
    ...emptyDraft(),
    text: "Hello",
    accountIds: accounts.map((item) => item.id),
    ...draft,
  };
  return {
    draft: base,
    projectId: "p1",
    accounts,
    snapshot: {
      capabilities: Object.fromEntries(
        accounts.map((item) => [item.id, [capability("available")]]),
      ),
      policies: { global: { maxContentCharacters: 5000 }, platforms: {} } as SocialPolicies,
    },
    now: NOW,
    ...extra,
  };
}

const REEL_OK = { durationSeconds: 30, width: 1080, height: 1920 };
const reel = (frameRate?: number) => ({ target: "reel" as const, frameRate });
const texts = (problems: { text: string }[]) => problems.map((problem) => problem.text);

describe("media limits per platform", () => {
  it("never lets X mix a video with images or take more than one video", () => {
    expect(mediaProblems("x", [video(), video({}, "v2")])).toEqual([
      "X posts take either up to four images or one video.",
    ]);
    expect(mediaProblems("x", [video(), image("a")])).toHaveLength(1);
    expect(mediaProblems("x", [])).toEqual([]);
  });

  it("names the right rule for Instagram and Facebook mixes and for a fifth image", () => {
    const five = ["a", "b", "c", "d", "e"].map(image);
    expect(mediaProblems("instagram", [video(), image("a")])).toEqual([
      "Attach either one video or up to four images.",
    ]);
    expect(mediaProblems("facebook", five)).toEqual(["Up to four images per post."]);
    expect(mediaProblems("facebook", [video()])).toEqual([]);
    expect(mediaProblems("instagram", five.slice(0, 4))).toEqual([]);
  });

  it("asks TikTok and YouTube for exactly one video, never two or a video with an image", () => {
    for (const platform of ["tiktok", "youtube"] as const) {
      expect(mediaProblems(platform, [video(), video({}, "v2")])).toEqual([
        "Attach exactly one video.",
      ]);
      expect(mediaProblems(platform, [video(), image("a")])).toEqual(["Attach exactly one video."]);
      expect(mediaProblems(platform, [video()])).toEqual([]);
    }
  });

  it("has no attachment rule of its own for the other platforms", () => {
    for (const platform of ["linkedin", "telegram", "whatsapp", "snapchat", "reddit"] as const)
      expect(mediaProblems(platform, [video(), video({}, "v2"), image("a")])).toEqual([]);
  });
});

describe("Facebook Reel boundaries", () => {
  it("accepts the smallest and largest supported video", () => {
    expect(
      reelProblems(reel(23), [video({ durationSeconds: 4, width: 540, height: 960 })]),
    ).toEqual([]);
    expect(
      reelProblems(reel(29.97), [video({ durationSeconds: 60, width: 1080, height: 1920 })]),
    ).toEqual([]);
  });

  it.each([
    [
      "shorter than 4 seconds",
      { ...REEL_OK, durationSeconds: 3.99 },
      "Reels take 4 to 60 seconds.",
    ],
    [
      "longer than 60 seconds",
      { ...REEL_OK, durationSeconds: 60.01 },
      "Reels take 4 to 60 seconds.",
    ],
    [
      "narrower than 540",
      { ...REEL_OK, width: 539, height: 959 },
      "Reels need a 9:16 video of at least 540 × 960.",
    ],
    [
      "not 9:16",
      { ...REEL_OK, width: 1080, height: 1080 },
      "Reels need a 9:16 video of at least 540 × 960.",
    ],
    [
      "a fractional width",
      { ...REEL_OK, width: 540.5, height: 960 },
      "Reels need a 9:16 video of at least 540 × 960.",
    ],
    [
      "landscape",
      { ...REEL_OK, width: 1920, height: 1080 },
      "Reels need a 9:16 video of at least 540 × 960.",
    ],
    [
      "an unreadable length",
      { ...REEL_OK, durationSeconds: Number.NaN },
      "The video length could not be read.",
    ],
    ["no size", { durationSeconds: 30 }, "The video size could not be read."],
  ])("names a single problem for a video that is %s", (_name, probe, message) => {
    expect(reelProblems(reel(30), [video(probe)])).toEqual([message]);
  });

  it.each([0, 22.99, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "rejects a frame rate of %s",
    (frameRate) => {
      expect(reelProblems(reel(frameRate), [video(REEL_OK)])).toEqual([
        "Enter the frame rate, at least 23 fps.",
      ]);
    },
  );

  it("asks for the frame rate when none was entered", () => {
    expect(reelProblems(reel(), [video(REEL_OK)])).toEqual([
      "Enter the frame rate, at least 23 fps.",
    ]);
  });

  it("needs exactly one video for a Reel", () => {
    expect(reelProblems(reel(30), [image("a")])).toEqual(["A Reel needs exactly one video."]);
    expect(reelProblems(reel(30), [video(REEL_OK), video(REEL_OK, "v2")])).toEqual([
      "A Reel needs exactly one video.",
    ]);
  });

  it("reports every broken rule together", () => {
    expect(
      reelProblems(reel(10), [video({ durationSeconds: 2, width: 100, height: 100 })]),
    ).toHaveLength(3);
  });
});

describe("TikTok rules", () => {
  const creator: TikTokCreatorInfo = {
    nickname: "n",
    privacyOptions: ["SELF_ONLY"],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxDurationSeconds: 60,
  };

  it("lists privacy and consent as separate problems and does not default either", () => {
    expect(tiktokProblems(undefined, [video({ durationSeconds: 10 })])).toEqual([
      "Choose who can see the TikTok video.",
      "Confirm the TikTok content consent.",
    ]);
    expect(
      tiktokProblems({ privacy: "SELF_ONLY", consent: false }, [video({ durationSeconds: 10 })]),
    ).toEqual(["Confirm the TikTok content consent."]);
  });

  it("allows a video exactly as long as the creator limit and rejects one second more", () => {
    const options = { privacy: "SELF_ONLY", consent: true };
    expect(tiktokProblems(options, [video({ durationSeconds: 60 })], creator)).toEqual([]);
    expect(tiktokProblems(options, [video({ durationSeconds: 61 })], creator)).toEqual([
      "This video is longer than your TikTok account allows.",
    ]);
  });

  it("skips the creator checks until the creator options are loaded", () => {
    expect(
      tiktokProblems({ privacy: "ANYTHING", consent: true }, [video({ durationSeconds: 600 })]),
    ).toEqual([]);
  });

  it("asks for a readable video length when there is no video", () => {
    expect(tiktokProblems({ privacy: "SELF_ONLY", consent: true }, [])).toEqual([
      "The video length could not be read.",
    ]);
  });
});

describe("YouTube and Reddit boundaries", () => {
  it("accepts a title of exactly 100 characters and counts emoji as one character each", () => {
    const options = { privacy: "private" as const, madeForKids: false };
    expect(youtubeProblems({ ...options, title: "x".repeat(100) })).toEqual([]);
    expect(youtubeProblems({ ...options, title: "😀".repeat(100) })).toEqual([]);
    expect(youtubeProblems({ ...options, title: "😀".repeat(101) })).toEqual([
      "YouTube titles can be at most 100 characters.",
    ]);
  });

  it("treats a blank title as missing and a made-for-kids answer of no as an answer", () => {
    expect(youtubeProblems({ title: "   ", privacy: "public", madeForKids: false })).toEqual([
      "Enter a YouTube title.",
    ]);
    expect(youtubeProblems({ title: "Launch", privacy: "public" })).toEqual([
      "Say whether the video is made for kids.",
    ]);
  });

  it("accepts subreddits of 3 to 21 letters, numbers and underscores, trimmed", () => {
    const connected = ["Reddit posting is not connected to the Host yet."];
    expect(redditProblems({ subreddit: "abc", flair: "" })).toEqual(connected);
    expect(redditProblems({ subreddit: "a".repeat(21), flair: "" })).toEqual(connected);
    expect(redditProblems({ subreddit: " launches ", flair: "" })).toEqual(connected);
    for (const subreddit of ["ab", "a".repeat(22), "r/launches", "my-sub", ""])
      expect(redditProblems({ subreddit, flair: "" })[0]).toContain("Choose one subreddit");
  });
});

describe("characters and captions", () => {
  const bot = account({
    id: "t1",
    platform: "telegram",
    accountType: "channel",
    connection: "token",
  });

  it("counts the link after a newline in UTF-16 units for a Telegram channel bot", () => {
    expect(characterCount(bot, "😀", "https://a.b")).toBe("😀\nhttps://a.b".length);
    expect(characterCount(bot, "abc")).toBe(3);
  });

  it("holds a Telegram channel media caption to 1024 units but lets text-only posts use 4096", () => {
    const text = "a".repeat(1010);
    const link = "https://example.com";
    const withMedia = draftProblems(input({ text, link, media: [image("a")] }, [bot]));
    expect(withMedia).toHaveLength(1);
    expect(withMedia[0]!.text).toContain("1024");
    expect(withMedia[0]!.accountId).toBe("t1");
    expect(draftProblems(input({ text, link }, [bot]))).toEqual([]);
  });

  it("allows a Telegram channel post that is only media, with no caption", () => {
    expect(draftProblems(input({ text: "", media: [image("a")] }, [bot]))).toEqual([]);
  });

  it("holds a Facebook Reel caption to 2200 characters but not a feed post", () => {
    const fb = account({ id: "fb1", platform: "facebook" });
    const media = [video(REEL_OK)];
    const text = "a".repeat(2201);
    const asReel = draftProblems(
      input({ text, media, platform: { fb1: { facebook: reel(30) } } }, [fb]),
    );
    expect(asReel).toHaveLength(1);
    expect(asReel[0]!.text).toContain("2200");
    expect(
      draftProblems(
        input({ text, media, platform: { fb1: { facebook: { target: "feed" } } } }, [fb]),
      ),
    ).toEqual([]);
  });

  it("lets a Reel go out with no caption when the video is valid", () => {
    const fb = account({ id: "fb1", platform: "facebook" });
    expect(
      draftProblems(
        input({ text: "", media: [video(REEL_OK)], platform: { fb1: { facebook: reel(30) } } }, [
          fb,
        ]),
      ),
    ).toEqual([]);
  });
});

describe("draftProblems per account", () => {
  it("flags only the account whose attachment rule is broken and prefixes its name", () => {
    const x = account({ id: "x1", platform: "x" });
    const linkedin = account({ id: "li1", platform: "linkedin" });
    const problems = draftProblems(
      input({ media: ["a", "b", "c", "d", "e"].map(image) }, [x, linkedin]),
    );
    expect(problems).toEqual([
      {
        text: "X · x account: X posts take either up to four images or one video.",
        accountId: "x1",
      },
    ]);
  });

  it("prefixes the attachment problem of every account that breaks a rule", () => {
    const x = account({ id: "x1", platform: "x" });
    const fb = account({ id: "fb1", platform: "facebook" });
    const problems = draftProblems(input({ media: ["a", "b", "c", "d", "e"].map(image) }, [x, fb]));
    expect(problems).toEqual([
      {
        text: "X · x account: X posts take either up to four images or one video.",
        accountId: "x1",
      },
      { text: "Facebook · facebook account: Up to four images per post.", accountId: "fb1" },
    ]);
  });

  it("flags a Reel with a wrong video on the Facebook account only", () => {
    const x = account({ id: "x1", platform: "x" });
    const fb = account({ id: "fb1", platform: "facebook" });
    const problems = draftProblems(
      input(
        {
          media: [video({ durationSeconds: 2, width: 1080, height: 1920 })],
          platform: { fb1: { facebook: reel(30) } },
        },
        [x, fb],
      ),
    );
    expect(problems.map((problem) => problem.accountId)).toEqual(["fb1"]);
    expect(problems[0]!.text).toContain("Reels take 4 to 60 seconds.");
  });

  it("adds the TikTok creator limit for that account", () => {
    const tt = account({ id: "tt1", platform: "tiktok" });
    const creator: TikTokCreatorInfo = {
      nickname: "n",
      privacyOptions: ["SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxDurationSeconds: 10,
    };
    const draft = {
      media: [video({ durationSeconds: 20 })],
      platform: { tt1: { tiktok: { privacy: "SELF_ONLY", consent: true } } },
    };
    expect(
      draftProblems(input(draft, [tt], { creator: { tt1: creator } })).map(
        (problem) => problem.text,
      ),
    ).toEqual(["TikTok · tiktok account: This video is longer than your TikTok account allows."]);
    expect(draftProblems(input(draft, [tt]))).toEqual([]);
  });

  it("keeps a Reddit post blocked even when the subreddit is valid", () => {
    const reddit = account({ id: "r1", platform: "reddit" });
    expect(
      draftProblems(
        input({ platform: { r1: { reddit: { subreddit: "launches", flair: "" } } } }, [reddit]),
      ),
    ).toEqual([
      {
        text: "Reddit · reddit account: Reddit posting is not connected to the Host yet.",
        accountId: "r1",
      },
    ]);
  });

  it("names the account that cannot publish right now", () => {
    const x = account({ id: "x1", platform: "x" });
    const problems = draftProblems(
      input({}, [x], {
        snapshot: {
          capabilities: { x1: [capability("expired", "api.token_expired")] },
          policies: undefined as never,
        },
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]!.accountId).toBe("x1");
    expect(problems[0]!.text.startsWith("X · x account: ")).toBe(true);
  });
});

describe("draftProblems time, link and repeat", () => {
  const x = account({ id: "x1", platform: "x" });

  it("asks for a valid time when Later has no date and accepts a future one", () => {
    expect(texts(draftProblems(input({ when: "later", scheduledAt: "" }, [x])))).toEqual([
      "Pick a valid time.",
    ]);
    expect(draftProblems(input({ when: "later", scheduledAt: "2099-01-01T10:00" }, [x]))).toEqual(
      [],
    );
  });

  it("accepts only http and https links", () => {
    expect(texts(draftProblems(input({ link: "ftp://example.com" }, [x])))).toEqual([
      "Enter a link that starts with https://.",
    ]);
    expect(texts(draftProblems(input({ link: "example.com" }, [x])))).toEqual([
      "Enter a link that starts with https://.",
    ]);
    expect(draftProblems(input({ link: "https://example.com/a" }, [x]))).toEqual([]);
  });

  it("checks the repeat interval and count only when repeating is on", () => {
    const bad = { minMinutes: 0, maxMinutes: 0, totalPosts: 0 };
    expect(draftProblems(input({ repeat: { enabled: false, ...bad } }, [x]))).toEqual([]);
    expect(texts(draftProblems(input({ repeat: { enabled: true, ...bad } }, [x])))).toEqual([
      "Repeat: the longest interval must be at least the shortest.",
      "Repeat: enter how many posts to make.",
    ]);
    expect(
      draftProblems(
        input({ repeat: { enabled: true, minMinutes: 60, maxMinutes: 60, totalPosts: 1 } }, [x]),
      ),
    ).toEqual([]);
  });
});

describe("buildVariants shape", () => {
  const x = account({ id: "x1", platform: "x" });
  const yt = account({ id: "yt1", platform: "youtube" });
  const fb = account({ id: "fb1", platform: "facebook" });

  it("gives every variant its own copy of the fact ids", () => {
    const draft = input({ factIds: ["f1", "f2"] }, [x, yt]);
    const [first, second] = buildVariants(draft);
    expect(first!.factIds).toEqual(["f1", "f2"]);
    expect(first!.factIds).not.toBe(draft.draft.factIds);
    expect(first!.factIds).not.toBe(second!.factIds);
  });

  it("follows the chosen account order, drops unknown ids and sends no link key without a link", () => {
    const draft = input({ accountIds: ["yt1", "gone", "x1"], text: "  Hi  " }, [x, yt]);
    const variants = buildVariants(draft);
    expect(variants.map((variant) => variant.accountId)).toEqual(["yt1", "x1"]);
    expect(variants[0]!.text).toBe("Hi");
    expect("link" in variants[0]!).toBe(false);
  });

  it("sends the Host only the upload references, not names or probe data", () => {
    const [variant] = buildVariants(input({ media: [image("a"), video(REEL_OK)] }, [x]));
    expect(variant!.media).toEqual([
      { kind: "image", uploadId: "a" },
      { kind: "video", uploadId: "v1" },
    ]);
  });

  it("uses the chosen local time for a scheduled post and now for an immediate one", () => {
    const [later] = buildVariants(input({ when: "later", scheduledAt: "2027-03-01T10:00" }, [x]));
    expect(later!.scheduledAt).toBe(new Date("2027-03-01T10:00").getTime());
    const [immediate] = buildVariants(input({}, [x]));
    expect(immediate!.scheduledAt).toBe(NOW);
  });

  it("builds YouTube options with a trimmed title and safe defaults, and none for other platforms", () => {
    const draft = input(
      { platform: { yt1: { youtube: { title: "  Launch  ", privacy: "public" } } } },
      [x, yt],
    );
    const [xVariant, ytVariant] = buildVariants(draft);
    expect(xVariant!.youtube).toBeUndefined();
    expect(ytVariant!.youtube).toEqual({
      title: "Launch",
      privacy: "public",
      madeForKids: false,
      containsSyntheticMedia: false,
    });
    const [defaulted] = buildVariants(
      input({ accountIds: ["yt1"], platform: { yt1: { youtube: { title: "T" } } } }, [yt]),
    );
    expect(defaulted!.youtube!.privacy).toBe("private");
  });

  it("sends no Facebook options for a feed post and zero metadata when the probe is missing", () => {
    const feed = buildVariants(
      input({ platform: { fb1: { facebook: { target: "feed" } } } }, [fb]),
    );
    expect(feed[0]!.facebook).toBeUndefined();
    const noProbe = buildVariants(
      input({ media: [video()], platform: { fb1: { facebook: reel(30) } } }, [fb]),
    );
    expect(noProbe[0]!.facebook).toEqual({
      target: "reel",
      durationSeconds: 0,
      width: 0,
      height: 0,
      frameRate: 30,
    });
  });
});
