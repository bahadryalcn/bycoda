// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MAX_NOTIFICATION_HISTORY,
  NOTIFICATION_HISTORY_KEY,
  readNotificationHistory,
  writeNotificationHistory,
  appendNotificationHistory,
  clearNotificationHistory,
  type NotificationHistoryEntry,
} from "./notificationHistory";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
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

it("merges arrivals into the latest durable list, bounds it and preserves an explicit clear", () => {
  const first = { ...entry, key: "first", occurredAt: 1 };
  const second = { ...entry, key: "second", occurredAt: 2 };
  expect(appendNotificationHistory([first], [])).toEqual([first]);
  // A second window still has an empty component-local history.
  expect(appendNotificationHistory([second], [])).toEqual([second, first]);
  expect(readNotificationHistory()).toEqual([second, first]);
  writeNotificationHistory([]);
  expect(
    appendNotificationHistory([{ ...entry, key: "third", occurredAt: 3 }], [second, first]),
  ).toEqual([expect.objectContaining({ key: "third" })]);
  const many = Array.from({ length: 125 }, (_, i) => ({
    ...entry,
    key: `entry-${i}`,
    occurredAt: i + 10,
  }));
  expect(appendNotificationHistory(many)).toHaveLength(MAX_NOTIFICATION_HISTORY);
});

it("serializes independent arrivals and explicit clear through the same supported Web Lock", async () => {
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, mutate: () => unknown) => {
    const result = tail.then(mutate);
    tail = result.then(() => undefined);
    return result;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  const first = { ...entry, key: "first", occurredAt: 1 };
  const second = { ...entry, key: "second", occurredAt: 2 };
  await Promise.all([appendNotificationHistory([first]), appendNotificationHistory([second])]);
  expect(readNotificationHistory()).toEqual([second, first]);
  await Promise.all([
    appendNotificationHistory([first]),
    clearNotificationHistory(),
    appendNotificationHistory([second]),
  ]);
  expect(readNotificationHistory()).toEqual([second]);
  expect(request.mock.calls.every(([name]) => name === NOTIFICATION_HISTORY_KEY)).toBe(true);
});

it("retains latest-storage fallback when Web Locks is denied before mutation", async () => {
  vi.stubGlobal("navigator", {
    locks: { request: vi.fn().mockRejectedValue(new Error("Web Locks unavailable")) },
  });
  await appendNotificationHistory([entry]);
  expect(readNotificationHistory()).toEqual([entry]);
  await clearNotificationHistory();
  expect(readNotificationHistory()).toEqual([]);
});
