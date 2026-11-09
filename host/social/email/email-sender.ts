import type { EmailAccount } from "../../../src/features/social/model/outreach";
import type { SmtpCredentials } from "./smtp-sender";
import { sendSmtp, verifySmtp } from "./smtp-sender";
import { sendResend, verifyResend } from "./resend-sender";
import { sendPostmark, verifyPostmark } from "./postmark-sender";
import type { EmailDeps, EmailMessage, EmailSecret, EmailSendResult } from "./email-types";

/** Parses a stored secret for the account's provider. Unknown fields are dropped. */
export function parseEmailSecret(kind: EmailAccount["kind"], raw: string): EmailSecret {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Email credentials are invalid. Save them again.");
  }
  if (kind === "smtp") {
    if (
      typeof value.user !== "string" ||
      typeof value.pass !== "string" ||
      !value.user ||
      !value.pass
    )
      throw new Error("Email credentials are invalid. Save them again.");
    return { user: value.user, pass: value.pass };
  }
  if (typeof value.apiKey !== "string" || !value.apiKey)
    throw new Error("Email credentials are invalid. Save them again.");
  return { apiKey: value.apiKey };
}

function smtpCredentials(secret: EmailSecret): SmtpCredentials {
  if (!("user" in secret)) throw new Error("Email credentials do not match this provider.");
  return secret;
}

function apiKey(secret: EmailSecret): string {
  if (!("apiKey" in secret)) throw new Error("Email credentials do not match this provider.");
  return secret.apiKey;
}

/** Sends one fully built message through the account's provider. */
export async function deliverEmail(
  account: EmailAccount,
  secret: EmailSecret,
  message: EmailMessage,
  deps: EmailDeps = {},
): Promise<EmailSendResult> {
  if (account.kind === "smtp")
    return await sendSmtp(account, smtpCredentials(secret), message, deps.smtp);
  if (account.kind === "resend") return await sendResend(apiKey(secret), message, deps.fetcher);
  return await sendPostmark(apiKey(secret), message, deps.fetcher);
}

/** Checks the stored credentials with a read-only provider call. Sends nothing. */
export async function verifyEmailAccount(
  account: EmailAccount,
  secret: EmailSecret,
  deps: EmailDeps = {},
): Promise<void> {
  if (account.kind === "smtp") return await verifySmtp(account, smtpCredentials(secret), deps.smtp);
  if (account.kind === "resend") return await verifyResend(apiKey(secret), deps.fetcher);
  return await verifyPostmark(apiKey(secret), deps.fetcher);
}
