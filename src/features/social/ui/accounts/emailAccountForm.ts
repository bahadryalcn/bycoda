/** Validation of the email account form. Secrets are sent once and never kept in the form state. */
import { t } from "../../../../shared/i18n";
import type { EmailAccountSaveInput } from "../../model/socialActions";

export type EmailKind = "smtp" | "resend" | "postmark";

export type EmailDraft = {
  kind: EmailKind;
  from: string;
  name: string;
  host: string;
  port: string;
  secure: boolean;
  unsubscribeUrl: string;
  /** SMTP password or provider API key. Entered again whenever the provider changes. */
  secret: string;
};

export const EMAIL_KINDS: readonly EmailKind[] = ["smtp", "resend", "postmark"];

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The first problem with the form, in plain words, or undefined when it can be saved. Every
 * outbound email needs an HTTPS unsubscribe link (the Host refuses it otherwise).
 */
export function emailFormError(draft: EmailDraft, mode: "create" | "edit"): string | undefined {
  if (!draft.name.trim()) return t("Enter a name for this email account.");
  if (!ADDRESS.test(draft.from.trim())) return t("Enter the sender email address.");
  if (!draft.unsubscribeUrl.trim()) return t("Add an unsubscribe link before sending email.");
  if (!isHttpsUrl(draft.unsubscribeUrl)) return t("The unsubscribe link must start with https://.");
  if (mode === "create" && !draft.secret)
    return draft.kind === "smtp" ? t("Enter the SMTP password.") : t("Enter the provider API key.");
  if (draft.kind === "smtp") {
    if (!draft.host.trim()) return t("Enter the SMTP server.");
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return t("Enter a port between 1 and 65535.");
  }
  return undefined;
}

/** The `email.accounts.save` input for a valid draft. The secret is included only when entered. */
export function emailSaveInput(draft: EmailDraft, id?: string): EmailAccountSaveInput {
  const base = {
    ...(id ? { id } : {}),
    kind: draft.kind,
    from: draft.from.trim(),
    name: draft.name.trim(),
    unsubscribeUrl: draft.unsubscribeUrl.trim(),
    ...(draft.secret ? { secret: draft.secret } : {}),
  };
  return draft.kind === "smtp"
    ? {
        ...base,
        host: draft.host.trim(),
        port: Number(draft.port),
        secure: draft.secure,
      }
    : base;
}
