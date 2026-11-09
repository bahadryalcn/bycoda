/**
 * Input and output shapes for the Social Host actions of target-architecture section 3, plus the
 * read-only action names that never carry a request id. React-free.
 * Shapes marked "provisional" are placeholders: the Phase 4 owner named in the comment confirms or
 * replaces them when it implements the Host side.
 */
import type { AiAction, AutonomyPolicy } from "./autonomy";
import type {
  AudienceFilter,
  CaptureRule,
  CaptureSource,
  Interaction,
  SocialPerson,
} from "./audience";
import type { EmailAccount, Sequence, SequenceEnrollment, Suppression } from "./outreach";
import type { SocialPlatform } from "./social";

export type ListPage<T> = { items: T[]; next?: string };

/** Read-only actions (section 3, RO = yes or list RO). The client sends no requestId for these. */
export const SOCIAL_READ_ACTIONS = [
  "people.list",
  "people.get",
  "people.matchSuggestions",
  "people.export",
  "lists.list",
  "captureRules.list",
  "sequences.list",
  "sequences.stats",
  "enrollments.list",
  "email.accounts.list",
  "suppressions.list",
  "inbox.unified",
  "inbox.timeline",
  "inbox.replyOptions",
  "autonomy.get",
  "ai.actions.list",
  "ai.summary",
  "ai.report",
  "browser.needsHuman.list",
  "browser.settings.get",
  "browser.recipeSuggestions.list",
] as const;
export type SocialReadAction = (typeof SOCIAL_READ_ACTIONS)[number];

// Audience (owner: audience module)
export type PeopleListInput = {
  filter?: AudienceFilter;
  listId?: string;
  cursor?: string;
  limit?: number;
};
export type PeopleListResult = ListPage<SocialPerson>;
export type PersonDetail = {
  person: SocialPerson;
  interactions: Interaction[];
  enrollments: SequenceEnrollment[];
  suppressed: boolean;
};
export type PeopleUpdateInput = {
  personId: string;
  patch: Partial<
    Pick<SocialPerson, "name" | "tags" | "notes" | "stage" | "emails" | "commercialConsent">
  >;
};
export type PersonMatchSuggestion = { personIds: string[]; reason: string; score: number };
export type ListSaveInput = {
  id?: string;
  name: string;
  kind: "static" | "dynamic";
  filter?: AudienceFilter;
  projectIds: string[];
};
export type ListMembersInput = { listId: string; personIds: string[] };
export type CollectInput = { source: CaptureSource; targetListId?: string; limit?: number };
export type CollectResult = { collected: number; skipped: number; unsupported?: string };
export type ImportInput = {
  format: "csv" | "xlsx" | "json";
  /** Base64 for xlsx; plain text for csv and json. */
  content: string;
  mapping?: Record<string, string>;
  accountId: string;
  listId?: string;
};
export type ImportResult = { imported: number; rejected: { row: number; reason: string }[] };
export type CaptureRuleSaveInput = Pick<
  CaptureRule,
  "name" | "source" | "filter" | "targetListId"
> &
  Partial<Pick<CaptureRule, "id" | "enabled" | "action">>;
export type CaptureRuleSetEnabledInput = { id: string; enabled: boolean };
/** people.score (Host adds it outside the section 3 table): AI interest score through the decision service. */
export type PersonScoreResult = { scored: boolean; person: SocialPerson };

// Outreach (owner: outreach module)
export type SequenceSaveInput = Pick<Sequence, "name" | "listId" | "steps" | "pacing"> &
  Partial<Pick<Sequence, "id" | "status">>;
export type SequenceStats = {
  sent: number;
  replied: number;
  positive: number;
  optedOut: number;
  failed: number;
};
export type EmailAccountSaveInput = Pick<EmailAccount, "kind" | "from" | "name"> &
  Partial<Omit<EmailAccount, "kind" | "from" | "name" | "createdAt">> & {
    /** Stored in the vault by the Host; never returned and never logged. */
    secret?: string;
  };
export type SuppressionAddInput = Pick<Suppression, "channel" | "reason"> &
  Partial<Pick<Suppression, "personId" | "handle" | "email">>;
/** Host result of email.send (host/social/email/email-actions.ts). */
export type EmailSendResult = { sent: true; messageId?: string };

// Inbox (owner: inbox module). Shapes mirror host/social/inbox/inbox-types.ts; the UI must not import host/.
export type InboxStatus = "unread" | "replied" | "assigned" | "done";
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
  reason: string;
};
export type InboxUnifiedInput = {
  filter?: {
    status?: InboxStatus;
    channel?: SocialPlatform;
    accountId?: string;
    query?: string;
  };
  cursor?: string;
  limit?: number;
};
export type InboxUnifiedResult = {
  items: InboxItem[];
  unreadable: UnreadableAccount[];
  next?: string;
};
export type InboxSetStatusInput = { threadId: string; status: InboxStatus; tags?: string[] };
export type InboxSetStatusResult = { threadId: string; status: InboxStatus; tags: string[] };
export type InboxReplyOptions = {
  canReply: boolean;
  reason?: string;
  reasonCode?: string;
  templatesOnly?: boolean;
};
export type InboxSettings = {
  autoRefresh: boolean;
  /** Per-platform period overrides in seconds. Missing platforms use the Host defaults. */
  intervals: Partial<Record<SocialPlatform, number>>;
};
export type InboxSettingsInput = {
  autoRefresh: boolean;
  intervals?: Partial<Record<SocialPlatform, number>>;
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
export type InboxTimelineResult = {
  personId: string;
  events: InboxTimelineEvent[];
  truncated: boolean;
};

// Autonomy (owner: autonomy module). Host input: levels and limits merge onto the current policy;
// `workingHours: null` clears the window. Version and author are set by the Host.
export type AutonomySetInput = {
  accountId: string;
  policy: {
    levels?: Partial<AutonomyPolicy["levels"]>;
    limits?: AutonomyPolicy["limits"];
    workingHours?: NonNullable<AutonomyPolicy["workingHours"]> | null;
  };
  confirm?: "ENABLE_AUTONOMY";
};

// AI (owner: ai module)
export type AiPlanStep = {
  id: string;
  action: string;
  input: Record<string, unknown>;
  summary: string;
  needsApproval: boolean;
  reason?: string;
};
export type AiPlan = { planId: string; steps: AiPlanStep[] };
export type AiPlanRunResult = {
  results: { stepId: string; status: AiAction["status"]; message?: string }[];
};
export type AiSummary = {
  sentToday: number;
  pending: number;
  newPeople: number;
  replyRate: number;
  waitingForYou: number;
};
/** Provisional (4D). */
export type AiReport = { done: string[]; results: string[]; suggestions: string[] };

// Browser layers (owner: browser-layers module)
export type NeedsHumanItem = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  /** A recognized screen only; the app never solves a challenge or verification itself. */
  reason: "challenge" | "verification" | "login" | "unexpected_screen";
  at: number;
  screenshotRef?: string;
  jobId?: string;
};
export type BrowserSettings = {
  accountId: string;
  visibility: "hidden" | "visible";
  desktopControl: { allowed: boolean; computerId?: string };
};
/** Provisional (4H). */
export type RecipeSuggestion = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  summary: string;
  status: "pending" | "approved" | "rejected";
};
/** Provisional (4H): one live view frame returned by `social.browser.view.frame`. */
export type BrowserViewFrame = { jpegBase64: string; width: number; height: number };
/** Provisional (4H): pointer, keyboard and scroll events forwarded to the live view. */
export type BrowserViewInput =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number };
