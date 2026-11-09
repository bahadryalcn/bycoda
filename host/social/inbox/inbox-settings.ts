import {
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../../../src/features/social/model/social";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import type { SocialServiceApi } from "../core/social-service-api";
import type { InboxSettings } from "./inbox-types";

/** Same key as the legacy `inbox.polling` alias, so both actions read one value. */
export const AUTO_REFRESH_KEY = "polling";
export const INBOX_INTERVALS_KEY = "inbox.intervals";
export const INBOX_MIN_INTERVAL_SECONDS = 60;
export const INBOX_MAX_INTERVAL_SECONDS = 86_400;
/** Polling period for an account without a live webhook. Matches the previous fixed 60 s. */
const DEFAULT_INTERVAL_SECONDS = 60;
/** Sparse fallback poll for an account whose webhook is live (signed push delivers the rest). */
const WEBHOOK_INTERVAL_SECONDS = 900;
/**
 * Default for a browser-session account: each poll loads the site in the owner's profile, so
 * reading every minute keeps a browser running nonstop and looks automated to the platform.
 */
const BROWSER_INTERVAL_SECONDS = 300;

type SettingsReader = Pick<SocialServiceApi, "setting">;

/**
 * Owner decision: auto-refresh is ON when no value is stored. Only an explicit stored "false"
 * (owner toggle or local-execution suspension) turns it off.
 */
export async function readInboxSettings(service: SettingsReader): Promise<InboxSettings> {
  const autoRefresh = (await service.setting(AUTO_REFRESH_KEY)) !== "false";
  return { autoRefresh, intervals: parseIntervals(await service.setting(INBOX_INTERVALS_KEY)) };
}

/** Stored overrides only. Unreadable stored JSON falls back to the defaults, never throws. */
function parseIntervals(raw: string | undefined): InboxSettings["intervals"] {
  if (!raw) return {};
  try {
    return validateIntervals(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Validates owner input. Unknown platforms and periods outside 60 s to 24 h are rejected. */
export function validateIntervals(value: unknown): InboxSettings["intervals"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid inbox intervals.");
  const intervals: InboxSettings["intervals"] = {};
  for (const [platform, seconds] of Object.entries(value)) {
    if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform))
      throw new Error("Unknown platform in inbox intervals.");
    if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < INBOX_MIN_INTERVAL_SECONDS ||
      seconds > INBOX_MAX_INTERVAL_SECONDS
    )
      throw new Error(
        `Inbox interval must be ${INBOX_MIN_INTERVAL_SECONDS}-${INBOX_MAX_INTERVAL_SECONDS} seconds.`,
      );
    intervals[platform as SocialPlatform] = seconds;
  }
  return intervals;
}

/**
 * Milliseconds until the next poll of one account. An explicit owner override wins (never below
 * the 60 s floor). Otherwise a live webhook makes the poll sparse, and a browser session
 * polls every five minutes.
 */
export function pollIntervalMs(
  account: SocialAccount,
  settings: InboxSettings,
  now: number,
): number {
  const override = settings.intervals[account.platform];
  if (override !== undefined) return Math.max(INBOX_MIN_INTERVAL_SECONDS, override) * 1000;
  const webhookLive =
    accountCapabilities(account, now).find((item) => item.operation === "webhook")?.status ===
    "available";
  if (webhookLive) return WEBHOOK_INTERVAL_SECONDS * 1000;
  const seconds =
    account.connection === "browser" ? BROWSER_INTERVAL_SECONDS : DEFAULT_INTERVAL_SECONDS;
  return seconds * 1000;
}
