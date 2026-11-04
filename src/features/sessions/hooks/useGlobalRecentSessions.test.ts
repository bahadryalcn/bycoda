// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../data/sessionStore";
import { useGlobalRecentSessions } from "./useGlobalRecentSessions";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("../data/sessionStore", () => ({
  listRecentSessionsSincePage: fetch,
  finalizeRecentSessionPages: (rows: SessionSummary[]) => rows,
}));
let history: SessionSummary[] = [];
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
  history = [];
  allowed = new Set(["/visible"]);
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
