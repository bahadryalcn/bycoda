// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Seen = typeof import("./notificationSeen");
let seen: Seen;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  seen = await import("./notificationSeen");
});
afterEach(() => vi.unstubAllGlobals());

it("initialises and persists the marker on first read", () => {
  expect(seen.readNotificationSeenAt(1000)).toBe(1000);
  expect(localStorage.getItem(seen.NOTIFICATION_SEEN_KEY)).toBe("1000");
  expect(seen.readNotificationSeenAt(5000)).toBe(1000);
});

it("replaces a garbage value", () => {
  localStorage.setItem(seen.NOTIFICATION_SEEN_KEY, "not-a-number");
  expect(seen.readNotificationSeenAt(2000)).toBe(2000);
  expect(localStorage.getItem(seen.NOTIFICATION_SEEN_KEY)).toBe("2000");
});

it("never moves the marker backwards", () => {
  seen.readNotificationSeenAt(1000);
  seen.markNotificationsSeen(3000);
  expect(seen.readNotificationSeenAt()).toBe(3000);
  seen.markNotificationsSeen(2000);
  expect(seen.readNotificationSeenAt()).toBe(3000);
});

it("dispatches the change event only when the value changed", () => {
  const listener = vi.fn();
  window.addEventListener(seen.NOTIFICATION_SEEN_EVENT, listener);
  seen.readNotificationSeenAt(1000);
  seen.markNotificationsSeen(2000);
  seen.markNotificationsSeen(2000);
  seen.markNotificationsSeen(500);
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(seen.NOTIFICATION_SEEN_EVENT, listener);
});

it("subscribes to the custom event and matching storage events, and unsubscribes", () => {
  const onChange = vi.fn();
  const unsubscribe = seen.subscribeNotificationSeen(onChange);
  seen.readNotificationSeenAt(1000);
  seen.markNotificationsSeen(2000);
  expect(onChange).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent("storage", { key: seen.NOTIFICATION_SEEN_KEY }));
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(onChange).toHaveBeenCalledTimes(3);
  window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
  expect(onChange).toHaveBeenCalledTimes(3);
  unsubscribe();
  seen.markNotificationsSeen(3000);
  window.dispatchEvent(new StorageEvent("storage", { key: seen.NOTIFICATION_SEEN_KEY }));
  expect(onChange).toHaveBeenCalledTimes(3);
});

it("counts entries newer than the marker", () => {
  const entries = [{ occurredAt: 100 }, { occurredAt: 200 }, { occurredAt: 300 }];
  expect(seen.countUnseenNotifications(entries, 200)).toBe(1);
  expect(seen.countUnseenNotifications(entries, 0)).toBe(3);
  expect(seen.countUnseenNotifications([], 0)).toBe(0);
});

it("keeps working in memory when storage throws", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  const listener = vi.fn();
  window.addEventListener(seen.NOTIFICATION_SEEN_EVENT, listener);
  expect(seen.readNotificationSeenAt(1000)).toBe(1000);
  expect(seen.readNotificationSeenAt(9000)).toBe(1000);
  seen.markNotificationsSeen(4000);
  expect(seen.readNotificationSeenAt()).toBe(4000);
  expect(listener).toHaveBeenCalledTimes(1);
  window.removeEventListener(seen.NOTIFICATION_SEEN_EVENT, listener);
});
