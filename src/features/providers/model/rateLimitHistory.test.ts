// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { recordRateLimitHistory, useRateLimitHistory } from "./rateLimitHistory";
import { idleRateLimits } from "./rateLimits";
const key = "bycoda.quotaHistory.v1";
const segmentPrefix = `${key}.segment.`;
beforeEach(() => localStorage.clear());
const segmentKeys = () =>
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter((name) =>
    name.startsWith(segmentPrefix),
  );
/** Every persisted reading: the legacy base array plus all window segments. */
function stored(): { account: string; at: number }[] {
  const rows: { account: string; at: number }[] = [];
  for (const name of [key, ...segmentKeys()]) {
    try {
      rows.push(...JSON.parse(localStorage.getItem(name) ?? "[]"));
    } catch {
      // An unreadable value holds no readable rows.
    }
  }
  return rows.sort((a, b) => a.at - b.at);
}
const row = (account: string, at: number, kind = "session") => ({
  account,
  at,
  kind,
  used: 20,
  minutes: 60,
  resetsAt: null,
});
const reading = (at: number, used = 10) => ({
  ...idleRateLimits("codex"),
  status: "ok" as const,
  updatedAt: at,
  session: { usedPercent: used, windowMinutes: 60, resetsAt: null },
});
async function mount() {
  const root = createRoot(document.createElement("div"));
  const seen: number[] = [];
  function Probe() {
    seen.push(useRateLimitHistory().length);
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  return { seen, unmount: () => act(async () => root.unmount()) };
}
it("records only successful readings, deduplicates and preserves actual reset boundaries", () => {
  const at = Date.now();
  const limits = {
    ...idleRateLimits("codex"),
    status: "ok" as const,
    updatedAt: at,
    session: { usedPercent: 40, windowMinutes: 300, resetsAt: at + 3_600_000 },
  };
  recordRateLimitHistory("codex:work", limits);
  recordRateLimitHistory("codex:work", limits);
  recordRateLimitHistory("codex:work", { ...limits, status: "error", updatedAt: at + 1 });
  expect(stored()).toHaveLength(1);
  recordRateLimitHistory("codex:work", {
    ...limits,
    updatedAt: at + 1000,
    session: { ...limits.session, usedPercent: 1, resetsAt: at + 18_000_000 },
  });
  recordRateLimitHistory("codex:personal", limits);
  const rows = stored();
  expect(rows).toHaveLength(3);
  expect(
    rows
      .filter((s: { account: string }) => s.account === "codex:work")
      .map((s: { used: number }) => s.used),
  ).toEqual([40, 1]);
});
it("bounds history and drops readings older than retention", async () => {
  localStorage.setItem(
    key,
    JSON.stringify([
      {
        account: "codex:work",
        at: Date.now() - 91 * 86_400_000,
        kind: "session",
        used: 40,
        minutes: 300,
        resetsAt: null,
      },
    ]),
  );
  recordRateLimitHistory("codex:work", {
    ...idleRateLimits("codex"),
    status: "ok",
    updatedAt: Date.now(),
    session: { usedPercent: 1, windowMinutes: 300, resetsAt: null },
  });
  // The expired reading stays in storage until the next fold but is never loaded.
  const { seen, unmount } = await mount();
  expect(seen.at(-1)).toBe(1);
  await unmount();
});

it("shares one storage listener and preserves memory after a quota failure", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const container = document.createElement("div");
  const root = createRoot(container);
  const seen: number[] = [];
  function Probe() {
    seen.push(useRateLimitHistory().length);
    return null;
  }
  await act(async () => {
    root.render(createElement("div", null, createElement(Probe), createElement(Probe)));
  });
  expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
  const fail = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const at = Date.now();
  await act(async () => {
    recordRateLimitHistory("failed-write", {
      ...idleRateLimits("codex"),
      status: "ok",
      updatedAt: at,
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null },
    });
    recordRateLimitHistory("failed-write", {
      ...idleRateLimits("codex"),
      status: "ok",
      updatedAt: at + 1,
      session: { usedPercent: 45, windowMinutes: 300, resetsAt: null },
    });
  });
  expect(seen.at(-1)).toBe(2);
  expect(fail).toHaveBeenCalledTimes(2);
  const deniedRead = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(seen.at(-1)).toBe(2);
  deniedRead.mockRestore();
  // Another window explicitly clears storage even though this window's failed
  // writes left its last observed raw value null.
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(seen.at(-1)).toBe(0);
  await act(async () => {
    recordRateLimitHistory("failed-write", {
      ...idleRateLimits("codex"),
      status: "ok",
      updatedAt: at,
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null },
    });
    recordRateLimitHistory("failed-write", {
      ...idleRateLimits("codex"),
      status: "ok",
      updatedAt: at + 1,
      session: { usedPercent: 45, windowMinutes: 300, resetsAt: null },
    });
  });
  expect(seen.at(-1)).toBe(2);
  fail.mockRestore();
  const external = [
    { account: "other", at, kind: "weekly", used: 10, minutes: 60, resetsAt: null },
  ];
  localStorage.setItem(key, JSON.stringify(external));
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: JSON.stringify(external) })),
  );
  expect(seen.at(-1)).toBe(3);
  await act(async () => root.unmount());
  expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(1);
  add.mockRestore();
  remove.mockRestore();
});

it("keeps ordered bounded history without reparsing on every publication", () => {
  const now = Date.now();
  const samples = Array.from({ length: 16_000 }, (_, index) => ({
    account: `account-${index}`,
    at: now - 20_000 + index,
    kind: "session",
    used: 20,
    minutes: 60,
    resetsAt: null,
  }));
  localStorage.setItem(key, JSON.stringify(samples));
  const parse = vi.spyOn(JSON, "parse");
  for (let index = 0; index < 5; index++)
    recordRateLimitHistory(`new-${index}`, {
      ...idleRateLimits("codex"),
      status: "ok",
      updatedAt: now + index,
      session: { usedPercent: index, windowMinutes: 60, resetsAt: null },
    });
  expect(parse).toHaveBeenCalledTimes(1);
  parse.mockRestore();
  const saved = stored();
  expect(saved).toHaveLength(16_005);
  expect(saved.at(-1)!.account).toBe("new-4");
  expect(
    saved.every((value, index) => !index || saved[index - 1].at <= value.at),
  ).toBe(true);
});

it("appends to a small segment and never rewrites the legacy array per reading", () => {
  const now = Date.now();
  const legacy = JSON.stringify(
    Array.from({ length: 16_000 }, (_, index) => row(`legacy-${index}`, now - 20_000 + index)),
  );
  localStorage.setItem(key, legacy);
  const write = vi.spyOn(localStorage, "setItem");
  for (let index = 0; index < 5; index++)
    recordRateLimitHistory(`new-${index}`, reading(now + index, index));
  const writes = write.mock.calls.slice();
  write.mockRestore();
  expect(writes).toHaveLength(5);
  expect(writes.every(([name]) => name !== key)).toBe(true);
  expect(Math.max(...writes.map(([, value]) => String(value).length))).toBeLessThan(2_000);
  expect(localStorage.getItem(key)).toBe(legacy);
  expect(stored()).toHaveLength(16_005);
});

it("folds a full segment into the base array within retention and the sample cap", () => {
  const now = Date.now();
  const expired = row("expired", now - 91 * 86_400_000);
  const recent = Array.from({ length: 15_800 }, (_, index) =>
    row(`recent-${index}`, now - 100_000 + index),
  );
  localStorage.setItem(key, JSON.stringify([expired, ...recent]));
  for (let index = 0; index < 500; index++)
    recordRateLimitHistory(`fold-${index}`, reading(now + index, index % 100));
  expect(segmentKeys()).toEqual([]);
  const base: { account: string }[] = JSON.parse(localStorage.getItem(key)!);
  expect(base).toHaveLength(16_000);
  expect(base.some((sample) => sample.account === "expired")).toBe(false);
  expect(base.at(-1)!.account).toBe("fold-499");
});

it("merges another window's segment without reparsing the base and folds it on compaction", async () => {
  const now = Date.now();
  localStorage.setItem(
    key,
    JSON.stringify(Array.from({ length: 1000 }, (_, index) => row(`legacy-${index}`, now - 50_000 + index))),
  );
  const { seen, unmount } = await mount();
  expect(seen.at(-1)).toBe(1000);
  const foreignKey = `${segmentPrefix}other-window`;
  const first = JSON.stringify([row("other", now + 1, "weekly")]);
  localStorage.setItem(foreignKey, first);
  const parse = vi.spyOn(JSON, "parse");
  await act(async () =>
    window.dispatchEvent(new StorageEvent("storage", { key: foreignKey, newValue: first })),
  );
  const parsed = parse.mock.calls.map(([text]) => String(text));
  parse.mockRestore();
  expect(seen.at(-1)).toBe(1001);
  expect(parsed.filter((text) => text.length > 1_000)).toEqual([]);
  expect(parsed).toContain(first);
  // The other window appends again before this window folds; no event has arrived yet.
  localStorage.setItem(
    foreignKey,
    JSON.stringify([row("other", now + 1, "weekly"), row("other", now + 2, "weekly")]),
  );
  await act(async () => {
    for (let index = 0; index < 500; index++)
      recordRateLimitHistory(`own-${index}`, reading(now + 10 + index));
  });
  expect(segmentKeys()).toEqual([]);
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1000 + 2 + 500);
  expect(seen.at(-1)).toBe(1502);
  await unmount();
});

it("folds segments left by closed windows when a window starts", async () => {
  const now = Date.now();
  for (let index = 0; index < 9; index++)
    localStorage.setItem(
      `${segmentPrefix}closed-${index}`,
      JSON.stringify([row(`closed-${index}`, now - 1000 + index)]),
    );
  const { seen, unmount } = await mount();
  expect(seen.at(-1)).toBe(9);
  expect(segmentKeys()).toEqual([]);
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(9);
  await unmount();
});

it("ignores an unreadable segment and keeps the readable history", () => {
  const now = Date.now();
  localStorage.setItem(key, JSON.stringify([row("kept", now - 10)]));
  localStorage.setItem(`${segmentPrefix}broken`, "{not json");
  recordRateLimitHistory("fresh", reading(now));
  expect(stored().map((sample) => sample.account)).toEqual(["kept", "fresh"]);
});
