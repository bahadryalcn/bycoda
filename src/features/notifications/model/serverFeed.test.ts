import {
  defaultNotificationSettings,
  type NotificationEventKey,
  type NotificationItem,
} from "@bycoda/account-contracts";
import { describe, expect, it } from "vitest";
import { inQuietHours } from "./quietHours";
import { FEED_MAX_AGE_MS, planFeed } from "./serverFeed";

const NOW = Date.parse("2026-11-08T10:00:00Z");

function item(
  event: NotificationEventKey,
  key: string,
  extra: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: `id-${key}`,
    event,
    title: "Title",
    body: "Body",
    createdAt: new Date(NOW - 60_000).toISOString(),
    readAt: null,
    dedupeKey: key,
    ...extra,
  };
}

function context(overrides: Partial<Parameters<typeof planFeed>[1]> = {}) {
  const settings = defaultNotificationSettings();
  settings.preferences.push({
    scope: "user",
    event: "announcement.published",
    channel: "os",
    enabled: true,
  });
  return { settings, now: NOW, shown: new Set<string>(), localSummarySentAt: null, ...overrides };
}

describe("quiet hours", () => {
  const quiet = { start: "22:00", end: "07:00", timeZone: "Europe/Istanbul" };
  it("wraps midnight in the chosen zone, end exclusive", () => {
    expect(inQuietHours(quiet, Date.parse("2026-11-08T20:00:00Z"))).toBe(true);
    expect(inQuietHours(quiet, Date.parse("2026-11-08T03:00:00Z"))).toBe(true);
    expect(inQuietHours(quiet, Date.parse("2026-11-08T04:00:00Z"))).toBe(false);
    expect(inQuietHours(quiet, Date.parse("2026-11-08T10:00:00Z"))).toBe(false);
  });
  it("treats an empty window, no window and an unknown zone as not quiet", () => {
    expect(inQuietHours({ ...quiet, end: "22:00" }, NOW)).toBe(false);
    expect(inQuietHours(null, NOW)).toBe(false);
    expect(inQuietHours({ ...quiet, timeZone: "Nowhere/Land" }, NOW)).toBe(false);
  });
});

describe("planFeed", () => {
  it("shows unread items whose OS channel is on", () => {
    const plan = planFeed([item("announcement.published", "a1")], context());
    expect(plan.show.map((i) => i.dedupeKey)).toEqual(["a1"]);
  });

  it("dedupes by key: already shown, repeated in the feed, already read elsewhere", () => {
    const plan = planFeed(
      [
        item("announcement.published", "seen"),
        item("announcement.published", "twice"),
        item("announcement.published", "twice"),
        item("announcement.published", "read", { readAt: new Date(NOW).toISOString() }),
      ],
      context({ shown: new Set(["seen"]) }),
    );
    expect(plan.show.map((i) => i.dedupeKey)).toEqual(["twice"]);
  });

  it("does not announce what the desktop raised itself", () => {
    const plan = planFeed(
      [item("agent.finished", "run-1"), item("summary.daily", "sum-1")],
      context({ localSummarySentAt: NOW - 3_600_000 }),
    );
    expect(plan.show).toEqual([]);
    expect(plan.handled.map((i) => i.dedupeKey)).toEqual(["run-1", "sum-1"]);
  });

  it("announces a daily summary the desktop did not send today", () => {
    const plan = planFeed([item("summary.daily", "sum-2")], {
      ...context(),
      settings: (() => {
        const s = defaultNotificationSettings();
        s.preferences.push({ scope: "user", event: "summary.daily", channel: "os", enabled: true });
        return s;
      })(),
      localSummarySentAt: NOW - 3 * 24 * 3_600_000,
    });
    expect(plan.show).toHaveLength(1);
  });

  it("skips an event whose OS channel is off, without remembering it", () => {
    const plan = planFeed([item("announcement.published", "a2")], {
      ...context(),
      settings: defaultNotificationSettings(),
    });
    expect(plan.show).toEqual([]);
    expect(plan.handled).toEqual([]);
  });

  it("drops optional items in quiet hours but still shows the mandatory sign-in alert", () => {
    const settings = context().settings;
    settings.quietHours = { start: "09:00", end: "12:00", timeZone: "UTC" };
    const plan = planFeed(
      [item("announcement.published", "a3"), item("account.new_device_sign_in", "dev-1")],
      { ...context(), settings },
    );
    expect(plan.show.map((i) => i.dedupeKey)).toEqual(["dev-1"]);
    expect(plan.handled.map((i) => i.dedupeKey)).toEqual(["a3"]);
  });

  it("ignores items older than a day", () => {
    const old = item("account.new_device_sign_in", "old", {
      createdAt: new Date(NOW - FEED_MAX_AGE_MS - 1000).toISOString(),
    });
    expect(planFeed([old], context())).toEqual({ show: [], handled: [] });
  });
});
