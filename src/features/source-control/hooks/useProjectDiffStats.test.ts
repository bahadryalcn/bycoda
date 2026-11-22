// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  stats: vi.fn(),
  full: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffStats: api.stats,
  gitDiffIndex: api.full,
  gitDiffFiles: vi.fn(),
  notifyGitChanged: () => api.listeners.forEach((listener) => listener()),
  subscribeGitChanged: (listener: () => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));

import {
  applyProjectDiffStats,
  useProjectDiffStats,
  useProjectsDiffStats,
} from "./useProjectDiffStats";
import { fetchGitIndex, resetGitIndexStore, notifyGitChangedWith } from "../model/gitIndexStore";

let root: Root;
let container: HTMLDivElement;
let cwd: string;
let serial = 0;
const original = { files: 1, additions: 2, deletions: 3 };

function View({ foreground = true }: { foreground?: boolean }) {
  const stats = useProjectDiffStats(cwd, true, foreground);
  return createElement("output", null, stats ? `${stats.files}:${stats.additions}` : "unknown");
}
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const changed = () => act(async () => api.listeners.forEach((listener) => listener()));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  resetGitIndexStore();
  cwd = `/stats-policy-${serial++}`;
  api.stats.mockReset().mockResolvedValue(original);
  api.full.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shares reads between the rail and active project, checking at three minutes", async () => {
  await act(async () =>
    root.render(
      createElement("div", null, createElement(View, { foreground: false }), createElement(View)),
    ),
  );
  expect(api.stats).toHaveBeenCalledTimes(1);
  await advance(179_999);
  expect(api.stats).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api.stats).toHaveBeenCalledTimes(2);
});

it("checks background projects at twenty minutes and does not refresh on every focus", async () => {
  await act(async () => root.render(createElement(View, { foreground: false })));
  await advance(19 * 60_000);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(api.stats).toHaveBeenCalledTimes(1);
  await advance(60_000);
  expect(api.stats).toHaveBeenCalledTimes(2);
});

it("updates the schedule when a background project becomes active", async () => {
  await act(async () => root.render(createElement(View, { foreground: false })));
  await advance(4 * 60_000);
  await act(async () => root.render(createElement(View)));
  expect(api.stats).toHaveBeenCalledTimes(2);
  await advance(3 * 60_000);
  expect(api.stats).toHaveBeenCalledTimes(3);
});

it("defers scans and known changes while hidden, then refreshes once on return", async () => {
  await act(async () => root.render(createElement(View)));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await changed();
  await advance(30 * 60_000);
  expect(api.stats).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(api.stats).toHaveBeenCalledTimes(2);
});

it("keeps the last successful counts after a failure and throttles focus retries", async () => {
  await act(async () => root.render(createElement(View)));
  api.stats.mockRejectedValue(new Error("offline"));
  await advance(3 * 60_000);
  expect(container.textContent).toBe("1:2");
  await act(async () => {
    for (let i = 0; i < 10; i++) window.dispatchEvent(new Event("focus"));
  });
  expect(api.stats).toHaveBeenCalledTimes(2);
  await advance(3 * 60_000);
  expect(api.stats).toHaveBeenCalledTimes(3);
});

it("uses fresh full indexes and observed updates without a second summary read", async () => {
  api.full.mockResolvedValue({
    files: [{ path: "one" }],
    conflicts: [],
    additions: 8,
    deletions: 0,
  });
  await fetchGitIndex(cwd, { full: true });
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toBe("1:8");
  expect(api.stats).not.toHaveBeenCalled();
  await act(async () => notifyGitChangedWith(cwd, "index", { observed: true }));
  expect(api.stats).not.toHaveBeenCalled();
});

it("refreshes known changes immediately but ignores an older in-flight summary", async () => {
  await act(async () => root.render(createElement(View)));
  let finish!: (value: typeof original) => void;
  api.stats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await changed();
  expect(api.stats).toHaveBeenCalledTimes(2);
  await act(async () => applyProjectDiffStats(cwd, { files: 9, additions: 90, deletions: 0 }));
  await act(async () => finish(original));
  expect(container.textContent).toBe("9:90");
});

it("shares in-flight manual refreshes and reloads for a subsequent repository mutation", async () => {
  await act(async () => root.render(createElement(View)));
  let finish!: (value: typeof original) => void;
  const manual = () => notifyGitChangedWith(cwd, "checkout", { refresh: true });
  api.stats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => manual());
  await act(async () => manual());
  await act(async () => finish(original));
  expect(api.stats).toHaveBeenCalledTimes(2);

  api.stats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => manual());
  await changed();
  await act(async () => manual());
  expect(api.stats).toHaveBeenCalledTimes(3);
  api.stats.mockResolvedValue({ ...original, additions: 12 });
  await act(async () => finish(original));
  expect(api.stats).toHaveBeenCalledTimes(4);
  expect(container.textContent).toBe("1:12");
});

it("stops polling after the final consumer leaves", async () => {
  await act(async () => root.render(createElement(View)));
  await act(async () => root.render(null));
  await advance(30 * 60_000);
  expect(api.stats).toHaveBeenCalledTimes(1);
});

it("retains a Git change while the last subscriber leaves and returns during a read", async () => {
  let complete!: (stats: typeof original) => void;
  api.stats.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await act(async () => root.render(createElement(View)));
  await changed();
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(View)));
  api.stats.mockResolvedValue({ ...original, additions: 9 });
  await act(async () => complete(original));
  expect(api.stats).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe("1:9");
});

it("loads all 20 project summaries while starting only four reads per machine at once", async () => {
  const paths = Array.from({ length: 20 }, (_, index) => `${cwd}/${index}`);
  const finish = new Map<string, (value: typeof original) => void>();
  api.stats.mockImplementation(
    (path: string) => new Promise((resolve) => finish.set(path, resolve)),
  );
  function Overview() {
    return useProjectsDiffStats(paths, true)
      .map((stats) => stats?.additions ?? "-")
      .join(",");
  }
  await act(async () => root.render(createElement(Overview)));
  const initiallyStarted = api.stats.mock.calls.length;
  for (let batch = 0; batch < 5; batch += 1) {
    await act(async () => {
      for (const [path, resolve] of finish) {
        finish.delete(path);
        resolve({ ...original, additions: paths.indexOf(path) });
      }
    });
  }
  expect(initiallyStarted).toBe(4);
  expect(api.stats).toHaveBeenCalledTimes(20);
  expect(container.textContent).toBe(paths.map((_, index) => index).join(","));
});

it("prioritizes focused reads and drops queued work after its last subscriber leaves", async () => {
  const paths = Array.from({ length: 7 }, (_, index) => `${cwd}/${index}`);
  const finish: ((value: typeof original) => void)[] = [];
  api.stats.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  function Background({ paths: visible }: { paths: readonly string[] }) {
    useProjectsDiffStats(visible, true);
    return null;
  }
  function Focus({ path }: { path: string }) {
    useProjectDiffStats(path, true);
    return null;
  }
  const view = (visible: readonly string[], focused: boolean) =>
    createElement(
      "div",
      null,
      createElement(Background, { paths: visible }),
      focused ? createElement(Focus, { path: paths[6] }) : null,
    );
  await act(async () => root.render(view(paths, true)));
  const started = api.stats.mock.calls.map(([path]) => path);
  await act(async () => root.render(view(paths.slice(0, 5), true)));
  await act(async () => finish.splice(0).forEach((resolve) => resolve(original)));
  await act(async () => finish.splice(0).forEach((resolve) => resolve(original)));
  expect(started).toEqual([paths[6], ...paths.slice(0, 3)]);
  expect(api.stats.mock.calls.map(([path]) => path)).toEqual([paths[6], ...paths.slice(0, 5)]);
});

it("publishes line-only overview updates and keeps identical snapshots stable", async () => {
  let renders = 0;
  applyProjectDiffStats(cwd, original);
  function Overview() {
    renders += 1;
    const [stats] = useProjectsDiffStats([cwd], true);
    return `${stats?.files}:${stats?.additions}:${stats?.deletions}`;
  }
  await act(async () => root.render(createElement(Overview)));
  expect(container.textContent).toBe("1:2:3");
  const additions = { ...original, additions: 9 };
  await act(async () => applyProjectDiffStats(cwd, additions));
  expect(container.textContent).toBe("1:9:3");
  const deletions = { ...additions, deletions: 7 };
  await act(async () => applyProjectDiffStats(cwd, deletions));
  expect(container.textContent).toBe("1:9:7");
  const before = renders;
  await act(async () => applyProjectDiffStats(cwd, { ...deletions }));
  expect(renders).toBe(before);
});
