/** Pure helpers for the Audience screen: stage order, labels, list scopes and rates. React-free. */
import { formatNumber, t } from "../../../../shared/i18n";
import type { BadgeTone } from "../../../../shared/ui/Badge";
import type {
  AudienceFilter,
  CaptureRule,
  InteractionKind,
  PersonStage,
  SocialList,
  SocialPerson,
} from "../../model/audience";
import type { OutreachChannel, Sequence } from "../../model/outreach";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
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

/** Name shown for a list: the system Commenters list is always named in the current language. */
export function listDisplayName(list: SocialList): string {
  return isCommentersList(list) ? t("Commenters") : list.name;
}

/** What a list is, for the sidebar groups and the collection header. */
export type CollectionKind = "list" | "segment" | "commenters";

export function collectionKind(list: SocialList): CollectionKind {
  if (isCommentersList(list)) return "commenters";
  return list.kind === "dynamic" ? "segment" : "list";
}

/** The conditions of a segment as short phrases, in the order the segment form asks for them. */
export function filterSummary(filter: AudienceFilter | undefined): string[] {
  if (!filter) return [];
  const parts: string[] = [];
  if (filter.tags?.length) parts.push(t("Tagged {p0}", { p0: filter.tags.join(", ") }));
  if (filter.language) parts.push(t("Language {p0}", { p0: filter.language }));
  if (filter.minScore !== undefined)
    parts.push(t("Interest score at least {p0}", { p0: formatNumber(filter.minScore) }));
  if (filter.query) parts.push(t("Name or text contains {p0}", { p0: filter.query }));
  if (filter.platforms?.length)
    parts.push(
      t("Accounts on {p0}", {
        p0: filter.platforms.map((platform) => SOCIAL_PLATFORM_NAMES[platform]).join(", "),
      }),
    );
  if (filter.stages?.length)
    parts.push(t("Stage {p0}", { p0: filter.stages.map(stageLabel).join(", ") }));
  if (filter.sources?.length)
    parts.push(t("Came in through {p0}", { p0: filter.sources.map(interactionLabel).join(", ") }));
  return parts;
}

/** The optional conditions of a capture rule as short phrases. Empty means "everyone who matches the source". */
export function ruleConditionSummary(filter: CaptureRule["filter"]): string[] {
  const parts: string[] = [];
  if (filter.keywords?.length) parts.push(t("Text has {p0}", { p0: filter.keywords.join(", ") }));
  if (filter.language) parts.push(t("Language {p0}", { p0: filter.language }));
  if (filter.minFollowers !== undefined)
    parts.push(t("At least {p0} followers", { p0: formatNumber(filter.minFollowers) }));
  if (filter.sentiment) parts.push(t("Tone {p0}", { p0: sentimentLabel(filter.sentiment) }));
  return parts;
}

export function sentimentLabel(sentiment: NonNullable<CaptureRule["filter"]["sentiment"]>): string {
  switch (sentiment) {
    case "positive":
      return t("Positive");
    case "neutral":
      return t("Neutral");
    case "negative":
      return t("Negative");
  }
}

/** Capture rules and unfinished sequences that point at a list. Deleting the list would break them. */
export function listUses(
  list: SocialList,
  rules: readonly CaptureRule[],
  sequences: readonly Sequence[],
): { rules: CaptureRule[]; sequences: Sequence[] } {
  return {
    rules: rules.filter((rule) => rule.targetListId === list.id),
    sequences: sequences.filter(
      (sequence) => sequence.listId === list.id && sequence.status !== "done",
    ),
  };
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
