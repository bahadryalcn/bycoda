import { describe, expect, it } from "vitest";
import type { SocialAccount } from "../../../features/social/model/social";
import { accountCapabilities } from "../capabilities";
import type { SocialCapability } from "./shared";

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "a",
    platform: "x",
    platformId: "42",
    name: "@owner",
    accountType: "member",
    connection: "token",
    scopes: [],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;

const row = (caps: SocialCapability[], operation: string) =>
  caps.find((item) => item.operation === operation)!;

const OPENED = ["delete", "analytics", "audience.collect", "profile.read"] as const;
const ALL_API_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "follows.read",
  "like.read",
  "media.write",
  "dm.read",
  "dm.write",
];

describe("X API operations", () => {
  it("reports them available with an API reason when every scope is granted", () => {
    const caps = accountCapabilities(account({ scopes: ALL_API_SCOPES }));
    for (const operation of OPENED) {
      expect(row(caps, operation), operation).toMatchObject({
        status: "available",
        reasonCode: "api.ready",
      });
    }
  });

  it("shows a missing scope as pending with a per-operation reason code", () => {
    const caps = accountCapabilities(account({ scopes: ["tweet.read", "users.read"] }));
    expect(row(caps, "delete")).toMatchObject({
      status: "pending",
      reasonCode: "x.delete.api_required",
    });
    expect(row(caps, "audience.collect")).toMatchObject({
      status: "pending",
      reasonCode: "x.audience.collect.api_required",
    });
    expect(row(caps, "profile.read")).toMatchObject({ status: "available" });
  });

  it("requires follower and liker scopes before audience collection", () => {
    const caps = accountCapabilities(
      account({ scopes: ["tweet.read", "users.read", "follows.read"] }),
    );
    expect(row(caps, "audience.collect").scopes).toEqual([
      "tweet.read",
      "users.read",
      "follows.read",
      "like.read",
    ]);
    expect(row(caps, "audience.collect").status).toBe("pending");
  });

  it("keeps the browser connection unsupported for them, with no API wording", () => {
    const caps = accountCapabilities(account({ connection: "browser", scopes: ["dm.read"] }));
    for (const operation of OPENED) {
      expect(row(caps, operation), operation).toMatchObject({
        status: "unsupported",
        reasonCode: "unsupported.not_yet",
      });
    }
    expect(JSON.stringify(caps.filter((item) => item.status !== "unsupported"))).not.toMatch(
      /X API|OAuth/,
    );
  });

  it("keeps keyword search unsupported", () => {
    const caps = accountCapabilities(account({ scopes: ALL_API_SCOPES }));
    expect(row(caps, "search")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported.platform",
    });
  });
});
