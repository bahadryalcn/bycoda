import type { EmailAccount } from "../../../src/features/social/model/outreach";
import type { SocialPerson } from "../../../src/features/social/model/audience";
import type { EmailMessage } from "./email-types";

const ADDRESS = /^[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+\.[^\s@<>,;:"'()[\]]+$/u;
const SUBJECT_MAX = 200;
const BODY_MAX = 20_000;

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS.test(value);
}

/** The verified address when there is one, otherwise the first address on the person. */
export function emailAddressFor(person: SocialPerson): string | undefined {
  return (person.emails.find((email) => email.verified) ?? person.emails[0])?.address;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds a message that always carries a visible unsubscribe link and a List-Unsubscribe header.
 * Refuses to build without an HTTPS unsubscribe link, so no unsubscribe-less email can be sent.
 */
export function buildOutreachEmail(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
  idempotencyKey?: string,
): EmailMessage {
  if (!account.unsubscribeUrl)
    throw new Error("Add an unsubscribe link to this email account before sending.");
  const unsubscribe = new URL(account.unsubscribeUrl);
  if (unsubscribe.protocol !== "https:" || unsubscribe.username || unsubscribe.password)
    throw new Error("The unsubscribe link must be an HTTPS address without credentials.");
  if (!isEmailAddress(account.from)) throw new Error("The sender address is invalid.");
  if (!isEmailAddress(to)) throw new Error("The recipient address is invalid.");
  const cleanSubject = subject.trim();
  if (!cleanSubject || cleanSubject.length > SUBJECT_MAX || /[\r\n]/.test(cleanSubject))
    throw new Error(`Subject must be 1-${SUBJECT_MAX} characters on one line.`);
  const cleanBody = body.trim();
  if (!cleanBody || cleanBody.length > BODY_MAX)
    throw new Error(`Body must be 1-${BODY_MAX} characters.`);
  const link = unsubscribe.toString();
  const escapedLink = escapeHtml(link);
  return {
    from: account.from,
    to,
    subject: cleanSubject,
    text: `${cleanBody}\n\n--\nTo stop receiving these emails, unsubscribe: ${link}`,
    html: `<div>${escapeHtml(cleanBody).replace(/\n/g, "<br>")}</div><p><a href="${escapedLink}">Unsubscribe</a></p>`,
    headers: { "List-Unsubscribe": `<${link}>` },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}
