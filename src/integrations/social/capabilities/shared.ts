import type { Capability, SocialOperation } from "../adapter";
import type { YouTubeCapability } from "./youtube-operations";

/** Operations declared for the contract but not implemented by any adapter yet (4E opens them). */
export const NOT_YET_OPERATIONS = [
  "delete",
  "analytics",
  "audience.collect",
  "profile.read",
  // Facebook Page operations
  "profile.update",
  "post.edit",
  "post.schedule",
  "comment.moderate",
  "comment.privateReply",
  "mentions.read",
  "live.read",
  "live.transmit",
] as const;
export const X_CAPABILITY_OPERATIONS = [
  "x.engagement",
  "x.relationships",
  "x.lists",
  "x.spaces",
] as const;
type XCapabilityOperation = (typeof X_CAPABILITY_OPERATIONS)[number];
export type NotYetOperation = (typeof NOT_YET_OPERATIONS)[number];
export type CapabilityOperation = SocialOperation | NotYetOperation | YouTubeCapability;
export const CAPABILITY_OPERATIONS: readonly CapabilityOperation[] = [
  "publish",
  "media",
  "comments.read",
  "reply",
  "comment",
  "inbox.read",
  "message.reply",
  "message.start",
  "search",
  "webhook",
  "poll",
  ...NOT_YET_OPERATIONS,
];

/** `reasonCode` overrides the default "unsupported.platform" for an unsupported row of an existing operation. */
export type CapabilityRequirement = {
  scopes: string[];
  reason: string;
  unsupported?: boolean;
  reasonCode?: string;
};
export type OperationRequirements = Record<
  Exclude<CapabilityOperation, YouTubeCapability>,
  CapabilityRequirement
> &
  Partial<Record<YouTubeCapability, CapabilityRequirement>>;
/** Browser wording per operation. Missing entries use the generic browser text in capabilities.ts. */
export type BrowserNotes = Partial<Record<CapabilityOperation, string>>;
export type PlatformCapabilities = { api: OperationRequirements; browser: BrowserNotes };

/** Capability row with a stable reason code. The UI translates codes; `reason` stays English text. */
export type SocialCapability = Omit<Capability, "operation"> & {
  operation: CapabilityOperation;
  reasonCode: string;
};

export const r = (
  scopes: string[],
  reason: string,
  unsupported = false,
): CapabilityRequirement => ({
  scopes,
  reason,
  unsupported,
});

export const X_ONLY_UNSUPPORTED: Record<XCapabilityOperation, CapabilityRequirement> = {
  "x.engagement": r([], "X engagement requires an X API account.", true),
  "x.relationships": r([], "X relationships require an X API account.", true),
  "x.lists": r([], "X lists require an X API account.", true),
  "x.spaces": r([], "X Spaces require an X API account.", true),
};

export const NOT_YET: Record<NotYetOperation | XCapabilityOperation, CapabilityRequirement> = {
  delete: r([], "Post deletion is not implemented yet.", true),
  analytics: r([], "Post analytics are not implemented yet.", true),
  "audience.collect": r([], "Audience collection is not implemented yet.", true),
  "profile.read": r([], "Profile reading is not implemented yet.", true),
  ...X_ONLY_UNSUPPORTED,
  // Facebook Page operations
  "profile.update": r([], "Profile editing is unavailable.", true),
  "post.edit": r([], "Post editing is unavailable.", true),
  "post.schedule": r([], "Native scheduling is unavailable.", true),
  "comment.moderate": r([], "Comment moderation is unavailable.", true),
  "comment.privateReply": r([], "Private replies to comments are unavailable.", true),
  "mentions.read": r([], "Mention reading is unavailable.", true),
  "live.read": r([], "Live video reading is unavailable.", true),
  "live.transmit": r([], "Live video management is unavailable.", true),
};

export const SOCIAL_DOCUMENTS = {
  youtube: "https://developers.google.com/youtube/v3/docs/",
  x: "https://docs.x.com/x-api/llms.txt",
  instagram: "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api",
  facebook: "https://developers.facebook.com/docs/pages-api/",
  linkedin: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/overview",
  linkedinAI: "https://learn.microsoft.com/en-us/linkedin/marketing/developer-ai-policy",
  tiktok: "https://developers.tiktok.com/docs/en/overview",
  snapchat: "https://developers.snap.com/marketing-api/Public-Profile-API/Introduction",
  whatsapp: "https://developers.facebook.com/documentation/business-messaging/whatsapp/overview",
  telegram: "https://core.telegram.org/bots/api",
  reddit: "https://www.reddit.com/dev/api/",
};
