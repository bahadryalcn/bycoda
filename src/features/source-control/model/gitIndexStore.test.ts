// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  full: vi.fn(),
  files: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffIndex: api.full,
  gitDiffFiles: api.files,
  notifyGitChanged: () => {
    for (const listener of [...api.listeners]) listener();
  },
  subscribeGitChanged: (listener: () => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));

import {
  GIT_INDEX_FRESH_MS,
  fetchGitIndex,
  invalidateGitIndex,
  notifyGitChangedWith,
  resetGitIndexStore,
} from "./gitIndexStore";

const index = (head: string) => ({ head, files: [] }) as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  resetGitIndexStore();
  api.full.mockReset();
  api.files.mockReset();
  api.full.mockResolvedValue(index("full"));
  api.files.mockResolvedValue(index("files"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("fetchGitIndex", () => {
  it("runs one command for requests made while it is in flight", async () => {
    const gate = deferred<unknown>();
    api.files.mockReturnValue(gate.promise);
    const a = fetchGitIndex("/r");
    const b = fetchGitIndex("/r");
    gate.resolve(index("one"));
    expect(await a).toBe(await b);
    expect(api.files).toHaveBeenCalledTimes(1);
  });

  it("answers from the result until it is no longer fresh", async () => {
    await fetchGitIndex("/r");
    vi.advanceTimersByTime(GIT_INDEX_FRESH_MS - 1);
    await fetchGitIndex("/r");
    expect(api.files).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await fetchGitIndex("/r");
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("honours an explicit `since` for results", async () => {
    await fetchGitIndex("/r");
    vi.advanceTimersByTime(900);
    await fetchGitIndex("/r", { since: Date.now() - 1000 });
    expect(api.files).toHaveBeenCalledTimes(1);
    await fetchGitIndex("/r", { since: Date.now() });
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("lets a full result answer a files request, not the reverse", async () => {
    await fetchGitIndex("/r", { full: true });
    await fetchGitIndex("/r");
    expect(api.files).not.toHaveBeenCalled();
    resetGitIndexStore();
    await fetchGitIndex("/r");
    await fetchGitIndex("/r", { full: true });
    expect(api.full).toHaveBeenCalledTimes(2);
    expect(api.files).toHaveBeenCalledTimes(1);
  });

  it("keeps checkouts apart", async () => {
    await fetchGitIndex("/a");
    await fetchGitIndex("/b");
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("does not cache or share a failure", async () => {
    api.files.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchGitIndex("/r")).rejects.toThrow("boom");
    await expect(fetchGitIndex("/r")).resolves.toBeTruthy();
    expect(api.files).toHaveBeenCalledTimes(2);
  });
});

describe("invalidation", () => {
  it("drops the result so the next request reads git", async () => {
    await fetchGitIndex("/r");
    invalidateGitIndex();
    await fetchGitIndex("/r");
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("keeps a request begun before a mutation from being joined or stored", async () => {
    const stale = deferred<unknown>();
    api.files.mockReturnValueOnce(stale.promise);
    const before = fetchGitIndex("/r");
    invalidateGitIndex();
    const after = fetchGitIndex("/r");
    expect(api.files).toHaveBeenCalledTimes(2);
    await expect(after).resolves.toMatchObject({ head: "files" });
    stale.resolve(index("stale"));
    await before;
    // The stale answer did not replace the post-mutation one.
    await expect(fetchGitIndex("/r")).resolves.toMatchObject({ head: "files" });
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("is triggered by a git-changed event that was not observed", async () => {
    await fetchGitIndex("/r");
    notifyGitChangedWith("/r", "index", { paths: ["/r/a.ts"] });
    await fetchGitIndex("/r");
    expect(api.files).toHaveBeenCalledTimes(2);
  });

  it("is skipped for an event announcing what the store just read", async () => {
    await fetchGitIndex("/r", { full: true });
    notifyGitChangedWith("/r", "index", { observed: true });
    await fetchGitIndex("/r");
    expect(api.full).toHaveBeenCalledTimes(1);
    expect(api.files).not.toHaveBeenCalled();
  });
});
