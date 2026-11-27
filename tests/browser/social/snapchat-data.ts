import type { SnapchatContentPage } from "../../../src/integrations/social/snapchat-content";
import type {
  SnapchatEarningsResult,
  SnapchatInsightsResult,
} from "../../../src/integrations/social/snapchat-insights";
import type { SnapchatProfileState } from "../../../src/integrations/social/snapchat-profile";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { browserScopes } from "../../../src/integrations/social/browserCapabilities";

const profileId = "11111111-2222-4333-8444-555555555555";
export const spotlightId = "snap-spotlight-001";
export const storyId = "snap-public-story-001";
const api: SocialAccount = {
  id: "snapchat-api",
  platform: "snapchat",
  platformId: profileId,
  name: "Fixture Snapchat API",
  accountType: "public_profile",
  connection: "oauth",
  scopes: ["snapchat-profile-api"],
  connected: true,
  accessApproved: true,
  paused: false,
  executorId: "fixture",
  grants: { demo: ["read", "draft", "publish"] },
  createdAt: 1,
};
export const snapchatFixtureAccounts: SocialAccount[] = [
  api,
  {
    ...api,
    id: "snapchat-reader",
    platformId: "22222222-3333-4444-8555-666666666666",
    name: "Fixture Snapchat Read Only",
    grants: { demo: ["read"] },
  },
  {
    ...api,
    id: "snapchat-browser",
    platformId: "web:snapchat:public_profile:fixture-bycoda",
    name: "Fixture Snapchat Browser",
    connection: "browser",
    scopes: browserScopes("snapchat"),
  },
  {
    ...api,
    id: "snapchat-member",
    platformId: "web:snapchat:member:fixture-friend",
    name: "Fixture Snapchat Member",
    accountType: "member",
    connection: "browser",
    scopes: browserScopes("snapchat"),
    grants: { demo: ["read", "draft", "message"] },
  },
];

export function snapchatFixtureResult(action: string, input: Record<string, unknown> = {}) {
  switch (action) {
    case "snapchat.profile.read":
      return {
        hasPublicProfile: true,
        profileId: input.accountId === api.id ? profileId : undefined,
        name: "Fixture Studio",
        bio: "Behind the scenes and upcoming projects.",
        website: "https://example.test/studio",
        category: "Creator",
      } satisfies SnapchatProfileState;
    case "snapchat.monetization.get":
      return { status: "eligible", dailyRewardsEligible: true };
    case "snapchat.friends.list":
      if (input.accountId !== "snapchat-member") throw new Error("Wrong Snapchat friends account.");
      return { usernames: ["fixture.friend", "fixture.studio"], partial: true };
    case "snapchat.review.list":
      return input.accountId === "snapchat-browser"
        ? [
            {
              id: "fixture-review",
              accountId: input.accountId,
              action: "profile.update",
              input: { patch: { bio: "New behind-the-scenes series." } },
              status: "pending",
            },
          ]
        : [];
    case "snapchat.review.decide":
      return { status: "completed" };
    case "snapchat.content.list":
      if (input.target !== "spotlight")
        return { items: [], partial: false } satisfies SnapchatContentPage;
      if (input.cursor)
        return {
          items: [
            {
              id: "snap-spotlight-002",
              target: "spotlight",
              title: "Fixture studio tour",
              status: "submitted",
            },
          ],
          partial: false,
        } satisfies SnapchatContentPage;
      return {
        items: [
          {
            id: spotlightId,
            target: "spotlight",
            title: "Fixture launch clip",
            status: "live",
            createdAt: "2026-11-16T09:00:00Z",
          },
        ],
        cursor: "fixture-content-page-2",
        partial: true,
      } satisfies SnapchatContentPage;
    case "snapchat.content.delete":
      if (
        input.target === "story" &&
        (input.accountId !== "snapchat-browser" ||
          input.id !== storyId ||
          input.confirmId !== storyId)
      )
        throw new Error("Wrong Snapchat Story target.");
      return { id: input.id, target: input.target };
    case "snapchat.analytics.get":
      return {
        granularity: "LIFETIME",
        rows: input.cursor
          ? []
          : [
              {
                assetId: profileId,
                assetType: "PROFILE",
                metric: "SUBSCRIBERS",
                value: 2345,
              },
            ],
        partial: true,
        nextCursor: input.cursor ? undefined : "fixture-insights-page-2",
      } satisfies SnapchatInsightsResult;
    case "snapchat.earnings.get":
      if (input.accountId === "snapchat-reader") throw new Error("Fixture creator access denied.");
      return {
        startDate: "2026-11-12",
        endDate: "2026-11-18",
        dataThrough: "2026-11-17",
        rows: [
          {
            date: "2026-11-17",
            amountUsdMillis: 12345,
            currency: "USD",
            source: "SPOTLIGHT",
            state: "ESTIMATED",
          },
        ],
      } satisfies SnapchatEarningsResult;
    default:
      throw new Error(`Unexpected Snapchat fixture action: ${action}`);
  }
}
