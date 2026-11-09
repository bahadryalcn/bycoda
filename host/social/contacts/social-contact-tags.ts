import type { SocialContact, SocialSegment } from "../../../src/features/social/model/social";
import {
  CONTACT_TAG_REQUEST_MAX,
  type ContactTagResult,
} from "../../../src/features/social/model/socialSuggestions";
import { array, exact, str } from "../core/social-helpers";
import type { SocialServiceInternals } from "../core/social-internals";
import type { SocialPrincipal } from "../social";
import {
  askSuggestionModel,
  contactTagPrompt,
  type ContactTagSubject,
  contactTagVocabulary,
  requireTextAgent,
  suggestionInstructions,
  validateContactTagAnswer,
} from "../social-suggestions";

/**
 * AI label proposals for import rows or saved contacts of one account and project. It reads the
 * store for scope checks and existing labels, writes nothing and never touches consent,
 * eligibility or opt-out; the owner applies accepted labels through contacts.import / upsert.
 */
export async function suggestSocialContactTags(
  s: SocialServiceInternals,
  p: SocialPrincipal,
  input: Record<string, unknown>,
): Promise<ContactTagResult> {
  s.owner(p);
  exact(input, ["accountId", "projectId", "contactIds", "rows", "instructions"]);
  const accountId = str(input.accountId, "account");
  const account = await s.access(p, accountId, "draft");
  const projectId = str(input.projectId, "project");
  await s.project(p, projectId);
  if (!account.grants[projectId]?.includes("draft"))
    throw new Error("Grant this account's draft permission for the project first.");
  if ((input.contactIds === undefined) === (input.rows === undefined))
    throw new Error("Choose either saved contacts or import rows.");
  const instructions = suggestionInstructions(input.instructions);
  const projectContacts = (await s.list<SocialContact>("contact")).filter((contact) =>
    contact.projectIds.includes(projectId),
  );
  const subjects: ContactTagSubject[] = [];
  if (input.contactIds !== undefined) {
    const ids = array(input.contactIds, "contacts", CONTACT_TAG_REQUEST_MAX);
    if (!ids.length) throw new Error("Choose at least one contact.");
    for (const id of ids) {
      const contact = projectContacts.find((item) => item.id === id);
      if (!contact || contact.accountId !== accountId)
        throw new Error("Choose contacts of this account and project.");
      subjects.push({
        ref: contact.id,
        key: `c${subjects.length + 1}`,
        name: contact.name.slice(0, 300),
        handle: contact.platformId.slice(0, 300),
        ...(contact.profileUrl ? { profileUrl: contact.profileUrl.slice(0, 2048) } : {}),
        ...(contact.language ? { language: contact.language.slice(0, 30) } : {}),
        tags: contact.tags,
      });
    }
  } else {
    if (
      !Array.isArray(input.rows) ||
      !input.rows.length ||
      input.rows.length > CONTACT_TAG_REQUEST_MAX
    )
      throw new Error(`Send 1–${CONTACT_TAG_REQUEST_MAX} contacts to label.`);
    const refs = new Set<string>();
    for (const raw of input.rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Invalid contact row.");
      const row = raw as Record<string, unknown>;
      exact(row, ["ref", "name", "platformId", "profileUrl", "language", "tags"]);
      const ref = str(row.ref, "row reference", 100);
      if (refs.has(ref)) throw new Error("Row references must be unique.");
      refs.add(ref);
      subjects.push({
        ref,
        key: `c${subjects.length + 1}`,
        name: str(row.name, "contact name", 300),
        ...(row.platformId !== undefined
          ? { handle: str(row.platformId, "platform identity", 300) }
          : {}),
        ...(row.profileUrl !== undefined
          ? { profileUrl: str(row.profileUrl, "profile URL", 2048) }
          : {}),
        ...(row.language !== undefined ? { language: str(row.language, "language", 30) } : {}),
        tags: array(row.tags ?? [], "explicit labels", 30),
      });
    }
  }
  const segments = (await s.list<SocialSegment>("segment")).filter((segment) =>
    segment.projectIds.includes(projectId),
  );
  const vocabulary = contactTagVocabulary(
    [...projectContacts.map((contact) => contact.tags), ...subjects.map((subject) => subject.tags)],
    segments,
  );
  const policy = await s.policy(account);
  const model = requireTextAgent(policy.agent, s.generateText);
  const answer = await askSuggestionModel(
    model,
    contactTagPrompt({ platform: account.platform, subjects, vocabulary, instructions }),
    "contact labels",
  );
  return {
    accountId,
    projectId,
    ...validateContactTagAnswer(answer, subjects, vocabulary, segments),
    agent: model.agent,
    draftOnly: true,
  };
}
