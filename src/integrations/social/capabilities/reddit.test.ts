import { describe, expect, it } from "vitest";
import {
  SOCIAL_API_ACCOUNT_TYPES,
  type SocialAccount,
} from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";
import { CAPABILITY_OPERATIONS } from "./shared";

const NOW = 1_000;
const ALL_SCOPES = ["identity", "submit", "read", "privatemessages", "history", "edit"];

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "33333333-3333-4333-8333-333333333333",
    platform: "reddit",
    platformId: "t2_abc",
    name: "u/owner",
    accountType: "member",
    connection: "oauth",
    scopes: ALL_SCOPES,
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;

const rowOf = (rows: ReturnType<typeof accountCapabilities>, operation: string) =>
  rows.find((row) => row.operation === operation);

describe("Reddit capability map", () => {
  it("returns one row per contract operation for the API connection", () => {
    const rows = accountCapabilities(account(), NOW);
    expect(rows.map((row) => row.operation)).toEqual(CAPABILITY_OPERATIONS);
    expect(rows.every((row) => row.reasonCode.length > 0)).toBe(true);
  });

  it("marks the operations Reddit serves as available when the scopes are granted", () => {
    const rows = accountCapabilities(account(), NOW);
    for (const operation of [
      "publish",
      "reply",
      "comment",
      "inbox.read",
      "message.reply",
      "message.start",
      "poll",
      "comments.read",
      "delete",
      "audience.collect",
      "profile.read",
    ])
      expect(rowOf(rows, operation), operation).toMatchObject({
        status: "available",
        reasonCode: "api.ready",
      });
  });

  it("keeps media, search, webhook and analytics unsupported with their own reasons", () => {
    const rows = accountCapabilities(account(), NOW);
    expect(rowOf(rows, "media")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
    expect(rowOf(rows, "search")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
    expect(rowOf(rows, "webhook")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
    expect(rowOf(rows, "analytics")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.not_yet",
    });
  });

  it("reports the exact missing scope as pending instead of available", () => {
    const rows = accountCapabilities(account({ scopes: ["identity", "read"] }), NOW);
    expect(rowOf(rows, "publish")).toMatchObject({
      status: "pending",
      reasonCode: "reddit.publish.api_required",
      scopes: ["submit"],
    });
    expect(rowOf(rows, "inbox.read")).toMatchObject({
      status: "pending",
      scopes: ["privatemessages"],
    });
  });

  it("refuses non-member account types on the API connection", () => {
    const rows = accountCapabilities(
      account({ accountType: "bot" as SocialAccount["accountType"] }),
      NOW,
    );
    expect(SOCIAL_API_ACCOUNT_TYPES.reddit).toEqual(["member"]);
    expect(rowOf(rows, "publish")).toMatchObject({
      status: "unsupported",
      reasonCode: "api.account_type_unsupported",
    });
  });

  it("reports every operation unsupported on a browser connection, since no browser recipe is enabled", () => {
    const rows = accountCapabilities(account({ connection: "browser", scopes: [] }), NOW);
    expect(rows.every((row) => row.status === "unsupported")).toBe(true);
    expect(rowOf(rows, "publish")?.reasonCode).toBe("browser.no_recipe");
    expect(rowOf(rows, "delete")?.reasonCode).toBe("unsupported.not_yet");
  });

  it("names the Reddit documentation as the source for API rows", () => {
    const rows = accountCapabilities(account(), NOW);
    expect(rowOf(rows, "publish")?.source).toBe("https://www.reddit.com/dev/api/");
  });
});
