/**
 * Pure helpers for the Accounts & Settings screen: health, labels, validated numbers and the
 * autonomy form. React-free so they can be tested without rendering.
 */
import { t } from "../../../../shared/i18n";
import { dateTimeFormat } from "../../../../shared/lib/intl";
import type { AutonomyAction, AutonomyLevel, AutonomyPolicy } from "../../model/autonomy";
import type { Capability, SocialAccount } from "../../model/social";
import type { HealthStatus } from "../common/HealthDot";

export const AUTONOMY_ACTIONS: readonly AutonomyAction[] = [
  "publish",
  "reply",
  "comment",
  "message",
  "email",
  "outreach",
  "audience",
  "contacts",
];

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = ["suggest", "approve", "autonomous"];

export type AccountHealth = { status: HealthStatus; text: string };

/**
 * Health of one account as one dot. Expired access or an expired capability is an error; a
 * connection still being set up, a recognized screen that needs the owner, or a pending capability
 * is a warning; everything else is ok.
 */
export function accountHealth(input: {
  account: SocialAccount;
  capabilities: readonly Pick<Capability, "status">[];
  needsHuman: boolean;
  now: number;
}): AccountHealth {
  const { account, capabilities, needsHuman, now } = input;
  const expired = account.connected && account.expiresAt !== undefined && account.expiresAt < now;
  if (expired || capabilities.some((row) => row.status === "expired"))
    return { status: "error", text: t("Connection needed") };
  if (!account.connected) return { status: "warn", text: t("Connection needed") };
  if (needsHuman) return { status: "warn", text: t("Waiting for you") };
  if (capabilities.some((row) => row.status === "pending"))
    return { status: "warn", text: t("Checking…") };
  return { status: "ok", text: t("Connected") };
}

/** API or Browser. An account without a connection value uses the official API (OAuth). */
export function accountModeText(account: SocialAccount): string {
  return account.connection === "browser" ? t("Browser") : t("API");
}

/** "Post · Reply · DM" from the operations that are available now; empty when none of them is. */
export function capabilitySummary(
  capabilities: readonly Pick<Capability, "operation" | "status">[],
): string {
  const open = new Set(
    capabilities.filter((row) => row.status === "available").map((row) => row.operation),
  );
  const parts: string[] = [];
  if (open.has("publish")) parts.push(t("Post"));
  if (open.has("reply") || open.has("comment")) parts.push(t("Reply"));
  if (open.has("message.reply") || open.has("message.start")) parts.push(t("Messages"));
  return parts.join(" · ");
}

export function levelText(level: AutonomyLevel): string {
  switch (level) {
    case "suggest":
      return t("Suggest only");
    case "approve":
      return t("Approve each");
    case "autonomous":
      return t("Autonomous");
  }
}

/** Short action name for a row in the autonomy table. */
export function autonomyLabel(action: AutonomyAction): string {
  switch (action) {
    case "publish":
      return t("Publishing");
    case "reply":
      return t("Replies");
    case "comment":
      return t("Comments");
    case "message":
      return t("Direct messages");
    case "email":
      return t("Email");
    case "outreach":
      return t("Outreach");
    case "audience":
      return t("Audience collection");
    case "contacts":
      return t("Contact updates");
  }
}

export type WholeNumberResult = { ok: true; value?: number } | { ok: false; message: string };

/**
 * Parses an optional whole number. An empty field means "inherit" (value undefined). Anything
 * else must be a whole number inside [min, max]; the Host would refuse it, so the form does first.
 */
export function parseWholeNumber(
  raw: string,
  min: number,
  max: number,
  rangeMessage: string,
): WholeNumberResult {
  const text = raw.trim();
  if (!text) return { ok: true, value: undefined };
  if (!/^\d+$/.test(text)) return { ok: false, message: t("Enter a whole number.") };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    return { ok: false, message: rangeMessage };
  return { ok: true, value };
}

export function parseCharacterLimit(raw: string): WholeNumberResult {
  return parseWholeNumber(
    raw,
    1,
    20000,
    t("Character limits must be whole numbers between 1 and 20000; omit to inherit."),
  );
}

export function parseDailyLimit(raw: string): WholeNumberResult {
  return parseWholeNumber(
    raw,
    0,
    1000000,
    t("Daily limits must be whole numbers from 0 to 1000000."),
  );
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    dateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Plain sentence for an invalid working-hours form, or undefined when it can be saved. */
export function workingHoursError(hours: {
  timeZone: string;
  days: readonly number[];
  start: string;
  end: string;
}): string | undefined {
  if (!isValidTimeZone(hours.timeZone)) return t("Choose a valid time zone.");
  if (!hours.days.length) return t("Choose at least one day.");
  if (!TIME.test(hours.start) || !TIME.test(hours.end))
    return t("Use 24-hour times such as 09:00.");
  return undefined;
}

export function hasAutonomousLevel(
  levels: Partial<Record<AutonomyAction, AutonomyLevel>>,
): boolean {
  return AUTONOMY_ACTIONS.some((action) => levels[action] === "autonomous");
}

/** The fields the Host accepts for `autonomy.set`. Version and owner fields are never sent. */
export type AutonomyInput = Pick<AutonomyPolicy, "levels" | "limits" | "workingHours">;

export function autonomyInputFrom(policy: AutonomyPolicy): AutonomyInput {
  return {
    levels: { ...policy.levels },
    limits: { ...policy.limits },
    ...(policy.workingHours ? { workingHours: { ...policy.workingHours } } : {}),
  };
}

/** Local time zone for a new working-hours block, with a safe fallback. */
export function defaultTimeZone(): string {
  try {
    return dateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Day names for the working-hours checkboxes, Sunday first (0 to 6 as the Host stores them). */
export function weekdayLabels(locale?: string): { day: number; label: string }[] {
  const formatter = dateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2026-11-01 is a Sunday.
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    label: formatter.format(new Date(Date.UTC(2026, 10, 1 + day))),
  }));
}
