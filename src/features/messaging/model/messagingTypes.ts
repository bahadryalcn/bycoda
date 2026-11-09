/** Mirrors `src-tauri/src/messaging/types.rs`. Secrets never appear in these shapes. */
export type MessagingProvider = "email" | "slack" | "discord" | "teams";

export type EmailPreset = "gmail" | "outlook" | "yahoo" | "icloud" | "custom";
export type MailSecurity = "tls" | "starttls";

export type EmailAuth = "password" | "google" | "microsoft";

export type EmailConfig = {
  preset: EmailPreset;
  address: string;
  displayName: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  auth: EmailAuth;
  clientId?: string;
};

export type SlackConfig = Record<string, never>;
export type DiscordConfig = { channelIds: string[] };
export type TeamsConfig = { clientId?: string; tenant: string };

export type MessagingAccount = {
  id: string;
  provider: MessagingProvider;
  label: string;
  /** Verified address, workspace or user name. */
  identity: string;
  config: Record<string, unknown>;
  /** Stored credentials exist; not a live connectivity check. */
  connected: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SaveMessagingAccountInput = {
  id?: string;
  provider: MessagingProvider;
  label?: string;
  config: Record<string, unknown>;
  /** Provider secret fields such as `password` or `botToken`. Empty values keep the stored one. */
  secret?: Record<string, string>;
  /** Handle from a finished Microsoft device sign-in or browser sign-in. */
  authHandle?: string;
};

export type MessageThread = {
  id: string;
  accountId: string;
  provider: MessagingProvider;
  title: string;
  participants: string[];
  preview: string;
  updatedAt: number;
  unread: boolean;
  url?: string;
};

export type MessageAttachment = { name: string; size?: number };

export type ThreadMessage = {
  id: string;
  threadId: string;
  author: string;
  authorAddress?: string;
  /** Plain text. */
  body: string;
  at: number;
  outbound: boolean;
  attachments: MessageAttachment[];
};

export type MicrosoftDevicePurpose = "teams" | "outlook";

export type MicrosoftDeviceStart = {
  handle: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
};

export type MicrosoftDevicePoll = {
  status: "pending" | "done" | "expired" | "denied";
  error?: string;
};

/** Browser sign-in (authorization code + PKCE over a loopback redirect). */
export type BrowserSignInPurpose = "google" | "slack";

export type BrowserSignInStart = {
  handle: string;
  /** The UI opens this in the browser; native code does not. */
  authorizeUrl: string;
  /** Seconds. */
  expiresIn: number;
};

export type BrowserSignInPoll = {
  status: "pending" | "done" | "denied" | "expired" | "failed";
  error?: string;
  /** Signed-in Google address or Slack workspace name, once done. */
  identity?: string;
};
