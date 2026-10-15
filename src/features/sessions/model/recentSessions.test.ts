import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRecentSessions,
  formatRelative,
  liveSessionInfos,
  loadRecentSessionsPrefs,
  sameLiveSessionInfos,
  saveRecentSessionsPrefs,
  type LiveSessionInfo,
  type StoredSessionRow,
} from "./recentSessions";
import { newSession, type Session } from "./session";

const NOW = 10_000_000_000;
const REMOTE = "remote://env-1/home/me/app";

function stored(
  id: string,
  updatedAt: number,
  patch: Partial<StoredSessionRow> = {},
): StoredSessionRow {
  return {
    id,
    cwd: "/work/a",
    title: `claude · ${id}`,
    harness: "claude",
    model: "sonnet",
    updatedAt,
    ...patch,
  };
}

function live(id: string, patch: Partial<LiveSessionInfo> = {}): LiveSessionInfo {
  return {
    id,
    cwd: "/work/a",
    title: id,
    harness: "claude",
    model: "sonnet",
    activityAt: 0,
    ...patch,
  };
}

function build(rows: StoredSessionRow[], liveInfos: LiveSessionInfo[] = [], limit = 10) {
  return buildRecentSessions({
    stored: rows,
    live: liveInfos,
    projectKeys: new Set(["/work/a", "/work/b", REMOTE]),
    limit,
    now: NOW,
  });
}

describe("buildRecentSessions", () => {
  it("orders by last activity and strips the harness prefix from titles", () => {
    const rows = build([stored("old", 10), stored("new", 30), stored("mid", 20)]);
    expect(rows.map((row) => row.id)).toEqual(["new", "mid", "old"]);
    expect(rows[0].title).toBe("new");
  });

  it("keeps every pinned session on top and limits only the rest", () => {
    const rows = build(
      [
        stored("p-old", 1, { pinned: true }),
        stored("p-new", 5, { pinned: true }),
        stored("a", 40),
        stored("b", 30),
        stored("c", 20),
      ],
      [],
      2,
    );
    expect(rows.map((row) => row.id)).toEqual(["p-new", "p-old", "a", "b"]);
    expect(rows.slice(0, 2).every((row) => row.pinned)).toBe(true);
  });

  it("leaves out sessions of projects that are not on the rail", () => {
    const rows = build([stored("in", 2), stored("out", 3, { cwd: "/elsewhere" })]);
    expect(rows.map((row) => row.id)).toEqual(["in"]);
  });

  it("overlays live status and bumps a running session to the top", () => {
    const rows = build(
      [stored("busy", 5), stored("other", 50)],
      [live("busy", { status: "working", title: "Renamed" })],
    );
    expect(rows.map((row) => row.id)).toEqual(["busy", "other"]);
    expect(rows[0]).toMatchObject({
      status: "working",
      title: "Renamed",
      updatedAt: NOW,
    });
  });

  it("adds remote sessions the store does not hold, but not idle local ones", () => {
    const rows = build(
      [stored("saved", 50)],
      [
        live("remote", { cwd: REMOTE, activityAt: 70 }),
        live("idle-local", { activityAt: 90 }),
        live("fresh-local", { status: "working" }),
      ],
    );
    expect(rows.map((row) => row.id)).toEqual(["fresh-local", "remote", "saved"]);
    expect(rows.find((row) => row.id === "remote")).toMatchObject({
      remote: true,
      pinnable: false,
      updatedAt: 70,
    });
    expect(rows.find((row) => row.id === "saved")?.pinnable).toBe(true);
  });
});

describe("liveSessionInfos", () => {
  it("shows an adopted turn as working despite a transcript conflict", () => {
    const session = newSession("claude", "/work/a");
    session.blocks = [{ id: "u1", role: "user", text: "go" }];
    session.continuingElsewhere = true;
    session.adoptedSyncConflict = true;
    expect(liveSessionInfos([session])[0].status).toBe("working");
    session.continuingElsewhere = undefined;
    expect(liveSessionInfos([session])[0].status).toBeUndefined();
  });

  function chat(patch: Partial<Session> = {}): Session {
    const session = newSession("claude", "/work/a");
    return {
      ...session,
      blocks: [{ id: "u1", role: "user", text: "hi", startedAt: 100, durationMs: 50 }],
      ...patch,
    };
  }

  it("skips blank chats, drafts, internal workers and inbox asks", () => {
    const sessions = [
      chat({ id: "blank", blocks: [] }),
      chat({
        id: "draft",
        blocks: [{ id: "u", role: "user", text: "x", draft: true }],
      }),
      chat({ id: "worker", orchestrationLeadId: "lead" }),
      chat({ id: "kept" }),
    ];
    expect(liveSessionInfos(sessions).map((info) => info.id)).toEqual(["kept"]);
  });

  it("reports working, needs-input and unseen-finished states", () => {
    const infos = liveSessionInfos(
      [
        chat({ id: "working", busy: true }),
        chat({
          id: "asking",
          blocks: [
            { id: "u1", role: "user", text: "hi" },
            { id: "a", role: "approval", text: "", approval: { requestId: 1 } },
          ],
        }),
        chat({ id: "done" }),
        chat({ id: "idle" }),
      ],
      new Set(["done"]),
    );
    expect(infos.map((info) => info.status)).toEqual(["working", "input", "done", undefined]);
    expect(infos[3].activityAt).toBe(150);
  });

  it("compares by value", () => {
    expect(sameLiveSessionInfos([live("a")], [live("a")])).toBe(true);
    expect(sameLiveSessionInfos([live("a")], [live("a", { status: "done" })])).toBe(false);
  });
});

describe("recent sessions preferences", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
      configurable: true,
    });
  });

  it("defaults to the last 10, expanded", () => {
    expect(loadRecentSessionsPrefs()).toEqual({ collapsed: false, count: 10 });
  });

  it("round-trips and ignores a count that is not offered", () => {
    saveRecentSessionsPrefs({ collapsed: true, count: 20 });
    expect(loadRecentSessionsPrefs()).toEqual({ collapsed: true, count: 20 });
    localStorage.setItem("bycoda.lastSessions", JSON.stringify({ collapsed: false, count: 7 }));
    expect(loadRecentSessionsPrefs().count).toBe(10);
  });
});

describe("formatRelative", () => {
  it("is compact", () => {
    expect(formatRelative(NOW - 5_000, NOW)).toBe("now");
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe("2d");
    expect(formatRelative(0, NOW)).toBe("");
  });
});
