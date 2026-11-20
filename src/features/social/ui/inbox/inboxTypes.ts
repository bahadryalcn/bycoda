import type { SocialPlatform } from "../../model/social";

/**
 * Mirror of host/social/inbox/inbox-types.ts (the Host owns the shape). Move both into the social
 * model when the provisional types in model/socialActions.ts are replaced.
 */
export const INBOX_STATUSES = ["unread", "replied", "assigned", "done"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** Mirrors the Host's inbox tag limits (host/social/inbox/inbox-status.ts): tags per conversation and characters per tag. */
export const INBOX_TAGS_MAX = 10;
export const INBOX_TAG_MAX_LENGTH = 40;

export type InboxItem = {
  threadId: string;
  accountId: string;
  platform: SocialPlatform;
  kind: "comment" | "message";
  instagramSource?: "live_comment";
  person?: { id: string; name: string };
  title: string;
  preview: string;
  at: number;
  status: InboxStatus;
  tags: string[];
};

export type UnreadableAccount = {
  accountId: string;
  platform: SocialPlatform;
  reasonCode: string;
  reason: string;
};

export type InboxUnifiedResult = {
  items: InboxItem[];
  unreadable: UnreadableAccount[];
  next?: string;
};

export type InboxReplyOptions = {
  canReply: boolean;
  reason?: string;
  reasonCode?: string;
  templatesOnly?: boolean;
  instagram?: { privateReply?: true; attachment?: true; localAttachment?: true };
};

export type InboxTimelineEvent = {
  id: string;
  at: number;
  direction: "inbound" | "outbound";
  platform: SocialPlatform | "email";
  accountId: string;
  threadId?: string;
  kind: "comment" | "message" | "interaction";
  text: string;
};

export type PersonTimeline = {
  personId: string;
  /** One page, oldest first. */
  events: InboxTimelineEvent[];
  truncated: boolean;
  /** Cursor for the older page; absent once the start of the conversation is reached. */
  next?: string;
};

export type InboxSettings = {
  autoRefresh: boolean;
  intervals: Partial<Record<SocialPlatform, number>>;
};

export type InboxFilterState = {
  status: InboxStatus | "all";
  accountId: string;
  query: string;
};
