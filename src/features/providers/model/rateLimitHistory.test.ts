// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { recordRateLimitHistory, useRateLimitHistory } from "./rateLimitHistory";
import { idleRateLimits } from "./rateLimits";
const key = "bycoda.quotaHistory.v1";
beforeEach(() => localStorage.clear());
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
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
  recordRateLimitHistory("codex:work", {
    ...limits,
    updatedAt: at + 1000,
    session: { ...limits.session, usedPercent: 1, resetsAt: at + 18_000_000 },
  });
  recordRateLimitHistory("codex:personal", limits);
  const rows = JSON.parse(localStorage.getItem(key)!);
  expect(rows).toHaveLength(3);
  expect(
    rows
      .filter((s: { account: string }) => s.account === "codex:work")
      .map((s: { used: number }) => s.used),
  ).toEqual([40, 1]);
});
it("bounds history and drops readings older than retention", () => {
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
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
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
  const saved = JSON.parse(localStorage.getItem(key)!);
  expect(saved).toHaveLength(16_000);
  expect(saved.at(-1).account).toBe("new-4");
  expect(
    saved.every(
      (value: { at: number }, index: number) => !index || saved[index - 1].at <= value.at,
    ),
  ).toBe(true);
});
