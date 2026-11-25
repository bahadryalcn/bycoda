/** Data API v3 costs from Google's Quota Calculator, including dedicated buckets. */
import { dateTimeFormat } from "../../shared/lib/intl";

export const YOUTUBE_UNIT_COSTS = {
  "channels.list": 1,
  "channels.update": 50,
  "channelBanners.insert": 50,
  "videos.list": 1,
  "videos.update": 50,
  "videos.delete": 50,
  "commentThreads.list": 1,
  "comments.list": 1,
  "search.list": 1,
  "commentThreads.insert": 50,
  "comments.insert": 50,
  "comments.setModerationStatus": 50,
  "comments.delete": 50,
  "playlists.list": 1,
  "playlists.insert": 50,
  "playlists.update": 50,
  "playlists.delete": 50,
  "playlistItems.list": 1,
  "playlistItems.insert": 50,
  "playlistItems.update": 50,
  "playlistItems.delete": 50,
  "subscriptions.list": 1,
  "subscriptions.insert": 50,
  "subscriptions.delete": 50,
  "thumbnails.set": 50,
  "videos.insert": 1,
  "liveBroadcasts.list": 1,
  "liveBroadcasts.insert": 1,
  "liveBroadcasts.bind": 1,
  "liveBroadcasts.transition": 1,
  "liveStreams.list": 1,
  "liveStreams.insert": 1,
  "liveChatMessages.list": 5,
  "liveChatMessages.insert": 20,
  "liveChatMessages.delete": 20,
  "liveChatBans.insert": 200,
  "liveChatBans.delete": 200,
  "superChatEvents.list": 1,
} as const;
export type YouTubeQuotaOperation = keyof typeof YOUTUBE_UNIT_COSTS;
/** Default project daily allowance (10,000 units), reset at midnight Pacific time. */
export const YOUTUBE_DAILY_UNITS = 10_000;
export const YOUTUBE_DAILY_SEARCH_CALLS = 100;
export const YOUTUBE_DAILY_UPLOAD_CALLS = 100;

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
  usedToday(): { day: string; units: number; searchCalls: number; uploadCalls: number };
};

/**
 * shortcut: in-memory counter per adapter instance. It resets on restart and is not shared
 * across Host processes; upgrade to a persisted per-account counter when the host has one.
 */
export function createYouTubeQuota(now: () => number = Date.now): YouTubeQuota {
  let day = "";
  let units = 0;
  let searchCalls = 0;
  let uploadCalls = 0;
  return {
    charge(operation) {
      const today = pacificDay(now());
      if (today !== day) {
        day = today;
        units = 0;
        searchCalls = 0;
        uploadCalls = 0;
      }
      if (operation === "search.list") searchCalls += YOUTUBE_UNIT_COSTS[operation];
      else if (operation === "videos.insert") uploadCalls += YOUTUBE_UNIT_COSTS[operation];
      else units += YOUTUBE_UNIT_COSTS[operation];
    },
    usedToday() {
      const today = pacificDay(now());
      return today === day
        ? { day: today, units, searchCalls, uploadCalls }
        : { day: today, units: 0, searchCalls: 0, uploadCalls: 0 };
    },
  };
}
