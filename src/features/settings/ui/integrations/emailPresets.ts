import { t } from "../../../../shared/i18n";
import type {
  EmailAuth,
  EmailPreset,
  MailSecurity,
  MessagingAccount,
  SaveMessagingAccountInput,
} from "../../../messaging";

type ServerDefaults = {
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
};

/** Server defaults per preset. */
export const EMAIL_PRESETS: Record<EmailPreset, ServerDefaults> = {
  gmail: {
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "tls",
  },
  outlook: {
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
  },
  yahoo: {
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecurity: "tls",
  },
  icloud: {
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
  },
  custom: {
    imapHost: "",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "",
    smtpPort: 587,
    smtpSecurity: "starttls",
  },
};

export const EMAIL_PRESET_IDS = Object.keys(EMAIL_PRESETS) as EmailPreset[];

/**
 * Presets not offered for new accounts. Outlook needs Microsoft sign-in, which has no app
 * registration yet, and Outlook.com refuses IMAP passwords. Remove an id to offer it again.
 */
const PAUSED_EMAIL_PRESETS: readonly EmailPreset[] = ["outlook"];

/** Picker choices; a saved account keeps its own preset even when that preset is paused. */
export const emailPresetChoices = (saved?: EmailPreset): EmailPreset[] =>
  EMAIL_PRESET_IDS.filter((id) => id === saved || !PAUSED_EMAIL_PRESETS.includes(id));

export function emailPresetLabel(preset: EmailPreset): string {
  if (preset === "gmail") return "Gmail";
  if (preset === "outlook") return "Outlook / Hotmail";
  if (preset === "yahoo") return "Yahoo";
  if (preset === "icloud") return "iCloud";
  return t("Other IMAP/SMTP");
}

/** Default sign-in per preset: Gmail signs in with Google, Outlook/Hotmail with Microsoft. */
export const emailAuthFor = (preset: EmailPreset): EmailAuth =>
  preset === "gmail" ? "google" : preset === "outlook" ? "microsoft" : "password";

const EMAIL_AUTHS: readonly EmailAuth[] = ["password", "google", "microsoft"];

/** Where each provider that refuses the account password under 2-step verification issues app passwords. */
export const APP_PASSWORD_PAGES: Partial<Record<EmailPreset, string>> = {
  gmail: "https://myaccount.google.com/apppasswords",
  yahoo: "https://login.yahoo.com/account/security",
  icloud: "https://account.apple.com/account/manage",
};

/** Editable form state. Ports stay text so a half-typed value is not coerced. */
export type EmailDraft = {
  preset: EmailPreset;
  address: string;
  displayName: string;
  username: string;
  auth: EmailAuth;
  /** Empty on edit keeps the stored password. */
  password: string;
  imapHost: string;
  imapPort: string;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: MailSecurity;
  /** App registration of the sign-in provider (Google or Microsoft); unused for passwords. */
  clientId: string;
};

function serverFields(defaults: ServerDefaults) {
  return {
    imapHost: defaults.imapHost,
    imapPort: String(defaults.imapPort),
    imapSecurity: defaults.imapSecurity,
    smtpHost: defaults.smtpHost,
    smtpPort: String(defaults.smtpPort),
    smtpSecurity: defaults.smtpSecurity,
  };
}

/**
 * Switching preset fills its servers and default sign-in; Other keeps what the owner already
 * typed. A client ID belongs to one sign-in provider, so it is cleared when that changes.
 */
export function applyEmailPreset(draft: EmailDraft, preset: EmailPreset): EmailDraft {
  const auth = emailAuthFor(preset);
  const signIn = { auth, clientId: auth === draft.auth ? draft.clientId : "" };
  if (preset === "custom") return { ...draft, preset, ...signIn };
  return { ...draft, preset, ...signIn, ...serverFields(EMAIL_PRESETS[preset]) };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const security = (value: unknown, fallback: MailSecurity): MailSecurity =>
  value === "tls" || value === "starttls" ? value : fallback;
const port = (value: unknown, fallback: number) =>
  String(typeof value === "number" && Number.isInteger(value) ? value : fallback);

export function emailDraftFromAccount(account?: MessagingAccount | null): EmailDraft {
  const config = account?.config ?? {};
  const preset = EMAIL_PRESET_IDS.find((id) => id === config.preset) ?? "gmail";
  const defaults = EMAIL_PRESETS[preset];
  if (!account) {
    return {
      preset,
      auth: emailAuthFor(preset),
      address: "",
      displayName: "",
      username: "",
      password: "",
      clientId: "",
      ...serverFields(defaults),
    };
  }
  return {
    preset,
    auth: EMAIL_AUTHS.find((auth) => auth === config.auth) ?? emailAuthFor(preset),
    address: text(config.address) || account.identity,
    displayName: text(config.displayName),
    username: text(config.username),
    password: "",
    imapHost: text(config.imapHost) || defaults.imapHost,
    imapPort: port(config.imapPort, defaults.imapPort),
    imapSecurity: security(config.imapSecurity, defaults.imapSecurity),
    smtpHost: text(config.smtpHost) || defaults.smtpHost,
    smtpPort: port(config.smtpPort, defaults.smtpPort),
    smtpSecurity: security(config.smtpSecurity, defaults.smtpSecurity),
    clientId: text(config.clientId),
  };
}

function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
}

export type SaveInputResult =
  | { ok: true; input: SaveMessagingAccountInput }
  | { ok: false; error: string };

/**
 * Maps the form to the native save input. Native validates and tests before saving; this only
 * rejects drafts that cannot work. An empty password on edit sends no secret, keeping the stored one;
 * without a new sign-in an edit keeps the stored Google or Microsoft tokens.
 */
export function emailSaveInput(
  draft: EmailDraft,
  { id, authHandle }: { id?: string; authHandle?: string } = {},
): SaveInputResult {
  const address = draft.address.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(address))
    return { ok: false, error: t("Enter a valid email address.") };
  const imapPort = parsePort(draft.imapPort);
  const smtpPort = parsePort(draft.smtpPort);
  if (!draft.imapHost.trim() || !draft.smtpHost.trim())
    return { ok: false, error: t("Enter the incoming and outgoing mail servers.") };
  if (imapPort === null || smtpPort === null)
    return { ok: false, error: t("Server ports must be numbers from 1 to 65535.") };
  const { auth } = draft;
  if (auth === "password" && !id && draft.password === "")
    return { ok: false, error: t("Enter the password or app password.") };
  if (auth === "microsoft" && !id && !authHandle)
    return { ok: false, error: t("Sign in with Microsoft first.") };
  if (auth === "google" && !id && !authHandle)
    return { ok: false, error: t("Sign in with Google first.") };
  const clientId = draft.clientId.trim();
  const input: SaveMessagingAccountInput = {
    provider: "email",
    label: address,
    config: {
      preset: draft.preset,
      address,
      displayName: draft.displayName.trim(),
      username: draft.username.trim() || address,
      imapHost: draft.imapHost.trim(),
      imapPort,
      imapSecurity: draft.imapSecurity,
      smtpHost: draft.smtpHost.trim(),
      smtpPort,
      smtpSecurity: draft.smtpSecurity,
      auth,
      ...(auth !== "password" && clientId ? { clientId } : {}),
    },
  };
  if (id) input.id = id;
  if (auth === "password" && draft.password !== "") input.secret = { password: draft.password };
  if (auth !== "password" && authHandle) input.authHandle = authHandle;
  return { ok: true, input };
}
