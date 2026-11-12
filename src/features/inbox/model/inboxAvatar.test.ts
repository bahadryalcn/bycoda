import { describe, expect, it } from "vitest";
import { inboxAvatarColor, isJiraAvatarUrl } from "./inboxAvatar";
import { inboxPersonAvatarUrl } from "./githubTasks";

describe("inboxAvatarColor", () => {
  it("keeps identity colors stable across whitespace and repeated calls", () => {
    expect(inboxAvatarColor(" Utku Aktürk ")).toBe(inboxAvatarColor("Utku Aktürk"));
    expect(inboxAvatarColor("account:123")).toBe(inboxAvatarColor("account:123"));
    expect(inboxAvatarColor("")).toMatch(/^var\(--ui-avatar-/);
  });

  it("distinguishes the header people and distributes identities across the palette", () => {
    expect(inboxAvatarColor("görkem duman")).not.toBe(inboxAvatarColor("Utku Aktürk"));
    expect(
      new Set(Array.from({ length: 60 }, (_, i) => inboxAvatarColor(`account:${i}`))).size,
    ).toBe(6);
  });
});

describe("Jira avatar URLs", () => {
  it("preserves explicit Jira pictures and leaves missing pictures empty", () => {
    const url = "https://acme.atlassian.net/secure/useravatar?avatarId=42";
    expect(inboxPersonAvatarUrl("jira", "Ada", ` ${url} `)).toBe(url);
    expect(inboxPersonAvatarUrl("jira", "Ada")).toBe("");
  });

  it("recognizes Jira site and public avatar URLs without matching lookalike hosts", () => {
    expect(isJiraAvatarUrl("https://acme.atlassian.net/secure/useravatar?avatarId=42")).toBe(true);
    expect(
      isJiraAvatarUrl(
        "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/a.png",
      ),
    ).toBe(true);
    expect(isJiraAvatarUrl("https://jira.example.com/secure/useravatar?avatarId=42")).toBe(true);
    expect(isJiraAvatarUrl("https://acme.atlassian.net.evil.test/a.png")).toBe(false);
    expect(isJiraAvatarUrl("http://acme.atlassian.net/a.png")).toBe(false);
  });
});
