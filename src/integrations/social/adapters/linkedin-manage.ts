import {
  SocialPlatformError,
  type SocialAccount,
  type SocialHttp,
  type SocialPermission,
  type SocialSendResult,
} from "../adapter";
import { LINKEDIN_COMMENTARY_LIMIT } from "../linkedinMedia";
import { linkedInActorId, linkedInWriteScope } from "./linkedin-formats";

export const linkedInReactions = [
  "LIKE",
  "PRAISE",
  "EMPATHY",
  "INTEREST",
  "APPRECIATION",
  "ENTERTAINMENT",
] as const;
export type LinkedInManagementAction =
  | { kind: "editPost"; postId: string; text: string }
  | { kind: "deletePost"; postId: string }
  | { kind: "react"; entityId: string; reaction: (typeof linkedInReactions)[number] }
  | { kind: "removeReaction"; entityId: string }
  | { kind: "deleteComment"; postId: string; commentId: string };

export type LinkedInManagementReview = {
  id: string;
  accountId: string;
  actor: string;
  projectId?: string;
  permission: SocialPermission;
  action: LinkedInManagementAction;
  source: { kind: "publication"; id: string } | { kind: "thread"; id: string; postId: string; projectId?: string };
  connectionEpoch?: string;
  contactId?: string;
  expiresAt: number;
  state: "review" | "attempting" | "succeeded" | "inspect";
};

const idValue = /^[1-9]\d{0,24}$/;
const postUrn = /^urn:li:(?:share|ugcPost):[1-9]\d{0,24}$/;
const commentUrn =
  /^urn:li:comment:\((?:urn:li:)?(?:activity|share|ugcPost):[1-9]\d{0,24},([1-9]\d{0,24})\)$/;
const activityUrn = /^urn:li:activity:[1-9]\d{0,24}$/;
const root = "https://api.linkedin.com/rest";

function resourceId(value: string) {
  return encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

export function linkedInManagementScope(
  account: SocialAccount,
  kind: LinkedInManagementAction["kind"],
) {
  if (kind === "editPost" || kind === "deletePost") return linkedInWriteScope(account);
  return account.accountType === "organization"
    ? "w_organization_social_feed"
    : "w_member_social_feed";
}

/** The Host binds the target to the approved action and records its attempt before submission. */
export async function manageLinkedIn(
  http: SocialHttp,
  version: string,
  account: SocialAccount,
  token: string,
  action: LinkedInManagementAction,
  beforeSubmit: () => Promise<void>,
): Promise<SocialSendResult> {
  if (account.platform !== "linkedin" || account.connection === "browser")
    throw new SocialPlatformError("unsupported");
  const actor = linkedInActorId(account);
  if (!account.scopes.includes(linkedInManagementScope(account, action.kind)))
    throw new SocialPlatformError("denied");
  const headers = { "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0" };
  if (action.kind === "editPost" || action.kind === "deletePost") {
    if (typeof action.postId !== "string" || !postUrn.test(action.postId))
      throw new SocialPlatformError("rejected");
    const url = `${root}/posts/${resourceId(action.postId)}`;
    if (action.kind === "editPost") {
      if (
        typeof action.text !== "string" ||
        !action.text.trim() ||
        action.text.length > LINKEDIN_COMMENTARY_LIMIT
      )
        throw new SocialPlatformError("rejected");
      await beforeSubmit();
      await http.json(
        url,
        token,
        { patch: { $set: { commentary: action.text } } },
        { ...headers, "X-RestLi-Method": "PARTIAL_UPDATE" },
      );
    } else {
      await beforeSubmit();
      await http.request(url, token, { method: "DELETE", headers });
    }
    return { platformId: action.postId };
  }
  if (action.kind === "deleteComment") {
    if (
      typeof action.postId !== "string" ||
      !postUrn.test(action.postId) ||
      typeof action.commentId !== "string"
    )
      throw new SocialPlatformError("rejected");
    const id = idValue.test(action.commentId)
      ? action.commentId
      : commentUrn.exec(action.commentId)?.[1];
    if (!id) throw new SocialPlatformError("rejected");
    const query = account.accountType === "organization" ? `?actor=${resourceId(actor)}` : "";
    await beforeSubmit();
    await http.request(
      `${root}/socialActions/${resourceId(action.postId)}/comments/${id}${query}`,
      token,
      { method: "DELETE", headers },
    );
    return { platformId: action.commentId };
  }
  if (action.kind !== "react" && action.kind !== "removeReaction")
    throw new SocialPlatformError("unsupported");
  if (
    typeof action.entityId !== "string" ||
    ![postUrn, activityUrn, commentUrn].some((pattern) => pattern.test(action.entityId))
  )
    throw new SocialPlatformError("rejected");
  if (action.kind === "react") {
    if (!linkedInReactions.includes(action.reaction)) throw new SocialPlatformError("rejected");
    await beforeSubmit();
    await http.json(
      `${root}/reactions?actor=${resourceId(actor)}`,
      token,
      { root: action.entityId, reactionType: action.reaction },
      headers,
    );
  } else {
    await beforeSubmit();
    await http.request(
      `${root}/reactions/(actor:${resourceId(actor)},entity:${resourceId(action.entityId)})`,
      token,
      { method: "DELETE", headers },
    );
  }
  return { platformId: action.entityId };
}
