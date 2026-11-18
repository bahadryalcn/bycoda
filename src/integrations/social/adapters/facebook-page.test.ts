import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { listFacebookPageMentions, readFacebookPage } from "./facebook-page";

describe("Facebook Page reads", () => {
  it("reads the exact Page and preserves zero counts separately from missing values", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "123",
        name: "Page",
        about: "About",
        category: "Software",
        followers_count: 0,
        fan_count: 10,
        picture: { data: { url: "https://example.com/avatar.jpg" } },
        cover: { source: "https://example.com/cover.jpg" },
        website: "javascript:void(0)",
      }),
    );
    const page = await readFacebookPage(new SocialHttp(fetcher), "v25.0", "123", "synthetic");
    expect(page).toMatchObject({
      id: "123",
      name: "Page",
      about: "About",
      category: "Software",
      followersCount: 0,
      fanCount: 10,
      avatarUrl: "https://example.com/avatar.jpg",
      coverUrl: "https://example.com/cover.jpg",
    });
    expect(page.website).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/123\?fields=/),
      expect.objectContaining({
        headers: { Authorization: "Bearer synthetic" },
      }),
    );
  });

  it("rejects a mismatched Page identity", async () => {
    const http = new SocialHttp(async () => Response.json({ id: "456", name: "Other Page" }));
    await expect(readFacebookPage(http, "v25.0", "123", "synthetic")).rejects.toMatchObject({
      code: "unknown",
    });
  });

  it("uses cursor paging on the managed Page without following provider URLs", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        data: [{ id: "456_789", message: "Tagged", created_time: "2026-11-18T10:00:00Z" }],
        paging: { next: "https://untrusted.example/private", cursors: { after: "opaque+next" } },
      }),
    );
    const result = await listFacebookPageMentions(
      new SocialHttp(fetcher),
      "v25.0",
      "123",
      "synthetic",
      "old+cursor",
    );
    expect(result).toEqual({
      posts: [{ id: "456_789", text: "Tagged", at: Date.parse("2026-11-18T10:00:00Z") }],
      next: "opaque+next",
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /^https:\/\/graph\.facebook\.com\/v25\.0\/123\/tagged\?.*after=old%2Bcursor$/,
      ),
      expect.anything(),
    );
  });

  it("gives denied reads a permission reason without returning Meta's error payload", async () => {
    const http = new SocialHttp(async () =>
      Response.json(
        {
          error: { code: 283, message: "redacted provider text" },
        },
        { status: 400 },
      ),
    );
    await expect(listFacebookPageMentions(http, "v25.0", "123", "synthetic")).rejects.toMatchObject(
      {
        code: "denied",
        detail: { reasonCode: "facebook.mentions_read_permissions" },
      },
    );
  });
});
