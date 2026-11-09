import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  filterAssistantManagedSessions,
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  filterSettledSessions,
  hasActiveSessionFilters,
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
  timeFilterStart,
} from "./sessionFilters";
import type { SessionSummary } from "../data/sessionStore";

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: `cursor · ${id}`,
    createdAt: 1,
    updatedAt: 1,
    additions: 0,
    deletions: 0,
    ...overrides,
  };
}

describe("filterSessionsByHarness", () => {
  it("hides selected providers", () => {
    const rows = [summary("a1", { harness: "cursor" }), summary("a2", { harness: "claude" })];
    expect(filterSessionsByHarness(rows, ["cursor"]).map((row) => row.id)).toEqual(["a2"]);
  });
});

it("filters only stamped assistant sessions and composes with existing status filters", () => {
  const rows = [
    summary("manual", { title: "Managed by Arif" }),
    summary("managed", { managedBy: { assistant: true, jobId: "job", managedAt: 1 } }),
    summary("managed-idle", { managedBy: { assistant: true, jobId: "other", managedAt: 2 } }),
  ];
  expect(filterAssistantManagedSessions(rows, false)).toBe(rows);
  const managed = filterAssistantManagedSessions(rows, true);
  expect(managed.map((row) => row.id)).toEqual(["managed", "managed-idle"]);
  expect(
    filterSessionsByStatus(
      managed,
      { working: true, needsApproval: false, done: false },
      new Set(["managed", "manual"]),
      new Set(),
      new Set(),
    ).map((row) => row.id),
  ).toEqual(["managed"]);
  expect(
    hasActiveSessionFilters({ ...DEFAULT_SESSION_SIDEBAR_FILTERS, assistantManaged: true }),
  ).toBe(true);
});

it("retains the managed filter across reloads and keeps legacy and malformed stored filters off", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  try {
    saveSessionSidebarFilters({
      ...DEFAULT_SESSION_SIDEBAR_FILTERS,
      assistantManaged: true,
      time: "7d",
    });
    expect(loadSessionSidebarFilters()).toMatchObject({ assistantManaged: true, time: "7d" });
    data.set("bycoda.sessionSidebarFilters", JSON.stringify({ showArchived: true }));
    expect(loadSessionSidebarFilters()).toMatchObject({
      assistantManaged: false,
      showArchived: true,
    });
    data.set("bycoda.sessionSidebarFilters", JSON.stringify({ assistantManaged: "true" }));
    expect(loadSessionSidebarFilters().assistantManaged).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("lists only settled sessions while the Settled filter is on and remembers it", () => {
  const rows = [summary("a"), summary("b")];
  const isSettled = (row: SessionSummary) => row.id === "b";
  expect(filterSettledSessions(rows, false, isSettled)).toBe(rows);
  expect(filterSettledSessions(rows, true, isSettled).map((row) => row.id)).toEqual(["b"]);
  expect(hasActiveSessionFilters({ ...DEFAULT_SESSION_SIDEBAR_FILTERS, showSettled: true })).toBe(
    true,
  );
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  try {
    saveSessionSidebarFilters({ ...DEFAULT_SESSION_SIDEBAR_FILTERS, showSettled: true });
    expect(loadSessionSidebarFilters().showSettled).toBe(true);
    data.set("bycoda.sessionSidebarFilters", JSON.stringify({ showSettled: "yes" }));
    expect(loadSessionSidebarFilters().showSettled).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("filterSessionsByTime", () => {
  const now = new Date("2026-08-25T15:00:00").getTime();

  it("keeps sessions updated today", () => {
    const rows = [
      summary("a1", { updatedAt: now - 60_000 }),
      summary("a2", { updatedAt: now - 8 * 24 * 60 * 60 * 1000 }),
    ];
    expect(filterSessionsByTime(rows, "today", now).map((row) => row.id)).toEqual(["a1"]);
  });

  it("keeps sessions from the last 7 days", () => {
    const rows = [
      summary("a1", { updatedAt: now - 6 * 24 * 60 * 60 * 1000 }),
      summary("a2", { updatedAt: now - 10 * 24 * 60 * 60 * 1000 }),
    ];
    expect(filterSessionsByTime(rows, "7d", now).map((row) => row.id)).toEqual(["a1"]);
  });
});

describe("filterSessionsByStatus", () => {
  it("matches any selected live status", () => {
    const rows = [summary("a1"), summary("a2"), summary("a3")];
    const filtered = filterSessionsByStatus(
      rows,
      { working: true, needsApproval: false, done: false },
      new Set(["a1"]),
      new Set(["a2"]),
      new Set(["a3"]),
    );
    expect(filtered.map((row) => row.id)).toEqual(["a1"]);
  });

  it("combines status filters with OR semantics", () => {
    const rows = [summary("a1"), summary("a2"), summary("a3")];
    const filtered = filterSessionsByStatus(
      rows,
      { working: true, needsApproval: true, done: false },
      new Set(["a1"]),
      new Set(["a2"]),
      new Set(["a3"]),
    );
    expect(filtered.map((row) => row.id)).toEqual(["a1", "a2"]);
  });
});

describe("hasActiveSessionFilters", () => {
  it("is false for defaults", () => {
    expect(hasActiveSessionFilters(DEFAULT_SESSION_SIDEBAR_FILTERS)).toBe(false);
  });

  it("is true when any filter is set", () => {
    expect(
      hasActiveSessionFilters({
        ...DEFAULT_SESSION_SIDEBAR_FILTERS,
        time: "7d",
      }),
    ).toBe(true);
  });
});

describe("timeFilterStart", () => {
  it("starts today at local midnight", () => {
    const now = new Date("2026-08-25T15:00:00").getTime();
    expect(timeFilterStart("today", now)).toBe(new Date("2026-08-25T00:00:00").getTime());
  });
});
