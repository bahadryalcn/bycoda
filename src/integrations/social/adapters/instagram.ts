import type { SocialAdapter, SocialHttp } from "../adapter";
import { readInstagramInsights } from "./instagram-insights";
import { instagramCommentAction } from "./instagram-moderation";
import { createMetaAdapter } from "./meta-shared";

export function createInstagramAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  return {
    ...createMetaAdapter(http, graphVersion, "instagram"),
    instagramInsights: (account, token, input) =>
      readInstagramInsights(http, graphVersion, token, account.platformId, input),
    instagramCommentAction: (_account, token, commentId, action) =>
      instagramCommentAction(http, graphVersion, token, commentId, action),
  };
}
