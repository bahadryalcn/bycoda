/** Outreach model: sequences, enrollments, suppressions and email accounts. React-free. */
import type { SocialPlatform } from "./social";

export type OutreachChannel = "dm" | "comment" | "mention" | "email" | "whatsapp" | "telegram";

export type SequenceStep = {
  id: string;
  channel: OutreachChannel;
  /** Email steps only: the email account that sends the step. */
  accountId?: string;
  delayHours: number;
  template: string;
  variants?: { id: string; text: string }[];
  personalize: boolean;
};

export type Sequence = {
  id: string;
  name: string;
  listId: string;
  steps: SequenceStep[];
  status: "draft" | "active" | "paused" | "done";
  /** A reply always ends the sequence for that person. */
  stopOnReply: true;
  pacing: { perHour: number; perDay: number; warmupDays: number };
  createdAt: number;
};

export type SequenceEnrollment = {
  id: string;
  sequenceId: string;
  personId: string;
  stepIndex: number;
  status: "active" | "replied" | "stopped" | "done" | "suppressed" | "failed";
  nextAt?: number;
  variantId?: string;
  lastJobId?: string;
  updatedAt: number;
};

/** Opt-out, bounce, complaint or deletion tombstone. Checked before every outbound send. */
export type Suppression = {
  id: string;
  personId?: string;
  handle?: { platform: SocialPlatform; platformId: string };
  email?: string;
  channel: "all" | OutreachChannel;
  reason: "opt_out" | "manual" | "bounce" | "complaint" | "deleted";
  source: string;
  at: number;
};

/** SMTP or HTTP provider credentials are stored in the vault, never in this record. */
export type EmailAccount = {
  id: string;
  kind: "smtp" | "resend" | "postmark";
  from: string;
  name: string;
  host?: string;
  port?: number;
  secure?: boolean;
  unsubscribeUrl?: string;
  createdAt: number;
};
