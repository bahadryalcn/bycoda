import type { SocialAccount, SocialHttp } from "../adapter";
import { moderateFacebookComment, type FacebookCommentAction } from "./facebook-engagement";
import { readFacebookPageInsights } from "./facebook-insights";
import { listFacebookPageMentions, readFacebookPage } from "./facebook-page";
import { updateFacebookPage } from "./facebook-page-edit";
import { updateFacebookPost } from "./facebook-schedule";

export function createFacebookPageOperations(http: SocialHttp, version: string) {
  return {
    profile: (account: SocialAccount, token: string) =>
      readFacebookPage(http, version, account.platformId, token),
    mentions: (account: SocialAccount, token: string, cursor?: string) =>
      listFacebookPageMentions(http, version, account.platformId, token, cursor),
    insights: (
      account: SocialAccount,
      token: string,
      options: { earnings?: boolean; cursor?: string },
    ) => readFacebookPageInsights(http, version, account.platformId, token, options),
    updateProfile: (account: SocialAccount, token: string, patch: unknown) =>
      updateFacebookPage(http, version, account.platformId, token, patch),
    editPost: (
      account: SocialAccount,
      token: string,
      postId: string,
      message: string,
      beforeSubmit?: () => Promise<void>,
    ) => updateFacebookPost(http, version, account, token, postId, message, beforeSubmit),
    moderateComment: (token: string, commentId: string, action: FacebookCommentAction) =>
      moderateFacebookComment(http, version, token, commentId, action),
  };
}
