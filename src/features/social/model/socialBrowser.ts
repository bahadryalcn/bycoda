import { t } from "../../../shared/i18n/core";
import type { SocialPlatform } from "./social";
export type XProfilePatch = {
  name?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatarUploadId?: string;
  bannerUploadId?: string;
};
export type XProfileState = {
  name: string;
  bio: string;
  location: string;
  website: string;
  avatarUrl?: string;
  bannerUrl?: string;
};

export const SOCIAL_BROWSER_INTENTS = [
  "login",
  "signup",
  "inbox",
  "publish",
  "comments",
  // Instagram owner-assisted workflows.
  "instagram-professional",
  "instagram-profile",
  "instagram-highlights",
  "instagram-monetization",
  "instagram-live",
] as const;
// Facebook browser profile fields are scoped to the verified Page or personal actor.
export type FacebookProfileDetail = "work" | "school" | "college" | "currentCity" | "hometown";
export type FacebookPersonalName = { first: string; middle: string; last: string };
export type FacebookBrowserProfilePatch = XProfilePatch & {
  username?: string;
  detail?: { field: FacebookProfileDetail; value: string; current?: string };
  websiteUpdate?: { current: string; value: string };
  personalName?: FacebookPersonalName;
  introDetail?: { label: string; visible: boolean };
};

export type SocialBrowserIntent = (typeof SOCIAL_BROWSER_INTENTS)[number];
// Instagram browser operations.
export type InstagramProfilePatch = Pick<
  XProfilePatch,
  "name" | "bio" | "website" | "avatarUploadId"
> & { username?: string };
export type InstagramProfileState = XProfileState & { username?: string };
export type InstagramPostChange =
  | { action: "caption"; postUrl: string; caption: string; confirm: "EDIT_INSTAGRAM_CAPTION" }
  | { action: "delete"; postUrl: string; confirm: "DELETE_INSTAGRAM_POST" };
export type InstagramPostDeletion = "review" | "deleted";
export type InstagramPostChangeResult = {
  postUrl: string;
  changed: boolean;
  deletion?: InstagramPostDeletion;
};
export type InstagramRecipient = { handle: string; platformId: string };
export type InstagramFollowerSample = {
  followers: { username: string }[];
  partial: true;
};
export type InstagramFollowChange = {
  handle: string;
  follow: boolean;
  confirm: "FOLLOW_INSTAGRAM_ACCOUNT" | "UNFOLLOW_INSTAGRAM_ACCOUNT";
};
export type InstagramFollowResult = {
  handle: string;
  following: boolean;
  requested: boolean;
  changed: boolean;
};
export type InstagramBrowserMentions = {
  mentions: { url: string; username?: string; text: string; at?: number }[];
  coverage: "visible_notifications";
};
export type InstagramCommentLike = {
  postId: string;
  commentId: string;
  confirm: "LIKE_INSTAGRAM_COMMENT";
};
export type InstagramEarningsKind = "total" | "estimated" | "available" | "pending" | "last";
export type InstagramEarnings = {
  values: { kind: InstagramEarningsKind; amount: string }[];
  observedAt: number;
};
export type InstagramHighlight = { id: string; name: string };
export type InstagramHighlights = { items: InstagramHighlight[]; partial: boolean };
export type InstagramHighlightChange =
  | { action: "create"; name: string; storyIds: string[]; confirm: "CREATE_INSTAGRAM_HIGHLIGHT" }
  | {
      action: "edit";
      id: string;
      expectedName: string;
      name: string;
      storyIds?: string[];
      confirm: "EDIT_INSTAGRAM_HIGHLIGHT";
    }
  | { action: "delete"; id: string; expectedName: string; confirm: "DELETE_INSTAGRAM_HIGHLIGHT" };
export type SocialRegistrationField =
  | "email"
  | "displayName"
  | "username"
  | "givenName"
  | "familyName"
  | "birthdate"
  | "category"
  | "phone"
  | "bio";
export type SocialRegistrationProfile = Partial<Record<SocialRegistrationField, string>> & {
  accountKind?: "brand" | "person";
};
export type SocialRegistrationBlocker = "password" | "verification" | "terms" | "challenge";
export type SocialRegistrationProgress = {
  status: "ready" | "needs_fields" | "awaiting_owner" | "unsupported" | "changed";
  step:
    | "method"
    | "profile"
    | "birthdate"
    | SocialRegistrationBlocker
    | "admin_setup"
    | "rate_limit"
    | "network_blocked"
    | "unknown";
  blockers: SocialRegistrationBlocker[];
  requiredFields: SocialRegistrationField[];
  filledFields: SocialRegistrationField[];
  canAdvance: boolean;
  message: string;
};
export type SocialRegistrationReview = {
  reviewId: string;
  workflowId: string;
  accountId: string;
  updatedAt: number;
  expiresAt: number;
  platform: "linkedin";
  administrator: { id: string; name: string };
  fields: {
    displayName: string;
    username: string;
    industry: string;
    organizationSize: string;
    organizationType: string;
  };
  details: { label: string; value: string }[];
  terms: { text: string; url: string };
  submitLabel: string;
  agreementChecked?: boolean;
};
export type SocialBrowserWorkflow = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  intent: SocialBrowserIntent;
  status:
    | "queued"
    | "awaiting_owner"
    | "window_closed"
    | "cancelled"
    | "expired"
    | "interrupted"
    | "failed";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Page navigation/window closure is not evidence of authentication or delivery. */
  outcome: "unverified";
  error?: string;
  registration?: SocialRegistrationProgress;
  /** An attempt is persisted before any agreement/create action. Never automatically resubmit it. */
  registrationSubmission?: {
    id: string;
    state: "attempting" | "unknown" | "created";
    attemptedAt: number;
    reviewDigest?: string;
    /** Canonical administrator/name/slug hash for read-only recovery; never raw form values. */
    expectedResourceDigest?: string;
    resourceId?: string;
    resourceUrl?: string;
  };
};
export type SocialBrowserState = {
  available: boolean;
  reason: string;
  workflows: SocialBrowserWorkflow[];
};
export const SOCIAL_BROWSER_LABELS: Record<SocialBrowserIntent, string> = {
  get login() {
    return t("Log in");
  },
  get signup() {
    return t("Sign up");
  },
  get inbox() {
    return t("Open inbox");
  },
  get publish() {
    return t("Open publishing screen");
  },
  get comments() {
    return t("Open comments");
  },
  // Instagram owner-assisted workflows.
  get "instagram-professional"() {
    return t("Switch to professional account");
  },
  get "instagram-profile"() {
    return t("Open Instagram profile settings");
  },
  get "instagram-highlights"() {
    return t("Manage Instagram Highlights");
  },
  get "instagram-monetization"() {
    return t("Open Instagram monetization");
  },
  get "instagram-live"() {
    return t("Open Instagram Live Producer");
  },
};

type Site = {
  origins: readonly string[];
  routes: Partial<Record<SocialBrowserIntent, string>>;
};
/** Owner-assisted routes. Their presence never grants an automated read/write capability. */
export const SOCIAL_BROWSER_SITES: Record<SocialPlatform, Site> = {
  x: {
    origins: ["https://x.com"],
    routes: {
      login: "https://x.com/login",
      signup: "https://x.com/i/flow/signup",
      inbox: "https://x.com/i/chat",
      publish: "https://x.com/compose/post",
    },
  },
  instagram: {
    origins: ["https://www.instagram.com"],
    routes: {
      login: "https://www.instagram.com/accounts/login/",
      signup: "https://www.instagram.com/accounts/emailsignup/",
      inbox: "https://www.instagram.com/direct/inbox/",
      publish: "https://www.instagram.com/",
      // Instagram owner-assisted workflows.
      "instagram-professional": "https://www.instagram.com/accounts/edit/",
      "instagram-profile": "https://www.instagram.com/accounts/edit/",
      "instagram-highlights": "https://www.instagram.com/",
      "instagram-monetization": "https://www.instagram.com/",
      "instagram-live": "https://www.instagram.com/",
    },
  },
  facebook: {
    origins: ["https://www.facebook.com"],
    routes: {
      login: "https://www.facebook.com/login/",
      signup: "https://www.facebook.com/r.php",
      inbox: "https://www.facebook.com/messages/",
      publish: "https://www.facebook.com/",
    },
  },
  linkedin: {
    origins: ["https://www.linkedin.com"],
    routes: {
      login: "https://www.linkedin.com/login",
      signup: "https://www.linkedin.com/signup",
      inbox: "https://www.linkedin.com/messaging/",
      publish: "https://www.linkedin.com/feed/",
    },
  },
  youtube: {
    origins: ["https://www.youtube.com", "https://studio.youtube.com"],
    routes: {
      login: "https://www.youtube.com/",
      signup: "https://www.youtube.com/channel_switcher",
      publish: "https://studio.youtube.com/",
    },
  },
  tiktok: {
    origins: ["https://www.tiktok.com"],
    routes: {
      login: "https://www.tiktok.com/login",
      signup: "https://www.tiktok.com/signup",
      inbox: "https://www.tiktok.com/messages",
      publish: "https://www.tiktok.com/tiktokstudio/upload",
    },
  },
  snapchat: {
    origins: ["https://web.snapchat.com", "https://www.snapchat.com"],
    routes: {
      login: "https://web.snapchat.com/",
      signup: "https://accounts.snapchat.com/accounts/signup",
      inbox: "https://web.snapchat.com/",
    },
  },
  whatsapp: {
    origins: ["https://web.whatsapp.com"],
    routes: { login: "https://web.whatsapp.com/", inbox: "https://web.whatsapp.com/" },
  },
  telegram: {
    origins: ["https://web.telegram.org"],
    routes: { login: "https://web.telegram.org/", inbox: "https://web.telegram.org/" },
  },
  reddit: {
    origins: ["https://www.reddit.com"],
    routes: {
      signup: "https://www.reddit.com/register/",
      inbox: "https://www.reddit.com/chat/",
    },
  },
};

export function socialBrowserUrl(
  platform: SocialPlatform,
  intent: SocialBrowserIntent,
  target?: unknown,
): string {
  const site = SOCIAL_BROWSER_SITES[platform];
  if (!site || !SOCIAL_BROWSER_INTENTS.includes(intent))
    throw new Error("Unsupported browser workflow.");
  if (intent === "comments") {
    if (!["x", "instagram", "facebook", "linkedin", "youtube", "tiktok"].includes(platform))
      throw new Error("This platform has no supported browser comment route.");
    if (typeof target !== "string" || target.length > 2048)
      throw new Error("Enter the post's HTTPS URL.");
    const url = new URL(target);
    if (!site.origins.includes(url.origin) || url.username || url.password || url.port)
      throw new Error("The post URL must belong to the selected platform.");
    // Keep only public post addressing parameters, never authentication/query material.
    const video = platform === "youtube" ? url.searchParams.get("v") : null;
    url.search = "";
    url.hash = "";
    if (video && /^[\w-]{11}$/.test(video)) url.searchParams.set("v", video);
    const paths: Partial<Record<SocialPlatform, RegExp>> = {
      x: /^\/[\w]+\/status\/\d+\/?$/,
      instagram: /^\/(p|reel)\/[\w-]+\/?$/,
      facebook: /^\/(?:[^/]+\/posts\/[^/]+|reel\/\d+|videos\/\d+)\/?$/,
      linkedin: /^\/posts\/[^/]+\/?$|^\/feed\/update\/urn:li:activity:\d+\/?$/,
      youtube: /^\/watch$|^\/shorts\/[\w-]{11}\/?$/,
      tiktok: /^\/@[\w.]+\/video\/\d+\/?$/,
    };
    if (
      !paths[platform]?.test(url.pathname) ||
      (platform === "youtube" &&
        url.pathname === "/watch" &&
        (!video || !/^[\w-]{11}$/.test(video)))
    )
      throw new Error("Enter a supported public post URL, not an arbitrary page.");
    return url.href;
  }
  const url = site.routes[intent];
  if (!url)
    throw new Error(
      "This workflow requires the platform's mobile app or is unavailable on the web.",
    );
  return url;
}
/** Display-only tab metadata. Chrome endpoints and authentication remain on the Host. */
export type SocialChromeTab = { id: string; title: string; site: string };
