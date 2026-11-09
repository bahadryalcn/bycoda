/** Pure helpers for the Audience screen: stage order, labels, list scopes and rates. React-free. */
import { formatNumber, t } from "../../../../shared/i18n";
import type { BadgeTone } from "../../../../shared/ui/Badge";
import type {
  AudienceFilter,
  InteractionKind,
  PersonStage,
  SocialList,
  SocialPerson,
} from "../../model/audience";
import type { OutreachChannel } from "../../model/outreach";
import type { PeopleListInput } from "../../model/socialActions";

/** Order of the stage line. `closed` and `opted_out` end the line instead of continuing it. */
export const PIPELINE_STAGES: readonly PersonStage[] = [
  "new",
  "contacted",
  "replied",
  "interested",
  "customer",
];
export const ALL_STAGES: readonly PersonStage[] = [...PIPELINE_STAGES, "closed", "opted_out"];

export const IYS_STATES = ["unknown", "approved", "rejected"] as const;
export type IysState = (typeof IYS_STATES)[number];

export function stageLabel(stage: PersonStage): string {
  switch (stage) {
    case "new":
      return t("New");
    case "contacted":
      return t("Contacted");
    case "replied":
      return t("Replied");
    case "interested":
      return t("Interested");
    case "customer":
      return t("Customer");
    case "closed":
      return t("Closed");
    case "opted_out":
      return t("Opted out");
  }
}

/** Badge tone of a stage: progress reads cooler to warmer, opting out is the only danger. */
export function stageTone(stage: PersonStage): BadgeTone {
  switch (stage) {
    case "contacted":
      return "info";
    case "replied":
      return "accent";
    case "interested":
      return "warning";
    case "customer":
      return "success";
    case "opted_out":
      return "danger";
    case "new":
    case "closed":
      return "neutral";
  }
}

/** The first `max` tags to show and how many are folded into a "+N" badge. */
export function visibleTags(
  tags: readonly string[],
  max = 2,
): { shown: readonly string[]; hidden: number } {
  return { shown: tags.slice(0, max), hidden: Math.max(0, tags.length - max) };
}

export function channelLabel(channel: OutreachChannel): string {
  switch (channel) {
    case "dm":
      return t("Direct message");
    case "comment":
      return t("Comment");
    case "mention":
      return t("Mention");
    case "email":
      return t("Email");
    case "whatsapp":
      return t("WhatsApp");
    case "telegram":
      return t("Telegram");
  }
}

export function iysLabel(state: IysState): string {
  switch (state) {
    case "unknown":
      return t("Not checked");
    case "approved":
      return t("Approved");
    case "rejected":
      return t("Rejected");
  }
}

/** The people query for the selected list. Dynamic segments are evaluated from their filter. */
export function peopleScope(list: SocialList | undefined): PeopleListInput {
  if (!list) return {};
  return list.kind === "dynamic" ? { filter: list.filter ?? {} } : { listId: list.id };
}

export function isCommentersList(list: SocialList): boolean {
  return list.system === "commenters";
}

/** Trims, drops empty values and removes duplicates while keeping the first spelling. */
export function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function isFilterEmpty(filter: AudienceFilter): boolean {
  return (
    !filter.tags?.length &&
    !filter.language &&
    !filter.platforms?.length &&
    !filter.stages?.length &&
    filter.minScore === undefined &&
    !filter.query &&
    !filter.sources?.length
  );
}

/** Share of `part` in `whole`, formatted for the current locale. Zero sent shows a dash. */
export function rateText(part: number, whole: number): string {
  if (whole <= 0) return "–";
  return formatNumber(part / whole, { style: "percent", maximumFractionDigits: 1 });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : t("Something went wrong. Try again.");
}

/** Plain-language origin of a person, as shown in the person panel. */
export function sourceLabel(source: SocialPerson["source"]): string {
  switch (source) {
    case "comment":
      return t("Commented on your post");
    case "like":
      return t("Liked your post");
    case "share":
      return t("Shared your post");
    case "quote":
      return t("Quoted your post");
    case "mention":
      return t("Mentioned you");
    case "dm":
      return t("Sent you a message");
    case "follower":
      return t("Follows you");
    case "search":
      return t("Found by search");
    case "reply":
      return t("Replied to you");
    case "email":
      return t("Email");
    case "import":
      return t("Imported from a file");
    case "manual":
      return t("Added by you");
    case "migration":
      return t("Existing contact");
  }
}

/** Plain-language name of an interaction kind, for the activity timeline and filters. */
export function interactionLabel(kind: InteractionKind): string {
  switch (kind) {
    case "comment":
      return t("Comment");
    case "like":
      return t("Like");
    case "share":
      return t("Share");
    case "quote":
      return t("Quote");
    case "mention":
      return t("Mention");
    case "dm":
      return t("Direct message");
    case "follower":
      return t("Follower");
    case "search":
      return t("Search match");
    case "import":
      return t("Imported");
    case "email":
      return t("Email");
    case "reply":
      return t("Reply");
  }
}
