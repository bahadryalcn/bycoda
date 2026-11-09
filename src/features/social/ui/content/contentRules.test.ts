import { describe, expect, it } from "vitest";
import type { Capability, SocialAccount, SocialCampaign, SocialPolicies } from "../../model/social";
import {
  draftFromCampaign,
  emptyDraft,
  withUtm,
  type ContentDraft,
  type ContentMedia,
} from "./contentDraft";
import {
  accountAvailability,
  buildVariants,
  characterCount,
  characterLimit,
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

function video(probe: ContentMedia["probe"] = {}): ContentMedia {
  return { localId: "v1", name: "clip.mp4", media: { kind: "video", uploadId: "v1" }, probe };
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
      policies: { global: {}, platforms: {} } as SocialPolicies,
    },
    now: NOW,
    ...extra,
  };
}

describe("media rules per platform", () => {
  it("allows up to four X images or one video, never a mix", () => {
    const x = account({ id: "x1", platform: "x" });
    expect(mediaProblems(x.platform, [image("a"), image("b"), image("c"), image("d")])).toEqual([]);
    expect(
      mediaProblems(x.platform, [image("a"), image("b"), image("c"), image("d"), image("e")]),
    ).toHaveLength(1);
    expect(mediaProblems(x.platform, [video(), image("a")])).toHaveLength(1);
    expect(mediaProblems(x.platform, [video()])).toEqual([]);
  });

  it("keeps TikTok and YouTube to exactly one video", () => {
    expect(mediaProblems("tiktok", [])).toHaveLength(1);
    expect(mediaProblems("youtube", [image("a")])).toHaveLength(1);
    expect(mediaProblems("youtube", [video()])).toEqual([]);
  });

  it("limits Instagram and Facebook to one video or four images", () => {
    expect(mediaProblems("instagram", [video(), video()])).toHaveLength(1);
    expect(
      mediaProblems("facebook", [image("a"), image("b"), image("c"), image("d"), image("e")]),
    ).toHaveLength(1);
    expect(mediaProblems("instagram", [image("a")])).toEqual([]);
  });
});

describe("Facebook Reel rules", () => {
  it("does nothing for a feed post", () => {
    expect(reelProblems(undefined, [])).toEqual([]);
    expect(reelProblems({ target: "feed" }, [])).toEqual([]);
  });

  it("accepts one 9:16 video of 4 to 60 seconds with a frame rate of at least 23", () => {
    const media = [video({ durationSeconds: 30, width: 1080, height: 1920 })];
    expect(reelProblems({ target: "reel", frameRate: 30 }, media)).toEqual([]);
  });

  it("names each broken rule", () => {
    expect(reelProblems({ target: "reel", frameRate: 30 }, [])).toHaveLength(1);
    expect(
      reelProblems({ target: "reel", frameRate: 30 }, [
        video({ durationSeconds: 2, width: 1080, height: 1920 }),
      ]),
    ).toHaveLength(1);
    expect(
      reelProblems({ target: "reel", frameRate: 30 }, [
        video({ durationSeconds: 30, width: 1920, height: 1080 }),
      ]),
    ).toHaveLength(1);
    expect(
      reelProblems({ target: "reel", frameRate: 22 }, [
        video({ durationSeconds: 30, width: 1080, height: 1920 }),
      ]),
    ).toHaveLength(1);
    expect(
      reelProblems({ target: "reel" }, [video({ durationSeconds: 30, width: 1080, height: 1920 })]),
    ).toHaveLength(1);
  });
});

describe("TikTok privacy and consent", () => {
  it("requires an explicit privacy choice and consent, never a default", () => {
    const media = [video({ durationSeconds: 20 })];
    const problems = tiktokProblems({}, media);
    expect(problems.join(" ")).toContain("Choose who can see");
    expect(problems.join(" ")).toContain("consent");
    expect(tiktokProblems({ privacy: "SELF_ONLY", consent: true }, media)).toEqual([]);
  });

  it("rejects privacy the creator does not offer and videos longer than the account allows", () => {
    const creator = {
      nickname: "n",
      privacyOptions: ["SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxDurationSeconds: 60,
    };
    expect(
      tiktokProblems(
        { privacy: "PUBLIC_TO_EVERYONE", consent: true },
        [video({ durationSeconds: 20 })],
        creator,
      ),
    ).toHaveLength(1);
    expect(
      tiktokProblems(
        { privacy: "SELF_ONLY", consent: true },
        [video({ durationSeconds: 90 })],
        creator,
      ),
    ).toHaveLength(1);
  });

  it("needs a readable video length", () => {
    expect(tiktokProblems({ privacy: "SELF_ONLY", consent: true }, [video({})])).toHaveLength(1);
  });
});

describe("YouTube and Reddit", () => {
  it("requires a title up to 100 characters, privacy and an answer on made-for-kids", () => {
    expect(youtubeProblems({})).toHaveLength(3);
    expect(
      youtubeProblems({ title: "x".repeat(101), privacy: "public", madeForKids: false }),
    ).toHaveLength(1);
    expect(youtubeProblems({ title: "Launch", privacy: "public", madeForKids: false })).toEqual([]);
  });

  it("requires exactly one valid subreddit and reports Reddit posting as not connected", () => {
    expect(redditProblems(undefined)).toHaveLength(1);
    expect(redditProblems({ subreddit: "a b", flair: "" })[0]).toContain("Choose one subreddit");
    expect(redditProblems({ subreddit: "launches", flair: "" })).toEqual([
      "Reddit posting is not connected to the Host yet.",
    ]);
  });
});

describe("characters and links", () => {
  it("counts Telegram channel bot posts in UTF-16 units and other posts in code points", () => {
    const bot = account({
      id: "t1",
      platform: "telegram",
      accountType: "channel",
      connection: "token",
    });
    const web = account({ id: "x1", platform: "x" });
    expect(characterCount(bot, "😀")).toBe(2);
    expect(characterCount(web, "😀")).toBe(1);
  });

  it("applies the Facebook Reel and Telegram media caps", () => {
    const fb = account({ id: "f1", platform: "facebook" });
    const bot = account({
      id: "t1",
      platform: "telegram",
      accountType: "channel",
      connection: "token",
    });
    const policies = { global: { maxContentCharacters: 5000 }, platforms: {} } as SocialPolicies;
    expect(characterLimit(fb, policies, { reel: true })).toBe(2200);
    expect(characterLimit(bot, policies, { hasMedia: true })).toBe(1024);
    expect(characterLimit(bot, policies, { hasMedia: false })).toBe(4096);
  });

  it("adds UTM parameters to a valid link only", () => {
    const utm = { source: "bycoda", medium: "social", campaign: "launch" };
    expect(withUtm("https://example.com/a", utm)).toBe(
      "https://example.com/a?utm_source=bycoda&utm_medium=social&utm_campaign=launch",
    );
    expect(withUtm("not a url", utm)).toBe("not a url");
    expect(withUtm("", utm)).toBe("");
  });
});

describe("account availability", () => {
  it("disables an account without draft access or publish capability, with the reason", () => {
    const noAccess = account({ id: "a", platform: "linkedin", grants: {} });
    expect(
      accountAvailability(noAccess, { projectId: "p1", snapshot: input({}, [noAccess]).snapshot }),
    ).toEqual({
      disabled: true,
      reason: "No access to this project. Grant it in Accounts & Settings.",
    });
    const unavailable = account({ id: "b", platform: "linkedin" });
    const snapshot = {
      capabilities: { b: [capability("unsupported", "unsupported.not_yet")] },
      policies: undefined,
    };
    expect(accountAvailability(unavailable, { projectId: "p1", snapshot })).toEqual({
      disabled: true,
      reason: "Not available yet",
    });
  });
});

describe("draftProblems", () => {
  it("asks for a project, content and an account before anything else", () => {
    const x = account({ id: "x1", platform: "x" });
    const problems = draftProblems(
      input({ text: "", accountIds: [] }, [x], { projectId: undefined }),
    ).map((p) => p.text);
    expect(problems).toEqual([
      "Choose a project first.",
      "Write the post or attach media.",
      "Choose at least one account.",
    ]);
  });

  it("names the account when its character limit is exceeded", () => {
    const x = account({ id: "x1", platform: "x" });
    const draft = input({ text: "a".repeat(281) }, [x]);
    draft.snapshot!.policies = {
      global: { maxContentCharacters: 280 },
      platforms: {},
    } as SocialPolicies;
    const problems = draftProblems(draft);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.accountId).toBe("x1");
    expect(problems[0]!.text).toContain("280");
  });

  it("rejects a schedule in the past and an incomplete repeat", () => {
    const x = account({ id: "x1", platform: "x" });
    const past = draftProblems(input({ when: "later", scheduledAt: "2020-01-01T10:00" }, [x]));
    expect(past.map((p) => p.text)).toContain("Pick a time in the future.");
    const repeat = draftProblems(
      input({ repeat: { enabled: true, minMinutes: 300, maxMinutes: 120, totalPosts: 3 } }, [x]),
    );
    expect(repeat.map((p) => p.text)).toContain(
      "Repeat: the longest interval must be at least the shortest.",
    );
  });

  it("stops a post whose chosen account is gone instead of publishing without it", () => {
    const x = account({ id: "x1", platform: "x" });
    expect(draftProblems(input({ accountIds: ["x1", "gone"] }, [x]))).toEqual([
      { text: "This account is no longer available. Uncheck it to continue.", accountId: "gone" },
    ]);
  });

  it("is empty for a valid X post", () => {
    expect(draftProblems(input({}, [account({ id: "x1", platform: "x" })]))).toEqual([]);
  });
});

describe("buildVariants", () => {
  it("builds the platform options the Host accepts, with the probe values and UTM link", () => {
    const tiktok = account({ id: "tt", platform: "tiktok" });
    const reel = account({ id: "fb", platform: "facebook" });
    const draft = input(
      {
        text: "  Ship it  ",
        link: "https://example.com",
        utm: { source: "bycoda", medium: "", campaign: "" },
        media: [video({ durationSeconds: 25, width: 1080, height: 1920 })],
        factIds: ["f1"],
        platform: {
          tt: { tiktok: { privacy: "SELF_ONLY", consent: true, allowComment: true } },
          fb: { facebook: { target: "reel", frameRate: 30 } },
        },
      },
      [tiktok, reel],
    );
    const [first, second] = buildVariants({ ...draft, now: NOW });
    expect(first!.text).toBe("Ship it");
    expect(first!.link).toBe("https://example.com/?utm_source=bycoda");
    expect(first!.factIds).toEqual(["f1"]);
    expect(first!.scheduledAt).toBe(NOW);
    expect(first!.tiktok).toMatchObject({
      privacy: "SELF_ONLY",
      durationSeconds: 25,
      consent: true,
      allowComment: true,
      allowDuet: false,
    });
    expect(second!.facebook).toEqual({
      target: "reel",
      durationSeconds: 25,
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
  });

  it("keeps the YouTube and TikTok options that have no form control when a saved post is edited", () => {
    const campaign: SocialCampaign = {
      id: "c1",
      name: "Launch",
      projectIds: ["p1"],
      revision: 3,
      paused: false,
      createdAt: 1,
      variants: [
        {
          accountId: "yt1",
          text: "Hi",
          media: [{ kind: "video", uploadId: "v1" }],
          scheduledAt: NOW,
          factIds: [],
          youtube: {
            title: "T",
            privacy: "public",
            madeForKids: false,
            containsSyntheticMedia: false,
            categoryId: "22",
            publishAt: NOW + 3_600_000,
          },
        },
        {
          accountId: "tt1",
          text: "Hi",
          media: [{ kind: "video", uploadId: "v1" }],
          scheduledAt: NOW,
          factIds: [],
          tiktok: {
            privacy: "SELF_ONLY",
            durationSeconds: 20,
            allowComment: false,
            allowDuet: false,
            allowStitch: false,
            brandContent: false,
            brandOrganic: false,
            isAigc: false,
            consent: true,
            mode: "inbox",
            mediaType: "video",
            autoAddMusic: true,
          },
        },
      ],
    };
    const rules = input(draftFromCampaign(campaign), [
      account({ id: "yt1", platform: "youtube" }),
      account({ id: "tt1", platform: "tiktok" }),
    ]);
    // The YouTube variant comes first and has no size or length; the TikTok duration must still survive.
    expect(draftProblems(rules)).toEqual([]);
    const [youtube, tiktok] = buildVariants(rules);
    expect(youtube!.youtube).toEqual({
      title: "T",
      privacy: "public",
      madeForKids: false,
      containsSyntheticMedia: false,
      categoryId: "22",
      publishAt: NOW + 3_600_000,
    });
    expect(tiktok!.tiktok).toMatchObject({
      mode: "inbox",
      mediaType: "video",
      autoAddMusic: true,
      durationSeconds: 20,
      consent: true,
    });
  });

  it("keeps the upload identity when a saved campaign is loaded for editing", () => {
    const draft = draftFromCampaign({
      id: "c1",
      name: "Launch",
      projectIds: ["p1"],
      revision: 4,
      paused: false,
      createdAt: 1,
      variants: [
        {
          accountId: "x1",
          text: "Hi",
          media: [{ kind: "image", uploadId: "u1" }],
          scheduledAt: NOW,
          factIds: ["f1"],
        },
      ],
    });
    expect(draft.campaignId).toBe("c1");
    expect(draft.revision).toBe(4);
    expect(draft.media[0]!.localId).toBe("u1");
    expect(draft.factIds).toEqual(["f1"]);
  });
});
