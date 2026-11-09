import { randomUUID } from "node:crypto";
import type { SocialContact } from "../../../src/features/social/model/social";
import type { SocialPrincipal } from "../social";
import { forEachAsync } from "../../async-collections";
import { suppressContact } from "../autonomy/suppression";
import type { SocialServiceInternals } from "../core/social-internals";
import { array, exact, finite, str, url } from "../core/social-helpers";

/** Owner or verified-inbound contact upsert. Consent and eligibility changes stay owner-gated. */
export async function upsertSocialContact(
  s: SocialServiceInternals,
  p: SocialPrincipal,
  input: Record<string, unknown>,
): Promise<SocialContact> {
  exact(input, [
    "id",
    "accountId",
    "platformId",
    "name",
    "profileUrl",
    "source",
    "tags",
    "language",
    "projectIds",
    "consent",
    "replyEligible",
    "commentEligible",
    "optedOut",
  ]);
  const accountId = str(input.accountId, "account");
  await s.access(p, accountId, "draft");
  const platformId = str(input.platformId, "platform identity", 300);
  const previous = (await s.list<SocialContact>("contact")).find(
    (contact) => contact.accountId === accountId && contact.platformId === platformId,
  );
  if (input.id && input.id !== previous?.id)
    throw new Error("Contact identities cannot be reassigned.");
  if (previous) await s.accessibleContact(p, previous.id);
  if (
    p.kind !== "owner" &&
    (input.consent !== undefined ||
      input.replyEligible !== undefined ||
      input.commentEligible !== undefined ||
      input.optedOut === false)
  )
    throw new Error(
      "Only the owner or verified inbound events can establish communication eligibility.",
    );
  const projectIds = array(input.projectIds ?? previous?.projectIds ?? [p.projectId], "projects");
  await forEachAsync(projectIds, async (id) => await s.project(p, id));
  let consent = previous?.consent;
  if (input.consent !== undefined) {
    s.owner(p);
    if (!input.consent || typeof input.consent !== "object")
      throw new Error("Invalid communication consent.");
    const raw = input.consent as Record<string, unknown>;
    if (typeof raw.allowed !== "boolean") throw new Error("Invalid communication consent.");
    consent = {
      allowed: raw.allowed,
      source: str(raw.source, "consent source", 1000),
      at: finite(raw.at, "consent date", 1, s.now()),
    };
  }
  const source = input.source ?? previous?.source ?? "manual";
  if (source !== "manual" && source !== "import" && source !== "api")
    throw new Error("Invalid contact source.");
  if (source === "api" && p.kind !== "owner")
    throw new Error("API provenance is assigned by the host.");
  const contact: SocialContact = {
    id: previous?.id ?? randomUUID(),
    accountId,
    platformId,
    name: str(input.name ?? previous?.name ?? platformId, "contact name", 300),
    profileUrl: input.profileUrl ? url(input.profileUrl, "profile URL") : previous?.profileUrl,
    source,
    tags: array(input.tags ?? previous?.tags ?? [], "explicit labels", 30),
    language: input.language ? str(input.language, "language", 30) : previous?.language,
    projectIds,
    consent,
    replyEligible:
      input.replyEligible === undefined
        ? (previous?.replyEligible ?? false)
        : input.replyEligible === true,
    commentEligible:
      input.commentEligible === undefined
        ? (previous?.commentEligible ?? false)
        : input.commentEligible === true,
    optedOut: previous?.optedOut || input.optedOut === true,
    history: previous?.history ?? [],
  };
  await s.put("contact", contact.id, contact);
  if (contact.optedOut || (consent && !consent.allowed)) return await s.optOut(contact);
  return contact;
}

/** Opt-out is terminal: eligibility is revoked, the person is suppressed on every channel, and queued outreach to the contact is cancelled. */
export async function optOutContact(
  s: SocialServiceInternals,
  contact: SocialContact,
): Promise<SocialContact> {
  contact.optedOut = true;
  contact.replyEligible = false;
  contact.commentEligible = false;
  if (contact.consent) contact.consent.allowed = false;
  await s.put("contact", contact.id, contact);
  await suppressContact(s, contact, "opt-out");
  for await (const page of s.jobArchive.jobPages(
    "json_extract(value,'$.contactId')=? AND status='queued'",
    [contact.id],
  ))
    for (const job of page) {
      job.status = "cancelled";
      job.error = "Contact opted out.";
      await s.writeJob(job);
    }
  return contact;
}

/**
 * Clears the personal fields of one account contact (name, labels, profile URL, language and
 * history). The contact row stays, so thread links and suppressions keep their meaning.
 */
export async function eraseSocialContact(
  s: Pick<SocialServiceInternals, "put">,
  contact: SocialContact,
): Promise<SocialContact> {
  const erased: SocialContact = { ...contact, name: "Deleted contact", tags: [], history: [] };
  delete erased.profileUrl;
  delete erased.language;
  await s.put("contact", erased.id, erased);
  return erased;
}
