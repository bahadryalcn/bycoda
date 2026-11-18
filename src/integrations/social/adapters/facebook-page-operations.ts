import type { SocialAccount, SocialHttp } from "../adapter";
import { uploadFacebookPhoto } from "../metaMedia";
import { moderateFacebookComment, type FacebookCommentAction } from "./facebook-engagement";
import { readFacebookPageInsights } from "./facebook-insights";
import { facebookPageEndpoint, listFacebookPageMentions, readFacebookPage } from "./facebook-page";
import { FACEBOOK_PAGE_PHOTO_SCOPES, updateFacebookPage } from "./facebook-page-edit";
import { SocialPlatformError } from "../adapter";
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
    uploadProfilePhoto: (
      account: SocialAccount,
      token: string,
      field: "avatarPhotoId" | "coverPhotoId",
      uploadId: string,
      bytes: Uint8Array,
      recheck: () => Promise<void>,
    ) => {
      if (FACEBOOK_PAGE_PHOTO_SCOPES.some((scope) => !account.scopes.includes(scope)))
        throw new SocialPlatformError("denied", undefined, {
          reasonCode: "platform.scope_missing",
        });
      return uploadFacebookPhoto(
        http,
        `${facebookPageEndpoint(version, account.platformId)}/photos`,
        token,
        { kind: "image", uploadId, url: "" },
        async () => bytes,
        recheck,
      ).then(async (photoId) => {
        await recheck();
        return updateFacebookPage(http, version, account.platformId, token, { [field]: photoId });
      });
    },
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
