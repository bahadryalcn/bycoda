/**
 * Data API v3 unit costs used for local accounting. Values follow the published quota
 * table at the time of writing; verify them against the current Google quota page.
 */
import { dateTimeFormat } from "../../shared/lib/intl";

export const YOUTUBE_UNIT_COSTS = {
  "channels.list": 1,
  "videos.list": 1,
  "commentThreads.list": 1,
  "comments.list": 1,
  "search.list": 100,
  "commentThreads.insert": 50,
  "comments.insert": 50,
  "comments.setModerationStatus": 50,
  "playlistItems.insert": 50,
  "thumbnails.set": 50,
  "videos.insert": 1600,
} as const;
export type YouTubeQuotaOperation = keyof typeof YOUTUBE_UNIT_COSTS;
/** Default project daily allowance (10,000 units), reset at midnight Pacific time. */
export const YOUTUBE_DAILY_UNITS = 10_000;

const pacificDay = (at: number): string =>
  dateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));

export type YouTubeQuota = {
  /** Counts one call before it is sent. Accounting only: it never blocks a call. */
  charge(operation: YouTubeQuotaOperation): void;
  usedToday(): { day: string; units: number };
};

/**
 * shortcut: in-memory counter per adapter instance. It resets on restart and is not shared
 * across Host processes; upgrade to a persisted per-account counter when the host has one.
 */
export function createYouTubeQuota(now: () => number = Date.now): YouTubeQuota {
  let day = "";
  let units = 0;
  return {
    charge(operation) {
      const today = pacificDay(now());
      if (today !== day) {
        day = today;
        units = 0;
      }
      units += YOUTUBE_UNIT_COSTS[operation];
    },
    usedToday() {
      const today = pacificDay(now());
      return { day: today, units: today === day ? units : 0 };
    },
  };
}
