import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type {
  TikTokBusinessCredential,
  TikTokOrganic,
  TikTokOrganicComment,
} from "../../../src/integrations/social/adapters/tiktok-organic";
import type { BrowserPollResult } from "../social-browser-recipe";

export function tiktokOrganicInbound(comments: TikTokOrganicComment[]): SocialInbound[] {
  return comments.flatMap((comment) =>
    comment.owned || !comment.username || !comment.at
      ? []
      : [
          {
            eventId: comment.id,
            threadId: comment.id,
            postId: comment.postId,
            contactId: `web:tiktok:${comment.username}`,
            contactName: comment.author || comment.username,
            kind: "comment",
            text: comment.text,
            at: comment.at,
            replyAllowed: !comment.hidden,
          },
        ],
  );
}

/** A bounded automatic refresh. The exact-post account action remains available for older posts. */
export async function pollTikTokOrganicComments(
  api: Pick<TikTokOrganic, "videos" | "comments">,
  credential: TikTokBusinessCredential,
): Promise<BrowserPollResult> {
  const { posts, next } = await api.videos(credential);
  const selected = [...posts].sort((left, right) => right.at - left.at).slice(0, 2);
  const pages = await Promise.all(selected.map(({ id }) => api.comments(credential, id)));
  const partial =
    next !== undefined ||
    posts.length > selected.length ||
    pages.some((page) => page.next !== undefined);
  return {
    events: tiktokOrganicInbound(pages.flatMap((page) => page.comments)),
    coverage: [{ channel: "comments", status: partial ? "partial" : "read" }],
  };
}
