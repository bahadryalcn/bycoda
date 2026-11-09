import * as nodemailer from "nodemailer";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import { sanitizeSocialError } from "../core/social-helpers";
import type { EmailMessage, EmailSecret, EmailSendResult } from "./email-types";

export type SmtpCredentials = Extract<EmailSecret, { user: string }>;

/** The part of a nodemailer transporter this module uses; tests replace the factory. */
export type SmtpTransport = {
  sendMail(message: EmailMessage): Promise<{ messageId?: string }>;
  verify(): Promise<unknown>;
  close(): void;
};
export type SmtpTransportFactory = (
  account: EmailAccount,
  credentials: SmtpCredentials,
) => SmtpTransport;

export function createSmtpTransport(
  account: EmailAccount,
  credentials: SmtpCredentials,
): SmtpTransport {
  if (!account.host || !account.port) throw new Error("SMTP host and port are required.");
  const transport = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure ?? account.port === 465,
    auth: { user: credentials.user, pass: credentials.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    sendMail: (message) => transport.sendMail(message),
    verify: () => transport.verify(),
    close: () => transport.close(),
  };
}

/** SMTP authentication codes (534, 535) mean the stored credentials are no longer accepted. */
function smtpFailure(error: unknown): SocialPlatformError {
  console.error("Social email SMTP request failed:", sanitizeSocialError(error));
  const code = (error as { responseCode?: unknown }).responseCode;
  if (code === 534 || code === 535) return new SocialPlatformError("expired");
  // Any other failure may follow an accepted DATA phase, so the caller must not resend.
  return new SocialPlatformError("unknown");
}

export async function sendSmtp(
  account: EmailAccount,
  credentials: SmtpCredentials,
  message: EmailMessage,
  factory: SmtpTransportFactory = createSmtpTransport,
): Promise<EmailSendResult> {
  const transport = factory(account, credentials);
  try {
    const info = await transport.sendMail(message);
    return info.messageId ? { messageId: info.messageId } : {};
  } catch (error) {
    throw smtpFailure(error);
  } finally {
    transport.close();
  }
}

export async function verifySmtp(
  account: EmailAccount,
  credentials: SmtpCredentials,
  factory: SmtpTransportFactory = createSmtpTransport,
): Promise<void> {
  const transport = factory(account, credentials);
  try {
    await transport.verify();
  } catch (error) {
    throw smtpFailure(error);
  } finally {
    transport.close();
  }
}
