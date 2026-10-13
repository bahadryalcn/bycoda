// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  MAX_NOTIFICATION_HISTORY,
  NOTIFICATION_HISTORY_KEY,
  readNotificationHistory,
  writeNotificationHistory,
  type NotificationHistoryEntry,
} from "./notificationHistory";

beforeEach(() => localStorage.clear());
const entry: NotificationHistoryEntry = {
  key: "work:approval:1",
  sessionId: "work",
  cwd: "/projects/work",
  title: "Work",
  label: "Run checks",
  kind: "approval",
  occurredAt: 1_800_000_000_000,
};

it("caps retained history and preserves the newest entries", () => {
  writeNotificationHistory(Array.from({ length: 125 }, (_, i) => ({ ...entry, label: String(i) })));
  const saved = readNotificationHistory();
  expect(saved).toHaveLength(MAX_NOTIFICATION_HISTORY);
  expect(saved[0].label).toBe("0");
  expect(saved.at(-1)?.label).toBe("99");
});

it("ignores malformed storage and invalid dates without breaking the sheet", () => {
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "bad json");
  expect(readNotificationHistory()).toEqual([]);
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      null,
      {},
      { ...entry, occurredAt: 1e20 },
      { ...entry, kind: "unknown" },
      entry,
    ]),
  );
  expect(readNotificationHistory()).toEqual([entry]);
});
