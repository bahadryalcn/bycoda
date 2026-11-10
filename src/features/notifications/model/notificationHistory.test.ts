// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MAX_NOTIFICATION_HISTORY,
  NOTIFICATION_HISTORY_EVENT,
  NOTIFICATION_HISTORY_KEY,
  recordNotificationHistory,
  historyOccurrenceIds,
  readNotificationHistory,
  readNotificationHistoryStatus,
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

it("distinguishes unreadable history from an empty one and keeps local entries when appending", () => {
  expect(readNotificationHistoryStatus()).toEqual({ state: "ready", entries: [] });
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "bad json");
  expect(readNotificationHistoryStatus()).toEqual({ state: "unavailable", entries: [] });
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify({ not: "a list" }));
  expect(readNotificationHistoryStatus().state).toBe("unavailable");

  const local = { ...entry, key: "kept:approval:1", occurredAt: entry.occurredAt - 1 };
  const added = { ...entry, key: "new:approval:1" };
  expect(appendNotificationHistory([added], [local])).toEqual([added, local]);
  expect(readNotificationHistoryStatus()).toEqual({ state: "ready", entries: [added, local] });
});

it("keeps occurrence identities stable when newer arrivals prepend", () => {
  const older = { ...entry, occurredAt: 1000 };
  const reused = { ...entry, occurredAt: 2000 };
  const before = historyOccurrenceIds([reused, older]);
  const after = historyOccurrenceIds([
    { ...entry, key: "x:question:9", occurredAt: 3000 },
    reused,
    older,
  ]);
  expect(before).toEqual(after.slice(1));
  expect(new Set(before).size).toBe(2);
  // Identical key and time are still distinct rows.
  const twin = historyOccurrenceIds([older, older]);
  expect(new Set(twin).size).toBe(2);
});

it("records the provider so a stored title can drop its prefix", async () => {
  const { historyEntry } = await import("./notificationHistory");
  const stored = historyEntry({
    sessionId: "s",
    requestId: 1,
    label: "x",
    kind: "approval",
    session: { cwd: "/p", title: "Codex · Fix", harness: "codex" },
  } as never);
  expect(stored.harness).toBe("codex");
});

it("removes one occurrence, keeps a reused request ID and refuses an unreadable store", async () => {
  const { removeNotificationHistoryEntry } = await import("./notificationHistory");
  const older = { ...entry, occurredAt: 1000 };
  const reused = { ...entry, occurredAt: 2000 };
  const other = { ...entry, key: "other:question:1", occurredAt: 1500 };
  writeNotificationHistory([reused, other, older]);
  expect(removeNotificationHistoryEntry(older)).toEqual([reused, other]);
  expect(readNotificationHistory()).toEqual([reused, other]);
  // Already gone: the stored list is returned unchanged.
  expect(removeNotificationHistoryEntry(older)).toEqual([reused, other]);
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "bad json");
  expect(removeNotificationHistoryEntry(reused)).toBeNull();
  expect(localStorage.getItem(NOTIFICATION_HISTORY_KEY)).toBe("bad json");
});

it("reads entries stored before the log held other kinds, and the new kinds with their target", () => {
  const old = { ...entry, key: "old", kind: "question" as const };
  const finished = { ...entry, key: "done", kind: "finished" as const };
  const background = {
    ...entry,
    key: "bg",
    kind: "background" as const,
    sessionId: "",
    cwd: "",
    target: "background:tasks",
  };
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify([background, finished, old]));
  expect(readNotificationHistory()).toEqual([background, finished, old]);
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      { ...entry, target: 5 },
      { ...entry, kind: "other" },
    ]),
  );
  expect(readNotificationHistory()).toEqual([]);
});

it("records an entry once per key and time and announces the change in this window", async () => {
  const changed = vi.fn();
  window.addEventListener(NOTIFICATION_HISTORY_EVENT, changed);
  const logged = { ...entry, key: "done", kind: "finished" as const };
  expect(await recordNotificationHistory(logged)).toBe(true);
  expect(await recordNotificationHistory(logged)).toBe(false);
  expect(await recordNotificationHistory({ ...logged, occurredAt: logged.occurredAt + 1 })).toBe(
    true,
  );
  expect(readNotificationHistory()).toHaveLength(2);
  expect(changed).toHaveBeenCalledTimes(2);
  window.removeEventListener(NOTIFICATION_HISTORY_EVENT, changed);
  localStorage.setItem(NOTIFICATION_HISTORY_KEY, "bad json");
  expect(await recordNotificationHistory({ ...logged, key: "other" })).toBe(false);
});
