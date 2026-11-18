import { describe, expect, it, vi } from "vitest";
import { INSTAGRAM_MANAGEMENT_KINDS } from "../../../src/features/social/model/instagramManagement";
import type { SocialActionContext } from "../core/social-actions";
import { instagramManagementRequests } from "./instagram-management-requests";

const request = instagramManagementRequests["instagram.management.request"].run;
const list = instagramManagementRequests["instagram.management.list"].run;
const dismiss = instagramManagementRequests["instagram.management.dismiss"].run;
const earnings = instagramManagementRequests["instagram.earnings.read"].run;
const post = "https://www.instagram.com/p/ABCdef123/";

function fixture(overrides: { connection?: string; aiStopped?: boolean } = {}) {
  const settings = new Map<string, string>();
  const account = {
    id: "ig-1",
    platform: "instagram",
    connection: overrides.connection ?? "browser",
    connected: true,
    accessApproved: true,
    paused: false,
    platformId: "web:instagram:owner",
  };
  const instagramEarnings = vi.fn(async () => ({ total: "10" }));
  const ctx = {
    now: () => 1_000,
    principal: { kind: "session", actorId: "agent", projectId: "project-1", provider: "x" },
    store: { transaction: async <T>(run: () => Promise<T>) => await run() },
    service: {
      access: vi.fn(async () => account),
      project: vi.fn(async () => undefined),
      setting: async (key: string) =>
        key === "ai.stopped" && overrides.aiStopped ? "true" : settings.get(key),
      setSetting: async (key: string, value: string) => void settings.set(key, value),
    },
    instagramEarnings,
  } as unknown as SocialActionContext;
  return { ctx, instagramEarnings };
}

describe("Instagram management requests", () => {
  it("is a project tool for the session and owner-only for review and dismissal", () => {
    expect(instagramManagementRequests["instagram.management.request"]).toMatchObject({
      tool: true,
      ownerOnly: false,
      readOnly: false,
    });
    expect(instagramManagementRequests["instagram.management.list"]).toMatchObject({
      ownerOnly: true,
      readOnly: true,
    });
    expect(instagramManagementRequests["instagram.management.dismiss"].ownerOnly).toBe(true);
    expect(instagramManagementRequests["instagram.earnings.read"]).toMatchObject({
      tool: true,
      readOnly: true,
    });
  });

  it("queues every kind without any browser or provider call and deduplicates", async () => {
    const { ctx, instagramEarnings } = fixture();
    const details: Record<(typeof INSTAGRAM_MANAGEMENT_KINDS)[number], Record<string, unknown>> = {
      "post.edit": { postUrl: post, caption: "New caption" },
      "post.delete": { postUrl: post },
      "profile.update": { patch: { bio: "New bio" } },
      "highlight.create": { name: "Trips", storyIds: ["123"] },
      "highlight.edit": { id: "5", expectedName: "Trips", name: "Travel" },
      "highlight.delete": { id: "5", expectedName: "Trips" },
      "dm.draft": { handle: "Friend.Name", text: "Hello" },
    };
    for (const kind of INSTAGRAM_MANAGEMENT_KINDS)
      await expect(
        request(ctx, { accountId: "ig-1", kind, details: details[kind] }),
      ).resolves.toMatchObject({ kind, accountId: "ig-1", projectId: "project-1" });
    const again = (await request(ctx, {
      accountId: "ig-1",
      kind: "post.delete",
      details: details["post.delete"],
    })) as { id: string };
    const owner = { ...ctx, principal: { kind: "owner", actorId: "owner", provider: "owner" } };
    const { requests } = (await list(owner as SocialActionContext, { accountId: "ig-1" })) as {
      requests: { id: string; kind: string; details: Record<string, unknown> }[];
    };
    expect(requests).toHaveLength(INSTAGRAM_MANAGEMENT_KINDS.length);
    expect(requests.find((item) => item.id === again.id)?.details).toEqual({ postUrl: post });
    expect(requests.find((item) => item.kind === "dm.draft")?.details.handle).toBe("friend.name");
    expect(instagramEarnings).not.toHaveBeenCalled();
    await dismiss(owner as SocialActionContext, { accountId: "ig-1", id: again.id });
    expect(
      ((await list(owner as SocialActionContext, { accountId: "ig-1" })) as { requests: unknown[] })
        .requests,
    ).toHaveLength(INSTAGRAM_MANAGEMENT_KINDS.length - 1);
  });

  it("rejects invalid details, unknown fields, API accounts and a stopped AI", async () => {
    const { ctx } = fixture();
    for (const [kind, details] of [
      ["post.delete", { postUrl: "https://example.com/p/x/" }],
      ["post.delete", { postUrl: post, confirm: "DELETE_INSTAGRAM_POST" }],
      ["profile.update", { patch: { followers: "1" } }],
      ["dm.draft", { handle: "bad handle", text: "Hi" }],
      ["highlight.delete", { id: "x", expectedName: "Trips" }],
    ] as const)
      await expect(request(ctx, { accountId: "ig-1", kind, details })).rejects.toThrow();
    await expect(
      request(ctx, { accountId: "ig-1", kind: "post.publish", details: {} }),
    ).rejects.toThrow();
    await expect(
      request(fixture({ connection: "token" }).ctx, {
        accountId: "ig-1",
        kind: "post.delete",
        details: { postUrl: post },
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      request(fixture({ aiStopped: true }).ctx, {
        accountId: "ig-1",
        kind: "post.delete",
        details: { postUrl: post },
      }),
    ).rejects.toThrow(/stopped/);
  });

  it("reads earnings only through the browser account and only after the access check", async () => {
    const { ctx, instagramEarnings } = fixture();
    await expect(earnings(ctx, { accountId: "ig-1" })).resolves.toEqual({ total: "10" });
    expect(instagramEarnings).toHaveBeenCalledWith("ig-1");
    await expect(
      earnings(fixture({ connection: "token" }).ctx, { accountId: "ig-1" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(earnings(ctx, { accountId: "ig-1", extra: true })).rejects.toThrow();
  });
});
