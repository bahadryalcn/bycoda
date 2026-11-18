import { expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { createInstagramAdapter } from "./instagram";
import { instagramCommentAction } from "./instagram-moderation";

it.each([
  ["hide", "POST", "?hide=true"],
  ["unhide", "POST", "?hide=false"],
  ["delete", "DELETE", ""],
] as const)("moderates a comment with %s using the Instagram API", async (action, method, query) => {
  const fetcher = vi.fn(async () => new Response('{"success":true}'));
  const adapter = createInstagramAdapter(new SocialHttp(fetcher), "v25.0");
  await expect(adapter.instagramCommentAction!(
    { platformId: "178123" } as Parameters<typeof adapter.send>[0],
    "fixture",
    "179456",
    action,
  )).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(
    `https://graph.instagram.com/v25.0/179456${query}`,
    expect.objectContaining({ method, headers: { Authorization: "Bearer fixture" } }),
  );
});

it("reports an unconfirmed request as uncertain without a second write", async () => {
  const fetcher = vi.fn(async () => new Response('{"success":false}'));
  await expect(instagramCommentAction(new SocialHttp(fetcher), "v25.0", "fixture", "179456", "hide"))
    .rejects.toMatchObject({ code: "unknown" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("rejects an invalid comment ID before dispatch", async () => {
  const fetcher = vi.fn();
  await expect(instagramCommentAction(new SocialHttp(fetcher), "v25.0", "fixture", "../me", "delete"))
    .rejects.toMatchObject({ code: "rejected" });
  expect(fetcher).not.toHaveBeenCalled();
});
