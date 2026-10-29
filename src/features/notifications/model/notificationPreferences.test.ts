// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import {
  allowsProjectNotification,
  loadNotificationPreferences,
  updateNotificationPreferences,
  notificationPreferencesSnapshot,
  subscribeNotificationPreferences,
  getProjectNotificationRule,
  notificationPreferencesStatus,
  retryNotificationPreferencesRead,
} from "./notificationPreferences";

beforeEach(() => localStorage.clear());

it("refuses to overwrite unreadable preferences while retaining the last known view", () => {
  updateNotificationPreferences(["private"], { disabled: ["issues"] });
  const known = loadNotificationPreferences();
  localStorage.setItem("bycoda.projectNotifications.v1", "{broken");
  expect(loadNotificationPreferences()).toEqual(known);
  expect(() => updateNotificationPreferences(["other"], { disabled: [] })).toThrow();
  expect(localStorage.getItem("bycoda.projectNotifications.v1")).toBe("{broken");
});

it("does not leak an unpersisted mutation into the retained notification view", () => {
  updateNotificationPreferences(["private"], { disabled: ["issues"] });
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try {
    expect(() => updateNotificationPreferences(["private"], { disabled: [] })).toThrow("quota");
    expect(loadNotificationPreferences().private.disabled).toEqual(["issues"]);
  } finally {
    write.mockRestore();
  }
});

it("temporarily silences the whole project and restores only its selected categories at expiry", () => {
  updateNotificationPreferences(["private"], {
    disabled: ["issues", "agentFinished", "agentInput"],
  });
  updateNotificationPreferences(["private"], { mutedUntil: 5000 });
  expect(allowsProjectNotification({ projectId: "private", category: "pullRequests" }, 4999)).toBe(
    false,
  );
  expect(allowsProjectNotification({ projectId: "work", category: "pullRequests" }, 4999)).toBe(
    true,
  );
  expect(allowsProjectNotification({ projectId: "private", category: "pullRequests" }, 5000)).toBe(
    true,
  );
  expect(allowsProjectNotification({ projectId: "private", category: "issues" }, 5000)).toBe(false);
});

it("allows an event scheduled exactly at the mute deadline", () => {
  updateNotificationPreferences(["private"], { mutedUntil: 2000 });
  expect(
    allowsProjectNotification(
      { projectId: "private", category: "reminders", occurredAt: 2000 },
      2000,
    ),
  ).toBe(true);
});

it("provides native delivery with the same category and time rule without depending on a running UI timer", () => {
  updateNotificationPreferences(["private"], {
    disabled: ["issues"],
    mutedUntil: 5000,
  });
  expect(getProjectNotificationRule("private", "reminders")).toEqual({
    enabled: true,
    after: 4999,
  });
  expect(getProjectNotificationRule("private", "issues")).toEqual({
    enabled: false,
    after: 4999,
  });
  updateNotificationPreferences(["private"], { mutedUntil: null });
  expect(getProjectNotificationRule("private", "reminders").enabled).toBe(false);
});

it("re-enabling one category resumes new events without replaying its delayed history", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    updateNotificationPreferences(["private"], { disabled: ["issues"] });
    vi.setSystemTime(2000);
    updateNotificationPreferences(["private"], { disabled: [] });
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 1500 },
        2100,
      ),
    ).toBe(false);
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "pullRequests", occurredAt: 1500 },
        2100,
      ),
    ).toBe(true);
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 2050 },
        2100,
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("does not replay activity from a mute period when the next refresh arrives after expiry or manual resume", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  try {
    updateNotificationPreferences(["private"], { mutedUntil: 2000 });
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 1500 },
        2100,
      ),
    ).toBe(false);
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 2050 },
        2100,
      ),
    ).toBe(true);
    updateNotificationPreferences(["private"], { mutedUntil: null });
    vi.setSystemTime(3000);
    updateNotificationPreferences(["private"], { mutedUntil: undefined });
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 2900 },
        3100,
      ),
    ).toBe(false);
    expect(
      allowsProjectNotification(
        { projectId: "private", category: "issues", occurredAt: 3050 },
        3100,
      ),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("notifies mounted controls at expiry without a reload and synchronizes changes from another window", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const listener = vi.fn();
  const unsubscribe = subscribeNotificationPreferences(listener);
  try {
    updateNotificationPreferences(["private"], { mutedUntil: 2000 });
    const muted = notificationPreferencesSnapshot();
    listener.mockClear();
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalled();
    expect(notificationPreferencesSnapshot()).not.toBe(muted);
    listener.mockClear();
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.projectNotifications.v1" }));
    expect(listener).toHaveBeenCalled();
  } finally {
    unsubscribe();
    vi.useRealTimers();
  }
});

it("ignores malformed persisted entries without losing valid project choices", () => {
  localStorage.setItem(
    "bycoda.projectNotifications.v1",
    JSON.stringify({
      private: {
        disabled: ["issues", "future-category", 5],
        mutedUntil: "forever",
      },
      broken: null,
    }),
  );
  expect(loadNotificationPreferences()).toEqual({
    private: { disabled: ["issues"] },
  });
  expect(allowsProjectNotification({ projectId: "broken", category: "issues" })).toBe(true);
});

it("reports unreadable preferences as unavailable, notifies subscribers and recovers on retry", () => {
  updateNotificationPreferences(["private"], { disabled: ["issues"] });
  expect(notificationPreferencesStatus()).toBe("ready");
  const before = notificationPreferencesSnapshot();
  const listener = vi.fn();
  const unsubscribe = subscribeNotificationPreferences(listener);
  try {
    localStorage.setItem("bycoda.projectNotifications.v1", "{broken");
    expect(retryNotificationPreferencesRead()).toBe("unavailable");
    expect(listener).toHaveBeenCalled();
    expect(notificationPreferencesStatus()).toBe("unavailable");
    expect(notificationPreferencesSnapshot()).not.toBe(before);
    // The last known choices stay visible but are not presented as the stored record.
    expect(loadNotificationPreferences().private.disabled).toEqual(["issues"]);

    localStorage.setItem("bycoda.projectNotifications.v1", JSON.stringify({}));
    expect(retryNotificationPreferencesRead()).toBe("ready");
    expect(notificationPreferencesStatus()).toBe("ready");
  } finally {
    unsubscribe();
  }
});
