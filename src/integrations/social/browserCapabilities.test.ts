import { describe, expect, it } from "vitest";
import { accountCapabilities } from "./capabilities";
import { browserContentIssue, browserScopes } from "./browserCapabilities";
import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialJob,
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
  it.each(SOCIAL_PLATFORMS.filter((platform) => platform !== "x"))(
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
