import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../features/social/model/social";
import { accountCapabilities } from "./capabilities";

const account = (
  platform: "facebook" | "instagram",
  scopes: string[],
  connection: SocialAccount["connection"] = "oauth",
): SocialAccount => ({
  id: "account",
  platform,
  platformId: platform === "facebook" ? "111" : "17841",
  name: "Account",
  accountType: platform === "facebook" ? "page" : "professional",
  scopes,
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: {},
  connection,
  createdAt: 1,
});

const row = (caps: ReturnType<typeof accountCapabilities>, operation: string) => {
  const found = caps.find((item) => item.operation === operation);
  if (!found) throw new Error(`missing ${operation}`);
  return found;
};

describe("Meta capability map", () => {
  it("opens Facebook post deletion, analytics and audience collection on the API connection with their scopes", () => {
    const caps = accountCapabilities(
      account("facebook", [
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_read_user_content",
        "read_insights",
      ]),
    );
    expect(row(caps, "delete")).toMatchObject({ status: "available", reasonCode: "api.ready" });
    expect(row(caps, "analytics")).toMatchObject({ status: "available" });
    expect(row(caps, "audience.collect")).toMatchObject({ status: "available" });
  });

  it("reports a missing Facebook analytics scope as pending with a Facebook-specific reason code", () => {
    const caps = accountCapabilities(account("facebook", ["pages_read_engagement"]));
    expect(row(caps, "analytics")).toMatchObject({
      status: "pending",
      reasonCode: "facebook.analytics.api_required",
    });
  });

  it("requires pages_read_engagement for Facebook media, matching publishing (B13)", () => {
    const onlyManage = accountCapabilities(account("facebook", ["pages_manage_posts"]));
    expect(row(onlyManage, "media")).toMatchObject({
      status: "pending",
      reasonCode: "facebook.media.api_required",
    });
    const both = accountCapabilities(
      account("facebook", ["pages_manage_posts", "pages_read_engagement"]),
    );
    expect(row(both, "media")).toMatchObject({ status: "available" });
  });

  it("keeps Instagram post deletion and arbitrary-media comments unsupported", () => {
    const caps = accountCapabilities(
      account("instagram", ["instagram_business_basic", "instagram_business_manage_comments"]),
    );
    expect(row(caps, "delete")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
    expect(row(caps, "comment")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
  });

  it("opens Instagram analytics and comment audiences on the API connection only", () => {
    const caps = accountCapabilities(
      account("instagram", [
        "instagram_business_basic",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments",
      ]),
    );
    expect(row(caps, "analytics")).toMatchObject({ status: "available" });
    expect(row(caps, "audience.collect")).toMatchObject({ status: "available" });
    expect(row(caps, "search")).toMatchObject({ status: "unsupported" });
  });

  it("never opens the Meta API-only operations on a browser connection", () => {
    for (const platform of ["facebook", "instagram"] as const) {
      const caps = accountCapabilities(account(platform, [], "browser"));
      for (const operation of ["delete", "analytics", "audience.collect"]) {
        expect(row(caps, operation), `${platform}.${operation}`).toMatchObject({
          status: "unsupported",
          reasonCode: "unsupported.not_yet",
        });
      }
    }
  });
});
