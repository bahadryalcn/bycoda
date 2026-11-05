import { t } from "../../../shared/i18n";
import type { SocialAccount } from "./social";
import type { PlanAgentState } from "./publishingPlanForm";
import {
  CONTACT_TAG_MAX_LENGTH,
  CONTACT_TAG_REQUEST_MAX,
  CONTACT_TAGS_MAX,
  type ContactTagInput,
  type ContactTagResult,
} from "./socialSuggestions";

/**
 * One contact the owner wants labelled: a parsed import row (not saved yet) or a saved contact.
 * `ref` is the row number or the contact id and comes back unchanged in the Host's answer.
 */
export type ContactTagSubject = {
  ref: string;
  accountId: string;
  platformId: string;
  projectIds: string[];
  name: string;
  profileUrl?: string;
  language?: string;
  tags: string[];
};

/** The Host labels one account and one project per request. */
export type ContactTagScope = {
  key: string;
  accountId: string;
  projectId: string;
  refs: string[];
};

/** Account/project pairs present in the subjects, largest first; the owner picks one per ask. */
export function contactTagScopes(
  subjects: readonly ContactTagSubject[],
  accessibleProjectIds: readonly string[],
): ContactTagScope[] {
  const scopes = new Map<string, ContactTagScope>();
  for (const subject of subjects)
    for (const projectId of subject.projectIds) {
      if (!accessibleProjectIds.includes(projectId)) continue;
      const key = `${subject.accountId}\u001f${projectId}`;
      const scope = scopes.get(key) ?? {
        key,
        accountId: subject.accountId,
        projectId,
        refs: [],
      };
      scope.refs.push(subject.ref);
      scopes.set(key, scope);
    }
  return [...scopes.values()].sort((a, b) => b.refs.length - a.refs.length);
}

/** The refs one request carries: the Host takes at most CONTACT_TAG_REQUEST_MAX. */
export const contactTagRequestRefs = (scope: ContactTagScope) =>
  scope.refs.slice(0, CONTACT_TAG_REQUEST_MAX);

export function contactTagInput(
  mode: "import" | "contacts",
  scope: ContactTagScope,
  subjects: readonly ContactTagSubject[],
  instructions: string,
): ContactTagInput {
  const refs = contactTagRequestRefs(scope);
  const chosen = refs
    .map((ref) => subjects.find((subject) => subject.ref === ref))
    .filter((subject): subject is ContactTagSubject => !!subject);
  const text = instructions.trim();
  return {
    accountId: scope.accountId,
    projectId: scope.projectId,
    ...(mode === "contacts"
      ? { contactIds: chosen.map((subject) => subject.ref) }
      : {
          rows: chosen.map((subject) => ({
            ref: subject.ref,
            name: subject.name,
            platformId: subject.platformId,
            ...(subject.profileUrl ? { profileUrl: subject.profileUrl } : {}),
            ...(subject.language ? { language: subject.language } : {}),
            tags: subject.tags.slice(0, CONTACT_TAGS_MAX),
          })),
        }),
    ...(text ? { instructions: text } : {}),
  };
}

/** Why the ask is disabled; empty when it can go ahead. */
export function contactTagBlockedReason(input: {
  hostOnline: boolean;
  account?: Pick<SocialAccount, "grants">;
  projectId: string;
  agent: PlanAgentState;
  count: number;
}): string {
  if (!input.hostOnline) return t("The computer is offline.");
  if (!input.account || !input.projectId) return t("Choose an account and project to label.");
  if (!input.account.grants[input.projectId]?.includes("draft"))
    return t("Grant this account draft access to the project in Accounts first.");
  if (!input.count) return t("Choose at least one contact.");
  if (input.agent === "missing") return t("Choose a text agent in Settings first.");
  return "";
}

/** One suggested tag as the owner edits it: nothing is applied until it is kept and valid. */
export type TagEdit = { use: boolean; text: string };
export type TagReviewState = Record<string, TagEdit[]>;

export const initialTagReview = (result: ContactTagResult): TagReviewState =>
  Object.fromEntries(
    result.proposals.map((proposal) => [
      proposal.ref,
      proposal.tags.map((entry) => ({ use: false, text: entry.tag })),
    ]),
  );

const fold = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** What is wrong with one edited tag; empty when it is fine to keep. */
export function tagIssue(currentTags: readonly string[], edits: readonly TagEdit[], index: number) {
  const text = edits[index].text.trim().replace(/\s+/g, " ");
  if (!text) return t("Enter a tag.");
  if (text.length > CONTACT_TAG_MAX_LENGTH)
    return t("A tag can be at most {p0} characters.", { p0: CONTACT_TAG_MAX_LENGTH });
  if (currentTags.some((tag) => fold(tag) === fold(text)))
    return t("The contact already has this tag.");
  if (edits.some((edit, other) => other < index && edit.use && fold(edit.text) === fold(text)))
    return t("This tag is already kept for this contact.");
  // Earlier kept tags win the room that is left; later ones are the ones that no longer fit.
  const kept = edits.filter((edit, other) => other < index && edit.use).length + 1;
  if (currentTags.length + kept > CONTACT_TAGS_MAX)
    return t("A contact can have at most {p0} tags.", { p0: CONTACT_TAGS_MAX });
  return "";
}

/** The tags the owner chose per contact, trimmed, in order; invalid or unused edits are left out. */
export function keptTags(
  result: ContactTagResult,
  review: TagReviewState,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const proposal of result.proposals) {
    const edits = review[proposal.ref] ?? [];
    const kept = edits
      .map((edit, index) => ({ edit, index }))
      .filter(({ edit, index }) => edit.use && !tagIssue(proposal.currentTags, edits, index))
      .map(({ edit }) => edit.text.trim().replace(/\s+/g, " "));
    if (kept.length) out[proposal.ref] = kept;
  }
  return out;
}

export const keptTagCount = (kept: Record<string, string[]>) =>
  Object.values(kept).reduce((sum, tags) => sum + tags.length, 0);

/** Marks every suggestion that is valid right now as kept (the owner can still untick any). */
export function keepAllValid(result: ContactTagResult, review: TagReviewState): TagReviewState {
  const next: TagReviewState = {};
  for (const proposal of result.proposals) {
    const edits = (review[proposal.ref] ?? []).map((edit) => ({ ...edit, use: false }));
    for (let index = 0; index < edits.length; index++) {
      edits[index] = { ...edits[index], use: true };
      if (tagIssue(proposal.currentTags, edits, index))
        edits[index] = { ...edits[index], use: false };
    }
    next[proposal.ref] = edits;
  }
  return next;
}

/** Appends the kept tags to a tag list without repeating one (case-insensitive). */
export function mergeTags(current: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(current.map(fold));
  const merged = [...current];
  for (const tag of added) {
    if (seen.has(fold(tag))) continue;
    seen.add(fold(tag));
    merged.push(tag);
  }
  return merged;
}
