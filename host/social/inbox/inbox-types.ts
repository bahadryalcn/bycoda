import type { SocialPlatform } from "../../../src/features/social/model/social";

/** Canonical Host shapes for the unified inbox. The UI mirrors them in ui/inbox/inboxTypes.ts. */
export const INBOX_STATUSES = ["unread", "replied", "assigned", "done"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export type InboxItem = {
  threadId: string;
  accountId: string;
  platform: SocialPlatform;
  kind: "comment" | "message";
  person?: { id: string; name: string };
  title: string;
  /** Last event text, shortened to a single preview line. */
  preview: string;
  at: number;
  status: InboxStatus;
  tags: string[];
};

export type UnreadableAccount = {
  accountId: string;
  platform: SocialPlatform;
  /** Stable code from the capability map (for example "browser.no_recipe"). */
  reasonCode: string;
  /** Plain reason text from the capability map. */
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

export type InboxSettings = {
  autoRefresh: boolean;
  /** Stored per-platform period overrides, in seconds. Missing platforms use the defaults. */
  intervals: Partial<Record<SocialPlatform, number>>;
};

/** Stored per thread under the `inbox-status` record kind. */
export type InboxStatusRecord = {
  threadId: string;
  status: InboxStatus;
  tags: string[];
  updatedAt: number;
};
