import type { EmailAccount } from "../../../src/features/social/model/outreach";
import type { SmtpTransportFactory } from "./smtp-sender";

/** Provider credentials. Stored only in the vault under emailSecretRef(account.id), never in EmailAccount. */
export type EmailSecret = { apiKey: string } | { user: string; pass: string };

/** A fully built message. `html` and `text` already contain the visible unsubscribe link. */
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Always contains List-Unsubscribe (see email-message.ts). */
  headers: Record<string, string>;
  /** Forwarded to providers that accept idempotency keys (Resend). */
  idempotencyKey?: string;
};

export type EmailSendResult = { messageId?: string };

/** Test seams. Production code passes nothing and gets global fetch and nodemailer. */
export type EmailDeps = {
  fetcher?: typeof fetch;
  smtp?: SmtpTransportFactory;
};

export type EmailKind = EmailAccount["kind"];
