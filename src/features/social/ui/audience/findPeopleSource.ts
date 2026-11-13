/** Turns the Find people form into a capture source. Pure: no Host call, no React. */
import { t } from "../../../../shared/i18n";
import type { CaptureSource } from "../../model/audience";

export type CaptureSourceKind = CaptureSource["kind"];

export type FindPeopleForm = {
  kind: CaptureSourceKind;
  accountId: string;
  /** Optional post link or id for the post-based sources. */
  postRef: string;
  /** Keyword or hashtag text. */
  query: string;
  /** Handle of the other account for "commenters on an account's posts". */
  handle: string;
};

export function emptyFindPeopleForm(accountId = ""): FindPeopleForm {
  return { kind: "own_post_comments", accountId, postRef: "", query: "", handle: "" };
}

/** The form state that would build `source`, so an existing rule can be edited in the same form. */
export function formFromSource(source: CaptureSource): FindPeopleForm {
  const form = emptyFindPeopleForm(source.accountId);
  form.kind = source.kind;
  if ("postRef" in source && source.postRef) form.postRef = source.postRef;
  if ("query" in source) form.query = source.query;
  if ("handle" in source) form.handle = source.handle;
  return form;
}

export function captureSourceLabel(kind: CaptureSourceKind): string {
  switch (kind) {
    case "own_post_comments":
      return t("People who commented on my posts");
    case "own_post_likes":
      return t("People who liked my posts");
    case "own_post_shares":
      return t("People who shared my posts");
    case "mentions":
      return t("People who mentioned me");
    case "dm_senders":
      return t("People who messaged me");
    case "followers":
      return t("My followers");
    case "keyword":
      return t("Keyword search");
    case "hashtag":
      return t("Hashtag");
    case "account_commenters":
      return t("Commenters on another account's posts");
  }
}

export const FIND_PEOPLE_KINDS: readonly CaptureSourceKind[] = [
  "own_post_comments",
  "own_post_likes",
  "own_post_shares",
  "mentions",
  "dm_senders",
  "followers",
  "keyword",
  "hashtag",
  "account_commenters",
];

/** Which extra field a source kind needs. */
export function findPeopleNeeds(kind: CaptureSourceKind): "none" | "postRef" | "query" | "handle" {
  switch (kind) {
    case "keyword":
    case "hashtag":
      return "query";
    case "account_commenters":
      return "handle";
    case "own_post_comments":
    case "own_post_likes":
    case "own_post_shares":
      return "postRef";
    default:
      return "none";
  }
}

export type FindPeopleSourceResult = { source: CaptureSource } | { error: string };

export function buildFindPeopleSource(form: FindPeopleForm): FindPeopleSourceResult {
  if (!form.accountId) return { error: t("Choose an account.") };
  const postRef = form.postRef.trim() || undefined;
  switch (form.kind) {
    case "keyword":
    case "hashtag": {
      const query = form.query.trim().replace(/^#/, "");
      if (!query) return { error: t("Enter a keyword or hashtag.") };
      return { source: { kind: form.kind, accountId: form.accountId, query } };
    }
    case "account_commenters": {
      const handle = form.handle.trim().replace(/^@/, "");
      if (!handle) return { error: t("Enter the account handle.") };
      return { source: { kind: "account_commenters", accountId: form.accountId, handle } };
    }
    case "own_post_comments":
    case "own_post_likes":
    case "own_post_shares":
      return { source: { kind: form.kind, accountId: form.accountId, postRef } };
    default:
      return { source: { kind: form.kind, accountId: form.accountId } };
  }
}
