// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { useGlobalRecentSessions } from "./useGlobalRecentSessions";
import { newSession, type Session } from "../model/session";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("../data/sessionStore", () => ({
  listRecentSessionsSincePage: fetch,
  finalizeRecentSessionPages: (rows: SessionSummary[]) => rows,
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
  history = [];
  sessions = [];
  allowed = new Set(["/visible"]);
  remoteRows = [];
  freshRemoteProjects = [];
});

it("uses fresh remote lists, including an empty one, and keeps the note for partial coverage", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const online = "remote://online/visible";
  const offline = "remote://offline/visible";
  allowed = new Set(["/visible", online, offline]);
  history = [row, { ...row, cwd: online, id: "removed" }];
  remoteRows = [{ ...row, cwd: offline, id: "cached" }];
  freshRemoteProjects = [online];
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows.map(({ id }) => id).sort()).toEqual(["a", "cached"]);
    expect(result.remoteHistoryLimited).toBe(true);
    freshRemoteProjects = [online, offline];
    remoteRows = [{ ...row, cwd: offline, id: "live" }];
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows.map(({ id }) => id).sort()).toEqual(["a", "live"]);
    expect(result.remoteHistoryLimited).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("does not render the owner for unchanged live provider history on a tick", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  sessions = [
    {
      ...newSession("codex", "/visible"),
      id: "live",
      blocks: [{ id: "u", role: "user", text: "hello", startedAt: Date.now() }],
    },
  ];
  fetch.mockResolvedValue({ rows: [], nextCursor: null });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const previous = result;
    const before = renders;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toBe(previous);
    expect(renders - before).toBe(0);
    sessions = [
      {
        ...sessions[0],
        runningModelTarget: { harness: "claude", model: "other", modelSettings: {} },
      },
    ];
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows[0].providerHistory?.activeHarness).toBe("claude");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("builds no projection while closed and has current rows in the render that opens it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  enabled = false;
  const live = (title: string): Session => ({
    ...newSession("codex", "/visible"),
    id: "live",
    title,
    blocks: [{ id: "u", role: "user", text: "hello", startedAt: Date.now() }],
  });
  fetch.mockResolvedValue({ rows: [], nextCursor: null });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    for (let index = 0; index < 4; index++) {
      history = [{ ...row, id: `h${index}` }];
      sessions = [live(`Live ${index}`)];
      await act(async () => root.render(createElement(Probe)));
    }
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(merged).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
    sessions = [live("Live now")];
    history = [{ ...row, id: "h-now" }];
    enabled = true;
    await act(async () => root.render(createElement(Probe)));
    // No timer advance: the fetch is still debounced, yet the live and history rows are current.
    expect(fetch).not.toHaveBeenCalled();
    expect(result.rows.map((item) => item.id).sort()).toEqual(["h-now", "live"]);
    expect(result.rows.find((item) => item.id === "live")?.title).toBe("Live now");
    // Closing again drops the rows and later session changes build nothing.
    enabled = false;
    await act(async () => root.render(createElement(Probe)));
    expect(result.rows).toEqual([]);
    const callsClosed = merged.mock.calls.length;
    sessions = [live("Live closed")];
    await act(async () => root.render(createElement(Probe)));
    expect(merged.mock.calls.length).toBe(callsClosed);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("does not merge again when the minute clock only expires a row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const now = Date.now();
  vi.setSystemTime(now);
  const recent = { ...row, updatedAt: now - 7 * 86400000 + 90_000 };
  fetch.mockImplementation(async () => ({ rows: [{ ...recent }], nextCursor: null }));
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.rows).toHaveLength(1);
    const before = merged.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.rows).toHaveLength(0);
    expect(merged.mock.calls.length).toBe(before);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps the result identity across an unchanged minute refresh and expires old rows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const now = Date.now();
  const recent = { ...row, updatedAt: now - 7 * 86400000 + 90_000 };
  fetch.mockImplementation(async () => ({ rows: [{ ...recent }], nextCursor: null }));
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const previous = result;
    const before = renders;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result).toBe(previous);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toBe(previous);
    expect(renders - before).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.rows).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shares cloned poll metadata but publishes nested changes even at the same updatedAt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let snapshot: SessionSummary = {
    ...row,
    linkedWorkItem: { repo: "acme/app", kind: "issue", number: 1, url: "https://example.com/1" },
    providerHistory: { providers: ["codex"], activeHarness: "codex" },
    recentPinTarget: { kind: "native", sessionId: row.id, cwd: row.cwd },
  };
  fetch.mockImplementation(async () => ({ rows: [structuredClone(snapshot)], nextCursor: null }));
  const root = createRoot(document.createElement("div"));
  const poll = async () => {
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
  };
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const previous = result;
    const before = renders;
    await poll();
    expect(result).toBe(previous);
    expect(renders - before).toBe(0);
    snapshot = { ...snapshot, linkedWorkItem: { ...snapshot.linkedWorkItem!, number: 2 } };
    await poll();
    expect(result.rows[0].linkedWorkItem?.number).toBe(2);
    snapshot = {
      ...snapshot,
      providerHistory: { providers: ["codex", "claude"], activeHarness: "claude" },
    };
    await poll();
    expect(result.rows[0].providerHistory?.activeHarness).toBe("claude");
    snapshot = { ...snapshot, recentPinTarget: null };
    await poll();
    expect(result.rows[0].recentPinTarget).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("updates metadata without rescanning stable activity, while new activity refreshes history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const original = { ...row, lastActivityAt: row.updatedAt };
  history = [original];
  fetch.mockResolvedValue({ rows: [original], nextCursor: null });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    for (let index = 1; index <= 4; index++) {
      history = [{ ...original, title: `Updated ${index}`, updatedAt: row.updatedAt + index }];
      await act(async () => root.render(createElement(Probe)));
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.rows[0].title).toBe("Updated 4");
    history = [{ ...history[0], lastActivityAt: original.lastActivityAt + 5 }];
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("ignores stale responses, applies privacy immediately, and retains rows on error", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  let resolveFirst!: (page: { rows: SessionSummary[]; nextCursor: null }) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
  );
  fetch.mockResolvedValueOnce({ rows: [row], nextCursor: null });
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
  await act(async () => {
    resolveFirst({ rows: [], nextCursor: null });
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
  fetch.mockResolvedValue({
    rows: [{ ...row, createdAt: started, updatedAt: started }],
    nextCursor: null,
  });
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

it("pages all recent records, ignores referential history churn and keeps prior rows on partial refresh failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fetch.mockImplementation(async (_since: number, cursor: { id: string } | null) => {
    const page = cursor ? Number(cursor.id) + 1 : 0;
    return {
      rows: Array.from({ length: 100 }, (_, index) => ({ ...row, id: `${page}-${index}` })),
      nextCursor: page < 10 ? { id: String(page), activityAt: 1, revision: 1 } : null,
    };
  });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.rows).toHaveLength(1100);
    expect(fetch).toHaveBeenCalledTimes(11);
    expect(new Set(fetch.mock.calls.map((call) => call[0])).size).toBe(1);
    history = [];
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(fetch).toHaveBeenCalledTimes(11);
    for (let i = 0; i < 3; i++) {
      history = [{ ...row, id: "0-0", updatedAt: row.updatedAt + i + 1 }];
      await act(async () => root.render(createElement(Probe)));
    }
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(22);
    expect(result.rows).toHaveLength(1100);
    fetch
      .mockReset()
      .mockResolvedValueOnce({ rows: [row], nextCursor: { id: "0", activityAt: 1, revision: 2 } })
      .mockRejectedValueOnce(new Error("page failed"));
    await act(async () => result.refresh());
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.loading).toBe(false);
    expect(result.rows).toHaveLength(1100);
    expect(result.error).toContain("page failed");
    fetch.mockReset().mockResolvedValue({ rows: [{ ...row, id: "recovered" }], nextCursor: null });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.rows.map((item) => item.id)).toContain("recovered");
    expect(result.rows.map((item) => item.id)).not.toContain("1-0");
    expect(result.error).toBeNull();
    enabled = false;
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("coalesces rapid changes while a page is still in flight", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let resolveFirst!: (value: { rows: SessionSummary[]; nextCursor: null }) => void;
  fetch
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValue({ rows: [row], nextCursor: null });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    for (let i = 0; i < 4; i++) {
      history = [{ ...row, updatedAt: row.updatedAt + i + 1 }];
      await act(async () => root.render(createElement(Probe)));
    }
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst({ rows: [{ ...row, id: "stale" }], nextCursor: null }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.rows.map((item) => item.id)).not.toContain("stale");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("restarts a changed snapshot without publishing mixed pages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fetch
    .mockResolvedValueOnce({
      rows: [{ ...row, id: "old" }],
      nextCursor: { id: "old", activityAt: 1, revision: 1 },
    })
    .mockRejectedValueOnce("RECENT_SESSIONS_CHANGED")
    .mockResolvedValueOnce({ rows: [{ ...row, id: "new" }], nextCursor: null });
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(result.rows.map((item) => item.id)).toEqual(["new"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[2][0]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("reports a readable retry message after repeated snapshot changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fetch.mockRejectedValue("RECENT_SESSIONS_CHANGED");
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.error).toBe("Recent sessions changed while loading. Retry shortly.");
    expect(result.loading).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
