import { SocialPlatformError, type SocialHttp } from "../adapter";
import { metaCommentAction, type CommentAction } from "./meta-extended";

/** Moderates a selected comment using the connected Instagram Login credential. */
export async function instagramCommentAction(
  http: SocialHttp,
  graphVersion: string,
  token: string,
  commentId: string,
  action: CommentAction,
): Promise<void> {
  if (!/^\d{1,32}$/.test(commentId) || !["hide", "unhide", "delete"].includes(action))
    throw new SocialPlatformError("rejected");
  await metaCommentAction(http, graphVersion, "instagram", token, commentId, action);
}
