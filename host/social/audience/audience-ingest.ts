import type { SocialAccount, SocialContact } from "../../../src/features/social/model/social";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { DecisionService } from "../../decision-models/decision-types";
import { identityBlocked, ensurePerson, interactionId, type PersonOrigin } from "./audience-person";
import {
  applyRule,
  enabledRulesFor,
  inboundRuleKind,
  ruleMatches,
  type RuleContext,
} from "./audience-rules";
import type { SocialAudienceStore } from "../store/social-audience-store";

type IngestContext = RuleContext & { store: SocialAudienceStore; decisions?: DecisionService };

/**
 * Links inbound senders to people. Called once per inbound event after it commits. Each event
 * gets its person (created with the handle when new), one interaction, and the enabled capture
 * rules of its source. Suppressed people are linked but never added to lists or enrolled.
 * The host ingest passes no decision service yet, so sentiment filters are skipped there.
 */
export async function linkInboundToPeople(
  ctx: IngestContext,
  account: SocialAccount,
  events: SocialInbound[],
  contacts: SocialContact[],
): Promise<void> {
  const rules = await enabledRulesFor(ctx.store, account.id);
  const byContact = new Map(contacts.map((contact) => [contact.id, contact]));
  for (const event of events) {
    const contact = byContact.get(event.contactId);
    if (!contact) continue;
    const isMessage = event.kind === "message";
    const origin: PersonOrigin = { source: isMessage ? "dm" : "comment", basis: "inbound" };
    let { person } = await ensurePerson(ctx.store, account, contact, origin, ctx.now);
    if (isMessage && (person.stage === "new" || person.stage === "contacted"))
      person = await ctx.store.putPerson({ ...person, stage: "replied", updatedAt: ctx.now });
    await ctx.store.addInteraction({
      id: interactionId(["inbound", account.id, event.eventId]),
      personId: person.id,
      accountId: account.id,
      platform: account.platform,
      kind: isMessage ? "dm" : "comment",
      ref: event.postId ?? event.threadId,
      text: event.text.slice(0, 2000),
      at: event.at,
      direction: "inbound",
    });
    const kind = inboundRuleKind(event.kind);
    if (!kind || (await identityBlocked(ctx.store, person.handles, person.id))) continue;
    for (const rule of rules) {
      if (rule.source.kind !== kind) continue;
      if (!(await ruleMatches(rule, contact, event.text, ctx.decisions))) continue;
      person = await applyRule(ctx, rule, person);
    }
  }
}
