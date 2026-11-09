import type { CaptureRule, SocialPerson } from "../../../src/features/social/model/audience";
import type { SocialContact } from "../../../src/features/social/model/social";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { DecisionService } from "../../decision-models/decision-types";
import { hash } from "../core/social-helpers";
import type { SocialAudienceStore } from "../store/social-audience-store";

export type RuleContext = { store: SocialAudienceStore; now: number };

/** Enabled rules that read from this account (an empty account ID means every account). */
export async function enabledRulesFor(
  store: SocialAudienceStore,
  accountId: string,
): Promise<CaptureRule[]> {
  const rules: CaptureRule[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.listRecords("capture-rule", { cursor, limit: 200 });
    for (const rule of page.items)
      if (rule.enabled && (!rule.source.accountId || rule.source.accountId === accountId))
        rules.push(rule);
    cursor = page.next;
  } while (cursor);
  return rules;
}

/** Which rule source an inbound event feeds: comments on own posts, or direct messages. */
export function inboundRuleKind(
  kind: SocialInbound["kind"],
): CaptureRule["source"]["kind"] | undefined {
  if (kind === "comment") return "own_post_comments";
  if (kind === "message") return "dm_senders";
  return undefined;
}

export function keywordsMatch(text: string, keywords: string[] | undefined): boolean {
  if (!keywords?.length) return true;
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

const SENTIMENT_LEVELS = ["negative", "neutral", "positive"] as const;

/**
 * Sentiment through the decision service. Without a service the filter is skipped (see
 * linkInboundToPeople); with a service but no answer the rule does not match.
 */
async function sentimentMatches(
  decisions: DecisionService,
  text: string,
  wanted: "positive" | "neutral" | "negative",
): Promise<boolean> {
  const result = await decisions
    .decide({
      taskType: "sentiment",
      personalData: true,
      state: { text: text.slice(0, 1000) },
      questions: {
        sentiment: {
          type: "score",
          instructions: "Classify the sentiment of the message, from negative to positive.",
          criteria: [...SENTIMENT_LEVELS],
        },
      },
    })
    .catch(() => undefined);
  const answer = result?.answers.sentiment;
  if (!answer || "error" in answer || typeof answer.value !== "number") return false;
  return SENTIMENT_LEVELS[answer.value] === wanted;
}

/**
 * Filters of one rule against one inbound event. minFollowers cannot be evaluated: inbound events
 * carry no follower count, so such a rule never adds people from inbound (conservative).
 */
export async function ruleMatches(
  rule: CaptureRule,
  contact: SocialContact,
  text: string,
  decisions: DecisionService | undefined,
): Promise<boolean> {
  const filter = rule.filter;
  if (filter.minFollowers !== undefined) return false;
  if (!keywordsMatch(text, filter.keywords)) return false;
  if (filter.language && contact.language !== filter.language) return false;
  if (filter.sentiment && decisions && !(await sentimentMatches(decisions, text, filter.sentiment)))
    return false;
  return true;
}

/** Applies one matched rule: adds to the static list, adds a tag, or starts a sequence enrollment. */
export async function applyRule(
  ctx: RuleContext,
  rule: CaptureRule,
  person: SocialPerson,
): Promise<SocialPerson> {
  let current = person;
  const list = await ctx.store.getList(rule.targetListId);
  if (list?.kind === "static")
    await ctx.store.addMembers(list.id, [current.id], { source: `rule:${rule.id}`, at: ctx.now });
  if (rule.action?.kind === "tag" && !current.tags.includes(rule.action.tag))
    current = await ctx.store.putPerson({
      ...current,
      tags: [...current.tags, rule.action.tag],
      updatedAt: ctx.now,
    });
  if (rule.action?.kind === "enroll") {
    const sequenceId = rule.action.sequenceId;
    const id = `enr-${hash(`${sequenceId}\u0000${current.id}`).slice(0, 40)}`;
    if ((await ctx.store.getRecord("sequence", sequenceId)) && !(await ctx.store.getEnrollment(id)))
      await ctx.store.putEnrollment({
        id,
        sequenceId,
        personId: current.id,
        stepIndex: 0,
        status: "active",
        nextAt: ctx.now,
        updatedAt: ctx.now,
      });
  }
  return current;
}
