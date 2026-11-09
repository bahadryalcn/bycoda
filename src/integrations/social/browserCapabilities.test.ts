import { describe, expect, it } from "vitest";
import { accountCapabilities } from "./capabilities";
import { NOT_YET_OPERATIONS } from "./capabilities/shared";
import {
  browserContentIssue,
  browserOperations,
  browserScopes,
  X_BROWSER_OPERATIONS,
} from "./browserCapabilities";
import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialJob,
  type SocialPlatform,
} from "../../features/social/model/social";

const account = (platform: SocialAccount["platform"]): SocialAccount => ({
  id: "a",
  platform,
  platformId: "verified",
  name: "Fixture",
  accountType: "member",
  connection: "browser",
  scopes: platform === "x" ? [] : browserScopes(platform),
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  createdAt: 1,
});
describe("browser connection capability contracts", () => {
  it("restricts PDFs to titled LinkedIn browser publications and never fetches document URLs", () => {
    const job = {
      kind: "publish",
      payload: {
        text: "Guide",
        media: [{ kind: "document", uploadId: "owned", title: "Bycoda guide" }],
      },
    } as unknown as SocialJob;
    expect(browserContentIssue(account("linkedin"), job)).toBeUndefined();
    expect(browserContentIssue(account("facebook"), job)).toContain(
      "Document publishing requires LinkedIn",
    );
    expect(
      browserContentIssue(account("linkedin"), {
        ...job,
        payload: {
          ...job.payload,
          media: [{ kind: "document", url: "https://example.com/guide.pdf", title: "Guide" }],
        },
      }),
    ).toContain("Document publishing requires LinkedIn");
    expect(browserContentIssue(account("linkedin"), { ...job, kind: "reply" })).toBeTruthy();
  });
  it("requires explicit Snapchat destination and matching metadata without discarding Story content", () => {
    const profile = {
      ...account("snapchat"),
      accountType: "public_profile" as const,
      platformId: "web:snapchat:public_profile:11111111-1111-1111-1111-111111111111",
    };
    const job = {
      kind: "publish",
      payload: { text: "", media: [{ kind: "video", uploadId: "owned" }] },
    } as unknown as SocialJob;
    expect(browserContentIssue(profile, job)).toContain("Choose Story or Spotlight");
    const configured = {
      ...job,
      payload: {
        ...job.payload,
        snapchat: { target: "story" as const, durationSeconds: 10, width: 540, height: 960 },
      },
    };
    expect(browserContentIssue(profile, configured)).toBeUndefined();
    expect(
      browserContentIssue(profile, {
        ...configured,
        payload: { ...configured.payload, text: "Unreviewed caption" },
      }),
    ).toContain("do not support a caption");
    expect(
      browserContentIssue(profile, {
        ...configured,
        payload: {
          ...configured.payload,
          snapchat: { ...configured.payload.snapchat, durationSeconds: 4 },
        },
      }),
    ).toContain("5–60");
  });
  // reddit has no browser recipe (owner decision D4); its API rows are covered in capabilities/reddit.test.ts.
  it.each(SOCIAL_PLATFORMS.filter((platform) => platform !== "x" && platform !== "reddit"))(
    "connects %s without official API scopes while preserving missing-operation state",
    (platform) => {
      const capabilities = accountCapabilities(account(platform));
      expect(capabilities.some((capability) => capability.status === "available")).toBe(true);
      expect(capabilities.find((capability) => capability.operation === "search")?.status).toBe(
        "unsupported",
      );
      expect(capabilities.find((capability) => capability.operation === "webhook")?.status).toBe(
        "unsupported",
      );
      expect(
        accountCapabilities({ ...account(platform), connected: false }).every(
          (capability) => capability.status !== "available",
        ),
      ).toBe(true);
    },
  );
  it("does not grant bot-token API operations to a personal Telegram web identity", () => {
    const capabilities = accountCapabilities({
      ...account("telegram"),
      connection: "token",
      scopes: ["bot.send", "bot.poll"],
    });
    expect(capabilities.every((capability) => capability.status === "unsupported")).toBe(true);
  });
  it("requires owner-uploaded browser media rather than fetching arbitrary URLs", () => {
    const job = {
      kind: "publish",
      payload: { text: "photo", media: [{ kind: "image", url: "https://example.com/image.png" }] },
    } as unknown as SocialJob;
    expect(browserContentIssue(account("instagram"), job)).toContain("owner-uploaded");
    expect(
      browserContentIssue(account("instagram"), {
        ...job,
        payload: { ...job.payload, media: [{ kind: "image", uploadId: "owned-upload" }] },
      }),
    ).toBeUndefined();
  });
  it("keeps unavailable conversation media blocked even when publishing accepts images", () => {
    const job = {
      kind: "reply",
      payload: {
        text: "reply",
        media: [{ kind: "image", uploadId: "owned-upload" }],
        postId: "known-post",
      },
    } as unknown as SocialJob;
    expect(browserContentIssue(account("instagram"), job)).toContain("text-only");
  });
  it("separates Snapchat selected Public Profile publication from personal Web Chat", () => {
    const member = accountCapabilities(account("snapchat"));
    expect(member.find((capability) => capability.operation === "publish")?.status).toBe(
      "unsupported",
    );
    expect(member.find((capability) => capability.operation === "message.reply")?.status).toBe(
      "available",
    );
    const profile = accountCapabilities({ ...account("snapchat"), accountType: "public_profile" });
    expect(profile.find((capability) => capability.operation === "publish")?.status).toBe(
      "available",
    );
    expect(profile.find((capability) => capability.operation === "poll")?.status).toBe(
      "unsupported",
    );
  });
  it("reports an expired web identity rather than offering an available write", () => {
    const capabilities = accountCapabilities({ ...account("facebook"), expiresAt: 100 }, 101);
    expect(capabilities.find((capability) => capability.operation === "publish")?.status).toBe(
      "expired",
    );
  });
});

describe("browser operations come from the recipe table", () => {
  it("gives X browser accounts the X session operations, not an empty list", () => {
    expect(browserOperations({ platform: "x", accountType: "member" })).toEqual(
      X_BROWSER_OPERATIONS,
    );
  });

  it("offers a not-yet operation through a browser recipe only where that recipe is wired", () => {
    // audience.collect: TikTok Studio commenters and Snapchat chat contacts (member accounts).
    const wired: Partial<Record<SocialPlatform, string[]>> = {
      tiktok: ["audience.collect"],
      snapchat: ["audience.collect"],
    };
    for (const platform of SOCIAL_PLATFORMS) {
      const operations = browserOperations({
        platform,
        accountType: "member",
      }) as readonly string[];
      expect(
        NOT_YET_OPERATIONS.filter((operation) => operations.includes(operation)),
        platform,
      ).toEqual(wired[platform] ?? []);
    }
  });

  it("refuses an inbox-mode TikTok upload in the browser, which needs the API", () => {
    const job = {
      kind: "publish",
      payload: {
        text: "",
        media: [{ kind: "video", uploadId: "owned" }],
        tiktok: { mode: "inbox" },
      },
    } as unknown as SocialJob;
    expect(browserContentIssue(account("tiktok"), job)).toBe(
      "Inbox drafts need the API connection.",
    );
  });

  it("refuses a campaign or rule message on a personal WhatsApp account, but allows a single message", () => {
    const single = {
      kind: "message",
      payload: { text: "hello", media: [], recipientId: "r1" },
    } as unknown as SocialJob;
    expect(browserContentIssue(account("whatsapp"), single)).toBeUndefined();
    expect(browserContentIssue(account("whatsapp"), { ...single, campaignId: "c1" })).toContain(
      "one message per job",
    );
    expect(browserContentIssue(account("whatsapp"), { ...single, ruleId: "rule1" })).toContain(
      "one message per job",
    );
  });
});
