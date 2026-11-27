import { expect, it, vi } from "vitest";
import { pollTikTokOrganicComments } from "./tiktok-organic-inbox";

it("polls only the two newest owned posts and keeps stable inbound comment identities", async () => {
  const credential = { businessId: "test-business", accessToken: "synthetic-token" };
  const post = (id: string, at: number) => ({ id, at, text: undefined });
  const api = {
    videos: vi.fn(async () => ({
      posts: [post("1", 10), post("2", 20), post("3", 30)],
      next: undefined,
      metrics: {},
    })),
    comments: vi.fn(async (_credential: typeof credential, postId: string) => ({
      comments: [
        {
          id: `10${postId}`,
          postId,
          text: "Example",
          at: 100,
          username: "viewer",
          owned: false,
          hidden: postId === "2",
        },
        {
          id: `20${postId}`,
          postId,
          text: "Own reply",
          at: 100,
          username: "creator",
          owned: true,
          hidden: false,
        },
      ],
      next: undefined,
    })),
  };
  const result = await pollTikTokOrganicComments(api, credential);
  expect(api.comments.mock.calls.map(([, postId]) => postId)).toEqual(["3", "2"]);
  expect(result).toMatchObject({
    events: [
      { eventId: "103", threadId: "103", contactId: "web:tiktok:viewer", replyAllowed: true },
      { eventId: "102", threadId: "102", contactId: "web:tiktok:viewer", replyAllowed: false },
    ],
    coverage: [{ channel: "comments", status: "partial" }],
  });
  expect(result.cursor).toBeUndefined();
});
