import type { SecretValueStore } from "../../secrets/secret-store";
import type { EmailAccount } from "../../../src/features/social/model/outreach";
import type { EmailSecret } from "./email-types";
import { parseEmailSecret } from "./email-sender";

/** Thrown when the host has no vault for email credentials; callers retry later, never fail the step. */
export class EmailCredentialsUnavailable extends Error {
  constructor() {
    super("Email credentials are not available on this host.");
  }
}

export function emailSecretRef(accountId: string): string {
  return `outreach-email.${accountId}`;
}

/** Reads and parses the vault entry of one account. */
export async function readEmailSecret(
  secrets: SecretValueStore | undefined,
  account: EmailAccount,
): Promise<EmailSecret> {
  if (!secrets) throw new EmailCredentialsUnavailable();
  const raw = await secrets.get(emailSecretRef(account.id));
  if (!raw) throw new Error("Email credentials are missing. Save them again.");
  return parseEmailSecret(account.kind, raw);
}
