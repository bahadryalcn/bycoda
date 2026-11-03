// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { useGlobalRecentSessions } from "./useGlobalRecentSessions";

const fetch = vi.hoisted(() => vi.fn<() => Promise<SessionSummary[]>>());
vi.mock("../data/sessionStore", () => ({ listRecentSessionsSince: fetch }));
const history: SessionSummary[] = [];
const sessions: never[] = [];
let enabled = true;
let allowed = new Set(["/visible"]);
let result: ReturnType<typeof useGlobalRecentSessions>;
function Probe() {
  const current = useGlobalRecentSessions(history, sessions, enabled, allowed);
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
const row: SessionSummary = {
  id: "a",
  cwd: "/visible",
  title: "A",
  harness: "codex",
  model: "m",
  runtimeMode: "supervised",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  enabled = true;
  allowed = new Set(["/visible"]);
});

it("ignores stale responses, applies privacy immediately, and retains rows on error", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  let resolveFirst!: (rows: SessionSummary[]) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  );
  fetch.mockResolvedValueOnce([row]);
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(createElement(Probe));
    vi.advanceTimersByTime(300);
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {
    result.refresh();
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  expect(result.rows).toHaveLength(1);
  await act(async () => {
    resolveFirst([]);
  });
  expect(result.rows).toHaveLength(1);
  allowed = new Set();
  await act(async () => {
    root.render(createElement(Probe));
  });
  expect(result.rows).toHaveLength(0);
  allowed = new Set(["/visible"]);
  fetch.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    root.render(createElement(Probe));
    result.refresh();
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  expect(result.rows).toHaveLength(1);
  expect(result.error).toContain("offline");
  enabled = false;
  await act(async () => {
    root.render(createElement(Probe));
  });
  expect(result.loading).toBe(false);
  await act(async () => root.unmount());
});

it("refreshes the cutoff immediately when reopening after more than a week", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const started = Date.now();
  vi.setSystemTime(started);
  fetch.mockResolvedValue([{ ...row, createdAt: started, updatedAt: started }]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.rows).toHaveLength(1);
    enabled = false;
    await act(async () => root.render(createElement(Probe)));
    vi.setSystemTime(started + 8 * 86400000);
    enabled = true;
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
