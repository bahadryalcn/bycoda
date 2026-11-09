import {
  AccountApiError,
  SupportTicketCreate,
  type AccountClient,
} from "@bycoda/account-contracts";

export const SUPPORT_CATEGORIES = ["bug", "feature", "account", "privacy", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Limits of the contract (`SupportTicketCreate`). */
export const SUPPORT_SUBJECT_MAX = 200;
export const SUPPORT_BODY_MAX = 5000;

export type SupportDraft = { subject: string; body: string; category: SupportCategory };
export const EMPTY_SUPPORT_DRAFT: SupportDraft = { subject: "", body: "", category: "bug" };

export type SupportDraftIssue = "subject-missing" | "subject-long" | "body-missing" | "body-long";

/** What is wrong with the draft, checked against the same limits the contract enforces. */
export function validateSupportDraft(draft: SupportDraft): SupportDraftIssue[] {
  const issues: SupportDraftIssue[] = [];
  const subject = draft.subject.trim().length;
  const body = draft.body.trim().length;
  if (subject === 0) issues.push("subject-missing");
  else if (subject > SUPPORT_SUBJECT_MAX) issues.push("subject-long");
  if (body === 0) issues.push("body-missing");
  else if (body > SUPPORT_BODY_MAX) issues.push("body-long");
  return issues;
}

export type SupportSubmitResult =
  | { status: "sent"; reference: string }
  | { status: "invalid"; issues: SupportDraftIssue[] }
  | { status: "rate-limited" }
  | { status: "failed" };

/**
 * Sends the user's own words and nothing else. Every non-sent result leaves the draft with the
 * caller, so a rate limit or a lost connection never costs the typed message.
 */
export async function submitSupportTicket(
  api: Pick<AccountClient, "createSupportTicket">,
  draft: SupportDraft,
  onFailure?: (error: unknown) => unknown,
): Promise<SupportSubmitResult> {
  const issues = validateSupportDraft(draft);
  if (issues.length > 0) return { status: "invalid", issues };
  const body = SupportTicketCreate.safeParse({
    subject: draft.subject,
    body: draft.body,
    category: draft.category,
  });
  if (!body.success) return { status: "failed" };
  try {
    const receipt = await api.createSupportTicket({ body: body.data });
    return { status: "sent", reference: receipt.id };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "rate_limited") {
      return { status: "rate-limited" };
    }
    try {
      await onFailure?.(error);
    } catch {
      // -- the failure is already reported as `failed`; a second error adds nothing.
    }
    return { status: "failed" };
  }
}
