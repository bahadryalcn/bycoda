import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { SequenceEnrollment } from "../../../src/features/social/model/outreach";
import type { SocialAccount, SocialContact } from "../../../src/features/social/model/social";
import type { SocialInbound } from "../../../src/integrations/social/adapter";
import { DEFAULT_THRESHOLD, type DecisionService } from "../../decision-models/decision-types";
import { suppress } from "../autonomy/suppression";
import { sanitizeSocialError } from "../core/social-helpers";
import type { SocialAudienceStore } from "../store/social-audience-store";
import { countStat } from "./outreach-pacing";

export type InboundContext = {
  store: SocialAudienceStore;
  now: number;
  /** Optional sentiment model; without it "positive" is never counted. */
  decisions?: DecisionService;
};

const STRONG_OPT_OUT = [
  /unsubscribe/,
  /abonelikten çık/,
  /beni (listeden|listenizden|listeye) ç[ıi]kar/,
  /rahats[ıi]z etme/,
  /istemiyorum/,
  /iletişimi durdur/,
  /mesaj (gönderme|atma)/,
  /remove me from/,
  /don'?t (contact|message|email) me/,
];
const SHORT_OPT_OUT = /^(stop|opt[ -]?out|dur|durdur)[.!?\s]*$/;

/**
 * Opt-out wording in a reply (Turkish and English). Matched on the lowercased text with Turkish
 * rules, so "İSTEMİYORUM" and "Stop" both count. A bare "stop" only counts as a whole message.
 */
export function isOptOutText(text: string): boolean {
  const normalized = text.normalize("NFC").trim().toLocaleLowerCase("tr-TR");
  if (!normalized) return false;
  return (
    SHORT_OPT_OUT.test(normalized) || STRONG_OPT_OUT.some((pattern) => pattern.test(normalized))
  );
}

/** Every active enrollment of one person, across all sequences, moved to `status`. Returns the sequence ids moved. */
async function closeEnrollments(
  ctx: InboundContext,
  personId: string,
  status: "replied" | "suppressed",
): Promise<string[]> {
  // shortcut: scans every sequence and its enrollments; upgrade: index enrollments by person.
  const moved: string[] = [];
  let sequenceCursor: string | undefined;
  do {
    const sequences = await ctx.store.listRecords("sequence", {
      cursor: sequenceCursor,
      limit: 200,
    });
    for (const sequence of sequences.items) {
      let enrollmentCursor: string | undefined;
      do {
        const page = await ctx.store.listEnrollments({
          sequenceId: sequence.id,
          cursor: enrollmentCursor,
          limit: 200,
        });
        for (const enrollment of page.items) {
          if (enrollment.personId !== personId || enrollment.status !== "active") continue;
          const closed: SequenceEnrollment = {
            ...enrollment,
            status,
            nextAt: undefined,
            updatedAt: ctx.now,
          };
          await ctx.store.putEnrollment(closed);
          await countStat(ctx.store, sequence.id, status === "replied" ? "replied" : "optedOut");
          moved.push(sequence.id);
        }
        enrollmentCursor = page.next;
      } while (enrollmentCursor);
    }
    sequenceCursor = sequences.next;
  } while (sequenceCursor);
  return moved;
}

async function classifyPositive(decisions: DecisionService, text: string): Promise<boolean> {
  try {
    const result = await decisions.decide({
      taskType: "sentiment",
      personalData: true,
      state: { text: text.slice(0, 1000) },
      questions: {
        positive: {
          type: "noul",
          instructions:
            "Does this reply show clear interest in the offer or ask for the next step?",
          criteria: {
            true: "clearly interested, asks a question about the offer or wants to continue",
            false: "neutral, negative, unrelated or unclear",
          },
        },
      },
    });
    const answer = result.answers.positive;
    return (
      answer !== undefined &&
      !("error" in answer) &&
      answer.confidence >= DEFAULT_THRESHOLD &&
      answer.value === true
    );
  } catch (error) {
    console.error("Social outreach sentiment check failed:", sanitizeSocialError(error));
    return false;
  }
}

async function optOutPerson(
  ctx: InboundContext,
  person: SocialPerson,
  account: SocialAccount,
  contact: SocialContact,
): Promise<void> {
  // Same id for the same person, handle and channel: a repeated opt-out writes the same record.
  await suppress(
    { audience: ctx.store, now: () => ctx.now },
    {
      personId: person.id,
      handle: { platform: account.platform, platformId: contact.platformId },
      channel: "all",
      reason: "opt_out",
      source: "outreach-inbound",
    },
  );
  await closeEnrollments(ctx, person.id, "suppressed");
  if (person.stage !== "opted_out")
    await ctx.store.putPerson({ ...person, stage: "opted_out", updatedAt: ctx.now });
}

async function markReplied(ctx: InboundContext, person: SocialPerson, text: string): Promise<void> {
  const moved = await closeEnrollments(ctx, person.id, "replied");
  if (person.stage === "new" || person.stage === "contacted")
    await ctx.store.putPerson({ ...person, stage: "replied", updatedAt: ctx.now });
  if (!moved.length || !ctx.decisions) return;
  if (await classifyPositive(ctx.decisions, text))
    for (const sequenceId of moved) await countStat(ctx.store, sequenceId, "positive");
}

/**
 * Reacts to inbound events after the event is stored. A reply ends the person's active enrollments
 * (stopOnReply). Opt-out wording suppresses the person on every channel and ends their enrollments.
 * Both are idempotent: a repeated event changes nothing more.
 */
export async function onInbound(
  ctx: InboundContext,
  account: SocialAccount,
  events: SocialInbound[],
  contacts: SocialContact[],
): Promise<void> {
  for (const event of events) {
    const contact = contacts.find((item) => item.id === event.contactId);
    if (!contact) continue;
    const person = await ctx.store.findPersonByHandle(account.id, contact.platformId);
    if (!person) continue;
    if (event.optedOut || isOptOutText(event.text))
      await optOutPerson(ctx, person, account, contact);
    else await markReplied(ctx, person, event.text);
  }
}
