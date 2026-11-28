// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import type { SessionListQuery } from "../data/sessionListFeed";
import { useGlobalRecentSessions } from "./useGlobalRecentSessions";
import { newSession, type Session } from "../model/session";
import { setSessionLifecycleList } from "../model/sessionLifecycleClient";

const feed = vi.hoisted(() => ({
  page: vi.fn(),
  counts: vi.fn(),
  revision: vi.fn(),
}));
vi.mock("../data/sessionStore", () => ({ normalizeSummary: (row: SessionSummary) => row }));
vi.mock("../data/sessionListFeed", () => ({
  SESSION_LIST_MAX_LIMIT: 2000,
  listSessionPage: feed.page,
  countSessions: feed.counts,
  sessionListFeedRevision: feed.revision,
}));
const merged = vi.hoisted(() => vi.fn());
vi.mock("../model/globalRecentSessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/globalRecentSessions")>();
  return {
    ...actual,
    mergeGlobalRecentSessions: (...args: Parameters<typeof actual.mergeGlobalRecentSessions>) => {
      merged();
      return actual.mergeGlobalRecentSessions(...args);
    },
  };
});

let history: SessionSummary[] = [];
let sessions: Session[] = [];
let enabled = true;
let allowed = new Set(["/visible"]);
let remoteRows: SessionSummary[] = [];
let freshRemoteProjects: string[] = [];
let result: ReturnType<typeof useGlobalRecentSessions>;
let renders = 0;
function Probe() {
  renders++;
  const current = useGlobalRecentSessions(
    history,
    sessions,
    enabled,
    allowed,
    remoteRows,
    freshRemoteProjects,
  );
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
const NOW = 1_800_000_000_000;
const row: SessionSummary = {
  id: "a",
  cwd: "/visible",
  title: "A",
  harness: "codex",
  model: "m",
  runtimeMode: "supervised",
  createdAt: NOW,
  updatedAt: NOW,
};

// A small in-memory stand-in for the native list: same filters, keyset order and paging.
let db: SessionSummary[] = [];
let revision = 1;
let pageCap = 2000;
const activity = (item: SessionSummary) => item.lastActivityAt ?? item.updatedAt;
function matching(query: SessionListQuery): SessionSummary[] {
  const marks = new Set((query.settled ?? []).map((mark) => mark.id));
  return db
    .filter(
      (item) =>
        !!item.pinned === query.pinned &&
        !!item.archived === !!query.archived &&
        (query.since === undefined || activity(item) >= query.since) &&
        (!query.cwds || query.cwds.includes(item.cwd)) &&
        (!query.title || item.title.toLowerCase().includes(query.title.toLowerCase())) &&
        (query.settledMode === undefined || marks.has(item.id) === (query.settledMode === "only")),
    )
    .sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
}
const item = (id: string, patch: Partial<SessionSummary> = {}): SessionSummary => ({
  ...row,
  id,
  title: id,
  ...patch,
});
const numbered = (count: number, patch: Partial<SessionSummary> = {}) =>
  Array.from({ length: count }, (_, index) =>
    item(`s${String(index).padStart(3, "0")}`, { updatedAt: NOW - index * 1000, ...patch }),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  db = [];
  revision = 1;
  pageCap = 2000;
  feed.page.mockImplementation(async (query: SessionListQuery, cursor) => {
    const all = matching(query);
    const start = cursor ? all.findIndex((entry) => entry.id === cursor.id) + 1 : 0;
    const limit = Math.min(query.limit ?? 100, pageCap);
    const rows = all.slice(start, start + limit);
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        last && start + limit < all.length ? { activityAt: activity(last), id: last.id } : null,
      revision,
    };
  });
  feed.counts.mockImplementation(async (query: SessionListQuery) => {
    const all = matching(query);
    const groups = new Map<string, { cwd: string; count: number; latestActivityAt: number }>();
    for (const entry of all) {
      const group = groups.get(entry.cwd) ?? {
        cwd: entry.cwd,
        count: 0,
        latestActivityAt: 0,
      };
      group.count++;
      group.latestActivityAt = Math.max(group.latestActivityAt, activity(entry));
      groups.set(entry.cwd, group);
    }
    return { groups: [...groups.values()], total: all.length, revision };
  });
  feed.revision.mockImplementation(async () => revision);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setSessionLifecycleList({ records: [], autoSettle: { afterDays: 7, archiveAfterDays: 30 } });
  enabled = true;
  history = [];
  sessions = [];
  allowed = new Set(["/visible"]);
  remoteRows = [];
  freshRemoteProjects = [];
});

async function mount() {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  await settle(0);
  return root;
}
const settle = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const pageQueries = (): SessionListQuery[] => feed.page.mock.calls.map((call) => call[0]);
const ids = () => result.rows.map((entry) => entry.id).sort();

it("uses fresh remote lists, including an empty one, and keeps the note for partial coverage", async () => {
  const online = "remote://online/visible";
  const offline = "remote://offline/visible";
  allowed = new Set(["/visible", online, offline]);
  history = [row, { ...row, cwd: online, id: "removed" }];
  remoteRows = [{ ...row, cwd: offline, id: "cached" }];
  freshRemoteProjects = [online];
  const root = await mount();
  try {
    expect(ids()).toEqual(["a", "cached"]);
    expect(result.remoteHistoryLimited).toBe(true);
    freshRemoteProjects = [online, offline];
    remoteRows = [{ ...row, cwd: offline, id: "live" }];
    await act(async () => root.render(createElement(Probe)));
    expect(ids()).toEqual(["a", "live"]);
    expect(result.remoteHistoryLimited).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it("builds no projection and makes no request while closed, and opens with current rows", async () => {
  enabled = false;
  const live = (title: string): Session => ({
    ...newSession("codex", "/visible"),
    id: "live",
    title,
    blocks: [{ id: "u", role: "user", text: "hello", startedAt: NOW }],
  });
  const root = await mount();
  try {
    for (let index = 0; index < 4; index++) {
      history = [{ ...row, id: `h${index}` }];
      sessions = [live(`Live ${index}`)];
      await act(async () => root.render(createElement(Probe)));
    }
    await settle(120_000);
    expect(merged).not.toHaveBeenCalled();
    expect(feed.page).not.toHaveBeenCalled();
    expect(feed.counts).not.toHaveBeenCalled();
    expect(feed.revision).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    sessions = [live("Live now")];
    history = [{ ...row, id: "h-now" }];
    enabled = true;
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows.map((entry) => entry.id).sort()).toEqual(["h-now", "live"]);
    expect(result.rows.find((entry) => entry.id === "live")?.title).toBe("Live now");
    enabled = false;
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows).toEqual([]);
    const callsClosed = merged.mock.calls.length;
    const requests = feed.page.mock.calls.length + feed.revision.mock.calls.length;
    sessions = [live("Live closed")];
    await act(async () => root.render(createElement(Probe)));
    await settle(10_000);
    expect(merged.mock.calls.length).toBe(callsClosed);
    expect(feed.page.mock.calls.length + feed.revision.mock.calls.length).toBe(requests);
  } finally {
    await act(async () => root.unmount());
  }
});

it("loads the pinned rows of any age completely, page by page, and nothing else", async () => {
  pageCap = 2;
  db = [
    ...numbered(5, { pinned: true, updatedAt: NOW - 400 * 86_400_000 }).map((entry, index) => ({
      ...entry,
      id: `pin${index}`,
      updatedAt: NOW - 400 * 86_400_000 - index,
    })),
    ...numbered(3),
  ];
  const root = await mount();
  try {
    expect(ids()).toEqual(["pin0", "pin1", "pin2", "pin3", "pin4"]);
    expect(pageQueries().filter((query) => query.pinned)).toHaveLength(3);
    expect(pageQueries().every((query) => query.pinned)).toBe(true);
    expect(pageQueries()[0]).not.toHaveProperty("since");
    expect(result.loading).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it("pages a segment by 30 on loadMore until it is done, then stops asking", async () => {
  db = numbered(70);
  const root = await mount();
  try {
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 0 });
    expect(result.rows).toHaveLength(0);
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 30 });
    expect(result.rows).toHaveLength(30);
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 60 });
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat")).toEqual({ status: "done", loaded: 70 });
    expect(result.rows).toHaveLength(70);
    const calls = feed.page.mock.calls.length;
    await act(async () => result.catalog.loadMore("flat"));
    expect(feed.page.mock.calls.length).toBe(calls);
    expect(pageQueries().at(-1)).toMatchObject({
      pinned: false,
      limit: 30,
      settledMode: "exclude",
    });
  } finally {
    await act(async () => root.unmount());
  }
});

it("lists projects from the native groups and loads each with every stored cwd variant", async () => {
  allowed = new Set(["/visible", "/other"]);
  db = [
    item("a1", { cwd: "/visible", updatedAt: NOW - 5000 }),
    item("a2", { cwd: "/visible/", updatedAt: NOW - 6000 }),
    item("b1", { cwd: "/other", updatedAt: NOW - 1000 }),
    item("hidden", { cwd: "/not-allowed", updatedAt: NOW }),
  ];
  const root = await mount();
  try {
    expect(result.catalog.projects).toEqual([
      { key: "/other", cwd: "/other", count: 1, latestActivityAt: NOW - 1000 },
      {
        key: "/visible",
        cwd: expect.stringMatching(/^\/visible\/?$/),
        count: 2,
        latestActivityAt: NOW - 5000,
      },
    ]);
    await act(async () => result.catalog.loadMore("project:/visible"));
    const query = pageQueries().at(-1)!;
    expect([...(query.cwds ?? [])].sort()).toEqual(["/visible", "/visible/"]);
    expect(result.catalog.segment("project:/visible")).toEqual({ status: "done", loaded: 2 });
    expect(ids()).toEqual(["a1", "a2"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("resets every segment when the owner changes the query and applies it to the requests", async () => {
  db = numbered(40);
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat").loaded).toBe(30);
    await act(async () => result.setQuery({ since: NOW - 10_500, title: "S0" }));
    await settle(0);
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 0 });
    expect(feed.counts.mock.calls.map((call) => call[0])).toContainEqual(
      expect.objectContaining({ since: NOW - 10_500, settledMode: "exclude" }),
    );
    expect(pageQueries().at(-1)).toMatchObject({ pinned: true, title: "S0" });
    await act(async () => result.catalog.loadMore("flat"));
    expect(pageQueries().at(-1)).toMatchObject({ since: NOW - 10_500, title: "S0" });
    expect(result.catalog.segment("flat")).toEqual({ status: "done", loaded: 11 });
    const calls = feed.counts.mock.calls.length;
    await act(async () => result.setQuery({ since: NOW - 10_500, title: "S0" }));
    await settle(0);
    expect(feed.counts.mock.calls.length).toBe(calls);
  } finally {
    await act(async () => root.unmount());
  }
});

it("resets on an archived change, forwards the flag to every query and lists archived rows only", async () => {
  db = [...numbered(5), item("old1", { archived: true }), item("old2", { archived: true })];
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    expect(ids()).toEqual(["s000", "s001", "s002", "s003", "s004"]);
    expect(pageQueries().every((query) => !query.archived)).toBe(true);
    await act(async () => result.setQuery({ archived: true }));
    await settle(0);
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 0 });
    expect(feed.counts.mock.calls.map((call) => call[0])).toContainEqual(
      expect.objectContaining({ archived: true, settledMode: "exclude" }),
    );
    expect(feed.counts.mock.calls.map((call) => call[0])).toContainEqual(
      expect.objectContaining({ archived: true, settledMode: "only" }),
    );
    expect(pageQueries().at(-1)).toMatchObject({ pinned: true, archived: true });
    await act(async () => result.catalog.loadMore("flat"));
    expect(pageQueries().at(-1)).toMatchObject({ pinned: false, archived: true });
    expect(ids().sort()).toEqual(["old1", "old2"]);
    const calls = feed.counts.mock.calls.length;
    await act(async () => result.setQuery({ archived: true }));
    await settle(0);
    expect(feed.counts.mock.calls.length).toBe(calls);
    await act(async () => result.setQuery({}));
    await settle(0);
    expect(result.catalog.segment("flat")).toEqual({ status: "idle", loaded: 0 });
  } finally {
    await act(async () => root.unmount());
  }
});

it("re-queries loaded segments with their loaded count when the revision changes, and keeps identity if nothing changed", async () => {
  db = numbered(100);
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat").loaded).toBe(60);
    const previous = result;
    const before = renders;
    revision++;
    await settle(2500);
    expect(pageQueries().at(-1)).toMatchObject({ pinned: false, limit: 60 });
    expect(result).toBe(previous);
    expect(renders - before).toBe(0);
    db = [item("fresh", { updatedAt: NOW + 5000 }), ...db];
    revision++;
    await settle(2500);
    expect(result.rows[0]?.id).toBeDefined();
    expect(result.rows.some((entry) => entry.id === "fresh")).toBe(true);
    expect(result.catalog.segment("flat").loaded).toBe(60);
    const calls = feed.page.mock.calls.length;
    await settle(10_000);
    expect(feed.page.mock.calls.length).toBe(calls);
  } finally {
    await act(async () => root.unmount());
  }
});

it("refetches loaded segments at least one page tall and on explicit refresh", async () => {
  db = numbered(3);
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    await act(async () => result.refresh());
    await settle(0);
    expect(pageQueries().at(-1)).toMatchObject({ pinned: false, limit: 30 });
  } finally {
    await act(async () => root.unmount());
  }
});

it("re-queries on settled records changing without resetting the loaded segments", async () => {
  db = numbered(10);
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat").loaded).toBe(10);
    expect(result.catalog.settledCount).toBe(0);
    act(() =>
      setSessionLifecycleList({
        records: [
          {
            sessionId: "s001",
            state: "settled",
            participants: [],
            settledAt: NOW,
            settledBy: "owner",
          },
        ],
        autoSettle: { afterDays: 7, archiveAfterDays: 30 },
      }),
    );
    await settle(0);
    expect(result.catalog.segment("flat").loaded).toBe(10);
    await settle(600);
    expect(pageQueries().at(-1)).toMatchObject({
      settledMode: "exclude",
      settled: [{ id: "s001", settledAt: NOW }],
    });
    expect(result.catalog.segment("flat")).toEqual({ status: "done", loaded: 9 });
    expect(result.catalog.settledCount).toBe(1);
    await act(async () => result.catalog.loadMore("settled"));
    expect(pageQueries().at(-1)).toMatchObject({ settledMode: "only" });
    expect(pageQueries().at(-1)).not.toHaveProperty("since");
    expect(ids()).toContain("s001");
  } finally {
    await act(async () => root.unmount());
  }
});

it("fills a page that came back short after owner-fence filtering", async () => {
  db = numbered(10);
  let first = true;
  const base = feed.page.getMockImplementation()!;
  feed.page.mockImplementation(async (query: SessionListQuery, cursor) => {
    const page = await base(query, cursor);
    if (query.pinned || !first) return page;
    first = false;
    // The first page lost three fenced rows, but the native list goes on.
    const kept = page.rows.slice(0, 2);
    return { ...page, rows: kept, nextCursor: { activityAt: 1, id: kept[1].id } };
  });
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.catalog.segment("flat").loaded).toBe(10);
    expect(result.catalog.segment("flat").status).toBe("done");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps the previous rows and shows the error when a refresh fails, then recovers", async () => {
  db = numbered(3);
  const root = await mount();
  try {
    await act(async () => result.catalog.loadMore("flat"));
    expect(result.rows).toHaveLength(3);
    feed.page.mockRejectedValueOnce(new Error("offline"));
    await act(async () => result.refresh());
    await settle(0);
    expect(result.rows).toHaveLength(3);
    expect(result.error).toContain("offline");
    expect(result.loading).toBe(false);
    await settle(3000);
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
  }
});

it("retries a five-second local Host restart without publishing an error", async () => {
  db = [row];
  const started = Date.now();
  const base = feed.counts.getMockImplementation()!;
  feed.counts.mockImplementation(async (query: SessionListQuery) => {
    if (Date.now() - started < 5_000) throw new Error("Host database is closing.");
    return base(query);
  });
  const root = await mount();
  try {
    expect(result.loading).toBe(true);
    expect(result.error).toBeNull();
    await settle(2_500);
    expect(result.error).toBeNull();
    await settle(6_000);
    expect(result.error).toBeNull();
    expect(result.loading).toBe(false);
    expect(result.catalog.projects).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});
