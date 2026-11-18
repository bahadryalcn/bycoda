import { SocialPlatformError, type SocialHttp } from "../adapter";
import { id, requireId } from "./common";
import { metaCommentAction } from "./meta-extended";

export type FacebookCommentAction = "hide" | "unhide" | "delete" | "like" | "unlike";

export async function moderateFacebookComment(
  http: SocialHttp,
  graphVersion: string,
  token: string,
  commentId: string,
  action: FacebookCommentAction,
) {
  if (action !== "like" && action !== "unlike") {
    await metaCommentAction(http, graphVersion, "facebook", token, commentId, action);
    return;
  }
  const { value } = await http.request(
    `https://graph.facebook.com/${graphVersion}/${id(commentId)}/likes`,
    token,
    { method: action === "like" ? "POST" : "DELETE" },
  );
  if (value.success !== true) throw new SocialPlatformError("unknown");
}

const PRIVATE_REPLY_WINDOW = 7 * 24 * 60 * 60_000;

export async function sendFacebookPrivateReply(
  http: SocialHttp,
  graphVersion: string,
  pageId: string,
  token: string,
  commentId: string,
  recipientId: string,
  message: string,
  now: () => number,
  beforeSubmit?: () => Promise<void>,
) {
  const endpoint = `https://graph.facebook.com/${graphVersion}`;
  const { value: comment } = await http.request(
    `${endpoint}/${id(commentId)}?fields=id,from,created_time,can_reply_privately`,
    token,
  );
  const createdAt =
    typeof comment.created_time === "string" ? Date.parse(comment.created_time) : NaN;
  const currentTime = now();
  if (
    comment.id !== commentId ||
    comment.from?.id !== recipientId ||
    comment.can_reply_privately !== true ||
    !Number.isFinite(createdAt) ||
    createdAt > currentTime ||
    currentTime - createdAt >= PRIVATE_REPLY_WINDOW
  ) {
    throw new SocialPlatformError("rejected", undefined, {
      reasonCode: "facebook.private_reply_unavailable",
    });
  }
  await beforeSubmit?.();
  if (now() - createdAt >= PRIVATE_REPLY_WINDOW)
    throw new SocialPlatformError("rejected", undefined, {
      reasonCode: "facebook.private_reply_unavailable",
    });
  const { value } = await http.json(`${endpoint}/${id(pageId)}/messages`, token, {
    recipient: { comment_id: commentId },
    message: { text: message },
  });
  return { platformId: requireId(value.message_id) };
}
