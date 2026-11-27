import { describe, expect, it } from "vitest";
import type { SocialAccount, SocialJob } from "../../model/social";
import { localScheduleHint, publishedXPosts, schedulesOnPlatform } from "./contentSchedule";

const account = (platform: string, connection?: string) =>
  ({ id: platform, name: platform, platform, connection }) as unknown as SocialAccount;
const job = (patch: Partial<SocialJob>) =>
  ({
    accountId: "x",
    kind: "publish",
    status: "succeeded",
    platformId: "123",
    createdAt: 1,
    payload: { text: "Hello  world", media: [] },
    ...patch,
  }) as unknown as SocialJob;

describe("schedule hint", () => {
  it("schedules on the platform only for YouTube and Facebook APIs", () => {
    expect(schedulesOnPlatform(account("youtube"))).toBe(true);
    expect(schedulesOnPlatform(account("facebook", "oauth"))).toBe(true);
    expect(schedulesOnPlatform(account("facebook", "browser"))).toBe(false);
    expect(schedulesOnPlatform(account("x"))).toBe(false);
  });

  it("hints only for local schedules and stays short", () => {
    expect(localScheduleHint(account("youtube"))).toBeUndefined();
    const hint = localScheduleHint(account("x"));
    expect(hint).toContain("x");
    expect(hint!.length).toBeLessThan(100);
  });
});

describe("publishedXPosts", () => {
  it("lists succeeded numeric publishes of the account, newest first", () => {
    const posts = publishedXPosts(
      [
        job({ platformId: "1", createdAt: 1 }),
        job({ platformId: "2", createdAt: 2 }),
        job({ platformId: "3", status: "failed" }),
        job({ platformId: "4", accountId: "other" }),
        job({ platformId: "abc" }),
        job({ platformId: "5", kind: "reply" }),
      ],
      "x",
    );
    expect(posts.map((post) => post.id)).toEqual(["2", "1"]);
    expect(posts[0]!.label).toBe("Hello world");
  });
});
