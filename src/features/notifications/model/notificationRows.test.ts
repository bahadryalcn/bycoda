import { expect, it } from "vitest";
import type { NotificationHistoryEntry } from "./notificationHistory";
import { groupHistoryByDay, historyTone, isHistoryUnread } from "./notificationRows";

const entry: NotificationHistoryEntry = {
  key: "k",
  sessionId: "",
  cwd: "",
  title: "Title",
  label: "",
  kind: "finished",
  occurredAt: 100,
};

it("derives the severity icon from the kind unless the row carries its own tone", () => {
  expect(historyTone({ ...entry, kind: "failed" })).toBe("danger");
  expect(historyTone({ ...entry, kind: "question" })).toBe("warning");
  expect(historyTone({ ...entry, kind: "notice", tone: "warning" })).toBe("warning");
  expect(historyTone({ ...entry, kind: "finished" })).toBeUndefined();
  expect(historyTone({ ...entry, kind: "background" })).toBeUndefined();
});

it("is unread only after the seen marker and until marked read", () => {
  expect(isHistoryUnread(entry, 50)).toBe(true);
  expect(isHistoryUnread(entry, 100)).toBe(false);
  expect(isHistoryUnread({ ...entry, read: true }, 50)).toBe(false);
});

it("splits today from earlier at local midnight, keeping order", () => {
  const now = new Date(2026, 10, 22, 15, 0).getTime();
  const at = (day: number, hour: number) => ({
    occurredAt: new Date(2026, 10, day, hour).getTime(),
  });
  const rows = [at(22, 14), at(22, 0), at(21, 23), at(1, 9)];
  const { today, earlier } = groupHistoryByDay(rows, (row) => row.occurredAt, now);
  expect(today).toEqual(rows.slice(0, 2));
  expect(earlier).toEqual(rows.slice(2));
});
