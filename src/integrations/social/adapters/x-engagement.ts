import { SocialPlatformError, type SocialAccount, type SocialHttp } from "../adapter";
import { xCall } from "./x";
import { xResourceId } from "./x-identifiers";

export type XEngagementAction = {
  kind: "like" | "repost" | "bookmark" | "hideReply";
  postId: string;
  enabled: boolean;
};

const postActions = {
  like: { collection: "likes", result: "liked" },
  repost: { collection: "retweets", result: "retweeted" },
  bookmark: { collection: "bookmarks", result: "bookmarked" },
} as const;

/** The caller authorizes the exact action. Likes and reply moderation require owner interaction. */
export async function runXEngagement(
  http: SocialHttp,
  account: SocialAccount,
  token: string,
  action: XEngagementAction,
): Promise<{ postId: string; enabled: boolean }> {
  const postId = xResourceId(action.postId);
  const { kind, enabled } = action;
  if (typeof enabled !== "boolean") throw new SocialPlatformError("rejected");

  if (kind === "hideReply") {
    const { value } = await xCall(
      http,
      account,
      `https://api.x.com/2/tweets/${postId}/hidden`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: enabled }),
      },
    );
    if (value.data?.hidden !== enabled) throw new SocialPlatformError("unknown");
    return { postId, enabled };
  }

  if (!Object.prototype.hasOwnProperty.call(postActions, kind))
    throw new SocialPlatformError("rejected");
  const userId = xResourceId(account.platformId);
  const operation = postActions[kind];
  const url = `https://api.x.com/2/users/${userId}/${operation.collection}`;
  const { value } = enabled
    ? await xCall(http, account, url, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tweet_id: postId }),
      })
    : await xCall(http, account, `${url}/${postId}`, token, { method: "DELETE" });
  if (value.data?.[operation.result] !== enabled) throw new SocialPlatformError("unknown");
  return { postId, enabled };
}
