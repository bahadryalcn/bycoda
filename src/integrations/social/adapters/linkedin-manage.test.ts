import { describe, expect, it, vi } from "vitest";
import { SocialHttp, type SocialAccount } from "../adapter";
import { manageLinkedIn } from "./linkedin-manage";

const version = "202609";
const postId = "urn:li:share:9876";
const comment = "urn:li:comment:(urn:li:activity:9876,3456)";
const account = {
  platform: "linkedin",
  platformId: "urn:li:organization:123",
  accountType: "organization",
  scopes: ["w_organization_social", "w_organization_social_feed"],
} as SocialAccount;

describe("LinkedIn management API", () => {
  it("sends the exact partial update and delete only after dispatch authorization", async () => {
    const authorize = vi.fn(async () => {});
    const fetcher = vi.fn(async (_url: string | URL | Request, _request?: RequestInit) => {
      expect(authorize).toHaveBeenCalledTimes(fetcher.mock.calls.length);
      return new Response(null, { status: 204 });
    });
    const http = new SocialHttp(fetcher);
    await expect(
      manageLinkedIn(
        http,
        version,
        account,
        "synthetic",
        { kind: "editPost", postId, text: "New text" },
        authorize,
      ),
    ).resolves.toEqual({ platformId: postId });
    await expect(
      manageLinkedIn(
        http,
        version,
        account,
        "synthetic",
        { kind: "deletePost", postId },
        authorize,
      ),
    ).resolves.toEqual({ platformId: postId });
    const url = `https://api.linkedin.com/rest/posts/${encodeURIComponent(postId)}`;
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-RestLi-Method": "PARTIAL_UPDATE",
          "LinkedIn-Version": version,
        }),
        body: JSON.stringify({ patch: { $set: { commentary: "New text" } } }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, url, expect.objectContaining({ method: "DELETE" }));
  });

  it("uses the comment URN for reactions and the numeric ID for comment deletion", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const authorize = vi.fn(async () => {});
    const http = new SocialHttp(fetcher);
    await manageLinkedIn(
      http,
      version,
      account,
      "synthetic",
      { kind: "react", entityId: comment, reaction: "PRAISE" },
      authorize,
    );
    await manageLinkedIn(
      http,
      version,
      account,
      "synthetic",
      { kind: "removeReaction", entityId: comment },
      authorize,
    );
    await manageLinkedIn(
      http,
      version,
      account,
      "synthetic",
      { kind: "deleteComment", postId, commentId: comment },
      authorize,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.linkedin.com/rest/reactions?actor=urn%3Ali%3Aorganization%3A123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ root: comment, reactionType: "PRAISE" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.linkedin.com/rest/reactions/(actor:urn%3Ali%3Aorganization%3A123,entity:urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A9876%2C3456%29)",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A9876/comments/3456?actor=urn%3Ali%3Aorganization%3A123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([
    [403, "denied"],
    [404, "rejected"],
    [503, "unknown"],
  ])("maps HTTP %s to a single redacted %s result", async (status, code) => {
    const fetcher = vi.fn(async () =>
      Response.json({ message: "credential-shaped provider error" }, { status }),
    );
    await expect(
      manageLinkedIn(
        new SocialHttp(fetcher),
        version,
        account,
        "synthetic",
        { kind: "deletePost", postId },
        async () => {},
      ),
    ).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("makes no provider call on policy denial, missing scope, or malformed target", async () => {
    const fetcher = vi.fn();
    const http = new SocialHttp(fetcher);
    const deny = vi.fn(async () => {
      throw new Error("Stopped");
    });
    await expect(
      manageLinkedIn(http, version, account, "synthetic", { kind: "deletePost", postId }, deny),
    ).rejects.toThrow("Stopped");
    const noScope = { ...account, scopes: ["w_organization_social"] };
    await expect(
      manageLinkedIn(
        http,
        version,
        noScope,
        "synthetic",
        { kind: "react", entityId: comment, reaction: "LIKE" },
        deny,
      ),
    ).rejects.toMatchObject({ code: "denied" });
    await expect(
      manageLinkedIn(
        http,
        version,
        account,
        "synthetic",
        { kind: "deletePost", postId: "https://other.invalid/post" },
        deny,
      ),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(deny).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
