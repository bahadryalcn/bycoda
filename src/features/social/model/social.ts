/** Public host contract. OAuth credentials and tool grants never belong here. */
import type { RemoteProvider } from "../../connections/model/protocol";
export type SocialAgent = { provider: RemoteProvider; model?: string };
export type SocialPolicy = {
  agent?: SocialAgent;
  maxContentCharacters?: number;
  maxCommentCharacters?: number;
  maxMessageCharacters?: number;
};
export type SocialPolicies = {
  global: SocialPolicy;
  platforms: Partial<Record<SocialPlatform, SocialPolicy>>;
};
export type SocialMonitorChannel = {
  channel: "mentions" | "messages" | "comments";
  status: "read" | "unavailable";
  reason?: "response_unavailable" | "chat_setup_required" | "encrypted_chat_unsupported";
};
export type SocialMonitorStatus = {
  status: "idle" | "healthy" | "partial" | "blocked";
  checkedAt?: number;
  error?: string;
  pollingEnabled?: boolean;
  accountActive?: boolean;
  coverage?: SocialMonitorChannel[];
};
export const SOCIAL_CAPABILITY = "social.v1";
export const SOCIAL_PLATFORMS = [
  "x",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "snapchat",
  "whatsapp",
  "telegram",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_PLATFORM_NAMES: Record<SocialPlatform, string> = {
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};
export const SOCIAL_ACCOUNT_TYPES = {
  x: ["member"],
  instagram: ["professional"],
  facebook: ["page"],
  linkedin: ["member", "organization"],
  youtube: ["channel"],
  tiktok: ["member"],
  snapchat: ["public_profile"],
  whatsapp: ["business"],
  telegram: ["bot"],
} as const satisfies Record<SocialPlatform, readonly string[]>;
export const PROFILE_ONLY_PLATFORMS: readonly SocialPlatform[] = ["snapchat"];
export const TOKEN_PLATFORMS: readonly SocialPlatform[] = ["whatsapp", "telegram"];
export type SocialPermission = "read" | "draft" | "publish" | "reply" | "message" | "comment";
export type SocialOperation =
  | "publish"
  | "media"
  | "comments.read"
  | "reply"
  | "comment"
  | "inbox.read"
  | "message.reply"
  | "message.start"
  | "search"
  | "webhook"
  | "poll";
export type Capability = {
  operation: SocialOperation;
  status: "available" | "unsupported" | "pending" | "expired";
  reason: string;
  scopes: string[];
  source: string;
};
export type SocialAccount = {
  id: string;
  platform: SocialPlatform;
  platformId: string;
  name: string;
  accountType:
    | "member"
    | "organization"
    | "professional"
    | "page"
    | "channel"
    | "public_profile"
    | "business"
    | "bot";
  scopes: string[];
  accessApproved: boolean;
  expiresAt?: number;
  connected: boolean;
  /** Undefined means OAuth. Browser is X only; token uses host-configured bot/business credentials. */
  connection?: "oauth" | "browser" | "token";
  paused: boolean;
  executorId: string;
  grants: Record<string, SocialPermission[]>;
  createdAt: number;
};
export type PublicFact = {
  id: string;
  topic: string;
  text: string;
  source: string;
  verifiedAt: number;
};
export type SocialProjectProfile = {
  projectId: string;
  productName: string;
  brandVoice: string;
  facts: PublicFact[];
};
export type SocialMedia = {
  kind: "image" | "video";
  url?: string;
  uploadId?: string;
  alt?: string;
};
export type CampaignVariant = {
  accountId: string;
  text: string;
  media: SocialMedia[];
  link?: string;
  scheduledAt: number;
  factIds: string[];
  youtube?: YouTubeVideoOptions;
  tiktok?: TikTokVideoOptions;
};
export type TikTokCreatorInfo = {
  nickname: string;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSeconds: number;
};
export type TikTokVideoOptions = {
  privacy: string;
  durationSeconds: number;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
  isAigc: boolean;
  consent: boolean;
};
export type YouTubeVideoOptions = {
  title: string;
  privacy: "private" | "unlisted" | "public";
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
};
export type SocialCampaign = {
  id: string;
  name: string;
  projectIds: string[];
  variants: CampaignVariant[];
  revision: number;
  paused: boolean;
  createdAt: number;
};
export type SocialPublishingSchedule = {
  /** IANA timezone, e.g. Europe/Istanbul. The window uses this timezone. */
  timeZone: string;
  /** HH:mm. An equal start/end means all day; end before start spans midnight. */
  startTime: string;
  endTime: string;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
};
/** A finite pool of exact owner-approved campaign variants, published once each. */
export type SocialPublishingPlan = {
  id: string;
  name: string;
  accountId: string;
  projectId: string;
  campaigns: { campaignId: string; revision: number }[];
  schedule: SocialPublishingSchedule;
  revision: number;
  enabled: boolean;
  nextIndex: number;
  nextRunAt?: number;
  pendingJobId?: string;
  lastJobId?: string;
  lastRunAt?: number;
  activatedAt?: number;
  completedAt?: number;
  pausedReason?: string;
  createdAt: number;
};
export type SocialThread = {
  id: string;
  accountId: string;
  platformThreadId: string;
  kind: "comment" | "message";
  projectId?: string;
  contactId: string;
  reviewReason?: string;
  lastInboundAt: number;
  replyUntil?: number;
  replyAllowed?: boolean;
  platformPostId?: string;
  events: {
    id: string;
    text: string;
    at: number;
    direction: "inbound" | "outbound";
    platformId: string;
  }[];
  /** Workspace rows contain a preview; the selected thread uses thread.page. */
  eventsPage?: SocialPage;
  eventsPreview?: boolean;
  hasInbound?: boolean;
};
export type ContactConsent = { allowed: boolean; source: string; at: number };
export type SocialContact = {
  id: string;
  accountId: string;
  platformId: string;
  name: string;
  profileUrl?: string;
  source: "manual" | "import" | "api";
  tags: string[];
  language?: string;
  projectIds: string[];
  consent?: ContactConsent;
  replyEligible: boolean;
  commentEligible: boolean;
  optedOut: boolean;
  history: {
    operationId: string;
    kind: string;
    at: number;
    platformId?: string;
  }[];
  historyPage?: SocialPage;
};
export type SocialSegment = {
  id: string;
  name: string;
  projectIds: string[];
  tags: string[];
  language?: string;
};
export type SocialDraft = {
  id: string;
  accountId: string;
  projectId: string;
  kind: "reply" | "message" | "comment";
  threadId?: string;
  contactId: string;
  postId?: string;
  text: string;
  media?: SocialMedia[];
  factIds: string[];
  inboundEventId?: string;
  createdAt: number;
  reviewReason?: string;
  approvedAt?: number;
  generation?: {
    status: "queued" | "running" | "completed" | "review";
    agent: SocialAgent;
    prompt: string;
    ruleId: string;
    policySignature: string;
  };
  ruleId?: string;
};
/** Owner approval must carry the full preview displayed before any async lookup. */
export type SocialDraftApprovalInput = { id: string; reviewedDraft: SocialDraft };
export type SocialRule = {
  id: string;
  name: string;
  accountId: string;
  projectId: string;
  mode: "draft" | "approval" | "automatic";
  trigger: "comment" | "message";
  topics: string[];
  dailyLimit: number;
  enabled: boolean;
  stopWords: string[];
  answers: { keyword: string; factId: string }[];
  activatedAt?: number;
  pausedReason?: string;
  agent?: SocialAgent;
};
export type SocialJob = {
  id: string;
  operationId: string;
  dedupeKey: string;
  accountId: string;
  projectIds: string[];
  sessionId?: string;
  provider: string;
  campaignId?: string;
  publishingPlanId?: string;
  programId?: string;
  occurrenceId?: string;
  draftId?: string;
  ruleId?: string;
  kind: "publish" | "reply" | "message" | "comment";
  payload: {
    text: string;
    media: SocialMedia[];
    link?: string;
    recipientId?: string;
    threadId?: string;
    postId?: string;
    objectPostId?: string;
    youtube?: YouTubeVideoOptions;
    tiktok?: TikTokVideoOptions;
  };
  contactId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "review" | "cancelled";
  scheduledAt: number;
  attempts: number;
  dispatchedAt?: number;
  error?: string;
  platformId?: string;
  url?: string;
  visibility?: "private" | "unlisted" | "public";
  createdAt: number;
  actorId: string;
  preparation?: {
    containerId?: string;
    mediaIds?: string[];
    tiktokPublishId?: string;
    xVideo?: { id: string; expiresAt: number };
    /** Descriptions confirmed by X for uploaded media, retained across retries. */
    xAltText?: Record<string, string>;
  };
};
export type SocialAudit = {
  operationId: string;
  actorId: string;
  projectId?: string;
  projectIds?: string[];
  sessionId?: string;
  provider: string;
  socialAccountId?: string;
  socialAccountIds?: string[];
  action: string;
  at: number;
  outcome: "success" | "denied";
};
export type SocialSnapshot = {
  programsSupported?: boolean;
  programProjectId?: string;
  executorId: string;
  hostOnline: boolean;
  sendingEnabled: boolean;
  stopped: boolean;
  pollingEnabled: boolean;
  accounts: SocialAccount[];
  campaigns: SocialCampaign[];
  approvedCampaignIds?: string[];
  publishingPlans?: SocialPublishingPlan[];
  threads: SocialThread[];
  contacts: SocialContact[];
  segments: SocialSegment[];
  rules: SocialRule[];
  jobs: SocialJob[];
  drafts: SocialDraft[];
  profiles: SocialProjectProfile[];
  capabilities: Record<string, Capability[]>;
  policies?: SocialPolicies;
  /** Present for bounded workspace reads; the MCP snapshot remains complete. */
  pages?: Partial<Record<SocialCollection, SocialPage>>;
  jobCounts?: Partial<Record<SocialJob["status"], number>>;
  campaignJobCounts?: Partial<Record<SocialJob["status"], number>>;
  campaignStates?: Record<string, SocialJob["status"] | "draft" | "paused" | "partial">;
  /** Bounded references needed by the current pages, separate from list rows. */
  related?: {
    campaigns?: SocialCampaign[];
    contacts?: SocialContact[];
    jobs?: SocialJob[];
    threads?: SocialThread[];
  };
  filters?: SocialWorkspaceFilters;
};

export const SOCIAL_COLLECTIONS = [
  "campaigns",
  "publishingPlans",
  "threads",
  "contacts",
  "rules",
  "jobs",
  "drafts",
] as const;
export type SocialCollection = (typeof SOCIAL_COLLECTIONS)[number];
export type SocialPage = { offset: number; limit: number; total: number };
export type SocialCollectionFilter = {
  query?: string;
  accountId?: string;
  kind?: string;
  status?: string;
  segmentId?: string;
  since?: number;
};
export type SocialWorkspaceFilters = Partial<Record<SocialCollection, SocialCollectionFilter>>;
export type SocialWorkspaceQuery = {
  cursor?: string;
  projectId?: string;
  offsets?: Partial<Record<SocialCollection, number>>;
  limit?: number;
  filters?: SocialWorkspaceFilters;
  section?:
    | "accounts"
    | "campaigns"
    | "inbox"
    | "audience"
    | "plans"
    | "rules"
    | "history"
    | "sending"
    | "settings";
};
export type SocialWorkspaceResponse = {
  cursor: string;
  unchanged: boolean;
  snapshot?: SocialSnapshot;
};

/** MCP identifiers use underscores; host RPC/CLI keeps the dot contract. */
export const SOCIAL_TOOLS = [
  "policy.get",
  "accounts.list",
  "capabilities.get",
  "campaigns.create",
  "campaigns.preview",
  "campaigns.schedule",
  "campaigns.status",
  "inbox.list",
  "thread.read",
  "replies.draft",
  "replies.send",
  "contacts.upsert",
  "contacts.search",
  "segments.create",
  "messages.draft",
  "messages.send",
  "comments.draft",
  "comments.send",
  "automations.create",
  "automations.pause",
  "jobs.status",
  "jobs.cancel",
  "programs.list",
  "programs.configure",
  "programs.status",
  "programs.generate",
  "programs.preview-schedule",
] as const;
export type SocialTool = (typeof SOCIAL_TOOLS)[number];
export function socialToolName(tool: SocialTool): string {
  return `social_${tool.replace(/[.-]/g, "_")}`;
}
