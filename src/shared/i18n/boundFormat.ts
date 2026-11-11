import { formatDate, formatNumber, getLocale } from "./core";
import {
  formatArchiveDate,
  formatAttachmentSize,
  formatBytes,
  formatChatDate,
  formatCompactCount,
  formatCooldown,
  formatDays,
  formatDuration,
  formatElapsed,
  formatFileSize,
  formatGitGraphAbsoluteTime,
  formatGitGraphRelativeTime,
  formatGithubRelativeTime,
  formatImportBytes,
  formatImportDate,
  formatLiveElapsed,
  formatLiveMinutes,
  formatMediaDuration,
  formatMinutes,
  formatRecentRelative,
  formatRelativeTime,
  formatResetDuration,
  formatTokens,
  formatUsageTokens,
  type RelativeTimeOptions,
} from "./format";
import type { Locale } from "./languages";

/**
 * Formatters of the app language returned by `useFormat()`. Same results as the module
 * functions of `core.ts` / `format.ts`; the three that read the clock by default take `now`
 * as a required argument here, so the clock read is visible at the call site.
 */
export type BoundFormat = {
  /** App language this object was bound for. */
  readonly locale: Locale;
  readonly formatNumber: typeof formatNumber;
  readonly formatDate: typeof formatDate;
  /** `now` is required (epoch ms): pass a clock value from state, never `Date.now()` in render. */
  readonly formatRelativeTime: (
    value: number | Date,
    options: Omit<RelativeTimeOptions, "now"> & { now: number },
  ) => string;
  readonly formatBytes: typeof formatBytes;
  readonly formatDuration: typeof formatDuration;
  readonly formatDays: typeof formatDays;
  readonly formatElapsed: typeof formatElapsed;
  readonly formatCompactCount: typeof formatCompactCount;
  readonly formatImportDate: typeof formatImportDate;
  readonly formatArchiveDate: typeof formatArchiveDate;
  readonly formatResetDuration: typeof formatResetDuration;
  readonly formatUsageTokens: typeof formatUsageTokens;
  /** `now` is required (epoch ms). */
  readonly formatGithubRelativeTime: (iso: string, now: number, locale?: string) => string;
  readonly formatImportBytes: typeof formatImportBytes;
  readonly formatAttachmentSize: typeof formatAttachmentSize;
  readonly formatTokens: typeof formatTokens;
  readonly formatLiveElapsed: typeof formatLiveElapsed;
  readonly formatLiveMinutes: typeof formatLiveMinutes;
  readonly formatRecentRelative: typeof formatRecentRelative;
  /** `now` is required (epoch ms). */
  readonly formatChatDate: (timestamp: number, now: number) => string;
  readonly formatMinutes: typeof formatMinutes;
  readonly formatFileSize: typeof formatFileSize;
  readonly formatMediaDuration: typeof formatMediaDuration;
  readonly formatGitGraphRelativeTime: typeof formatGitGraphRelativeTime;
  readonly formatGitGraphAbsoluteTime: typeof formatGitGraphAbsoluteTime;
  readonly formatCooldown: typeof formatCooldown;
};

const bound = new Map<Locale, BoundFormat>();

/** One frozen object per app language; identity changes only when the language does. */
export function boundFormat(): BoundFormat {
  const locale = getLocale();
  let current = bound.get(locale);
  if (!current) {
    // Each member delegates at call time, so results always match the module functions.
    current = Object.freeze({
      locale,
      formatNumber: (value, options) => formatNumber(value, options),
      formatDate: (value, options) => formatDate(value, options),
      formatRelativeTime: (value, options) => formatRelativeTime(value, options),
      formatBytes: (bytes, options) => formatBytes(bytes, options),
      formatDuration: (ms, options) => formatDuration(ms, options),
      formatDays: (count, selected) => formatDays(count, selected),
      formatElapsed: (elapsedMs) => formatElapsed(elapsedMs),
      formatCompactCount: (value, selected) => formatCompactCount(value, selected),
      formatImportDate: (at) => formatImportDate(at),
      formatArchiveDate: (value) => formatArchiveDate(value),
      formatResetDuration: (ms) => formatResetDuration(ms),
      formatUsageTokens: (value) => formatUsageTokens(value),
      formatGithubRelativeTime: (iso, now, selected) =>
        formatGithubRelativeTime(iso, now, selected),
      formatImportBytes: (bytes) => formatImportBytes(bytes),
      formatAttachmentSize: (size) => formatAttachmentSize(size),
      formatTokens: (count) => formatTokens(count),
      formatLiveElapsed: (startedAt, now) => formatLiveElapsed(startedAt, now),
      formatLiveMinutes: (startedAt, now) => formatLiveMinutes(startedAt, now),
      formatRecentRelative: (value, now) => formatRecentRelative(value, now),
      formatChatDate: (timestamp, now) => formatChatDate(timestamp, now),
      formatMinutes: (minutes) => formatMinutes(minutes),
      formatFileSize: (bytes) => formatFileSize(bytes),
      formatMediaDuration: (duration) => formatMediaDuration(duration),
      formatGitGraphRelativeTime: (seconds, nowMs) => formatGitGraphRelativeTime(seconds, nowMs),
      formatGitGraphAbsoluteTime: (seconds, selected, timeZone) =>
        formatGitGraphAbsoluteTime(seconds, selected, timeZone),
      formatCooldown: (ms) => formatCooldown(ms),
    } satisfies BoundFormat);
    bound.set(locale, current);
  }
  return current;
}
