import type { SocialAccount, SocialOperation } from "../adapter";
import { NOT_YET, r, type CapabilityRequirement, type PlatformCapabilities } from "./shared";

/**
 * API rows reflect the adapter in adapters/linkedin.ts. Browser rows come from
 * browserCapabilities.ts (BROWSER_PLATFORM_OPERATIONS.linkedin). An operation neither path
 * implements is NOT_SUPPORTED, so its row carries `unsupported` on both sides.
 */
export function linkedinCapabilities(type: SocialAccount["accountType"]): PlatformCapabilities {
  const org = type === "organization";
  const api: Record<SocialOperation, CapabilityRequirement> = {
    ...NOT_YET,
    publish: r(
      [org ? "w_organization_social" : "w_member_social"],
      "Posts API, approved product and organization role where applicable; versioned headers required.",
    ),
    media: r(
      [org ? "w_organization_social" : "w_member_social"],
      "One to four owner-uploaded organization images with alternative text and Images API readiness verification, or one organization PDF through the Documents API (endpoint shape not verified live). Member media and video are not implemented in the API adapter; organization video needs part ETags the shared HTTP client does not return.",
      !org,
    ),
    "comments.read": r(
      [org ? "r_organization_social_feed" : "r_member_social_feed"],
      "Community Management approval; member read is restricted/closed.",
    ),
    reply: r(
      [org ? "w_organization_social_feed" : "w_member_social_feed"],
      "Comments API and approved Community Management access.",
    ),
    comment: r(
      [org ? "w_organization_social_feed" : "w_member_social_feed"],
      "Comments API permissions and accessible parent post.",
    ),
    "inbox.read": r(
      [],
      "General member/Page messaging is not available through the approved open Community Management surface.",
      true,
    ),
    "message.reply": r([], "No general messaging API in this integration.", true),
    "message.start": r([], "No general cold-message API in this integration.", true),
    search: r(
      [],
      "No general people/post discovery; restricted organization/follower finders are separate.",
      true,
    ),
    webhook: r(
      [],
      "Social-action notifications require approved product/subscription; inbound transport is not configured for LinkedIn.",
      true,
    ),
    poll: r(
      org ? ["r_organization_social_feed", "r_organization_social"] : ["r_member_social_feed"],
      "Read comments on known posts. Organization post discovery additionally requires r_organization_social; member polling is limited to known post IDs.",
    ),
  };
  return {
    api: {
      ...api,
      ...NOT_YET,
      "audience.collect": r(
        org ? ["r_organization_social_feed"] : [],
        "Organization post commenters and reactors only, from the owner's own posts (postRef required). Reactions endpoint shape not verified live. Member, mention, keyword and follower sources are unsupported.",
        !org,
      ),
    },
    browser: {},
  };
}
