import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "../../../platform/tauri/fs";
import {
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  saveExpanded,
  subscribeDirListings,
  subscribeDirsChanged,
  verifiedDirAt,
  windowEntries,
} from "./fileTree";

const root = "/tmp/empty-project";

function entry(name: string): FsEntry {
  return {
    name,
    path: `${root}/${name}`,
    isDir: false,
    ignored: false,
  };
}

const listDir = vi.fn<(path: string) => Promise<FsEntry[]>>();

vi.mock("../../../platform/tauri/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../platform/tauri/fs")>();
  return {
    ...actual,
    listDir: (path: string) => listDir(path),
  };
});

describe("fileTree cache", () => {
  it("backs off unchanged polls and bypasses the delay for a real change notification", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValue([]);
    const stop = subscribeDirsChanged(() => {}, root);
    await listCachedDir(root);
    await refreshCachedDirs([root], true);
    const reads = listDir.mock.calls.length;
    await refreshCachedDirs([root], true);
    expect(listDir.mock.calls.length).toBe(reads);
    await vi.advanceTimersByTimeAsync(6000);
    await refreshCachedDirs([root], true);
    expect(listDir.mock.calls.length).toBe(reads + 1);
    listDir.mockResolvedValue([entry("created.ts")]);
    notifyDirsChanged(root);
    await vi.advanceTimersByTimeAsync(150);
    expect(peekDir(root)?.[0].name).toBe("created.ts");
    stop();
  });
  it("retires an uncached read when its folder is collapsed", async () => {
    const folder = `${root}/pending`;
    saveExpanded(root, new Set([root, folder]));
    let resolve!: (entries: FsEntry[]) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = listCachedDir(folder);
    saveExpanded(root, new Set([root]));
    resolve([entry("late.ts")]);
    await pending;
    expect(peekDir(folder)).toBeNull();
  });

  it("keeps the last remote listing on connection loss, but not after eviction", async () => {
    const remote = "remote://env/home/project";
    try {
      listDir.mockResolvedValueOnce([entry("offline.ts")]);
      await listCachedDir(remote);
      listDir.mockRejectedValueOnce(
        new Error("Machine is unreachable. Check the host and SSH tunnel, then reconnect."),
      );
      await expect(refreshDir(remote)).rejects.toThrow("unreachable");
      expect(peekDir(remote)).toEqual([entry("offline.ts")]);
      let reject!: (error: Error) => void;
      listDir.mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      const pending = refreshDir(remote);
      forgetDir(remote);
      reject(new Error("Machine is unreachable. Check the host and SSH tunnel, then reconnect."));
      await expect(pending).rejects.toThrow("unreachable");
      expect(peekDir(remote)).toBeNull();
    } finally {
      forgetDir(remote);
    }
  });

  it("updates verification time after successful reads without advancing it on failure", async () => {
    vi.useFakeTimers();
    const remote = "remote://env/home/verification-project";
    try {
      listDir.mockResolvedValueOnce([entry("verified.ts")]);
      const initial = await listCachedDir(remote);
      const verifiedAt = verifiedDirAt(remote);
      expect(verifiedAt).toBe(Date.now());

      await vi.advanceTimersByTimeAsync(1_000);
      listDir.mockResolvedValueOnce([entry("verified.ts")]);
      await refreshDir(remote);
      expect(peekDir(remote)).toBe(initial);
      expect(verifiedDirAt(remote)).toBe(Date.now());
      expect(verifiedDirAt(remote)).toBeGreaterThan(verifiedAt!);

      const successfulReadAt = verifiedDirAt(remote);
      await vi.advanceTimersByTimeAsync(1_000);
      listDir.mockRejectedValueOnce(
        new Error("Machine is unreachable. Check the host and SSH tunnel, then reconnect."),
      );
      await expect(refreshDir(remote)).rejects.toThrow("unreachable");
      expect(peekDir(remote)).toBe(initial);
      expect(verifiedDirAt(remote)).toBe(successfulReadAt);
    } finally {
      forgetDir(remote);
      vi.useRealTimers();
    }
  });
  it("drops collapsed descendants and refreshes only visible folders", async () => {
    const folder = `${root}/folder`;
    const child = `${folder}/child`;
    saveExpanded(root, new Set([root, folder, child]));
    const stop = subscribeDirsChanged(() => {}, root);
    try {
      listDir.mockResolvedValue([]);
      await Promise.all([root, folder, child].map(listCachedDir));
      saveExpanded(root, new Set([root, child]));
      expect(peekDir(folder)).toBeNull();
      expect(peekDir(child)).toBeNull();
      listDir.mockClear();
      await refreshCachedDirs([root]);
      expect(listDir.mock.calls).toEqual([[root]]);
      saveExpanded(root, new Set([root, folder, child]));
      await listCachedDir(folder);
      expect(listDir.mock.calls).toEqual([[root], [folder]]);
      saveExpanded(root, new Set([folder, child]));
      expect(peekDir(folder)).toBeNull();
      expect(peekDir(root)).toEqual([]);
    } finally {
      stop();
    }
  });

  it("retains a shared root until its last explorer unmounts", async () => {
    const a = subscribeDirsChanged(() => {}, root);
    const b = subscribeDirsChanged(() => {}, root);
    listDir.mockResolvedValue([]);
    await listCachedDir(root);
    a();
    expect(peekDir(root)).toEqual([]);
    b();
    expect(peekDir(root)).toBeNull();
  });

  it("deduplicates reads but a refresh supersedes the old response", async () => {
    let resolveOld!: (entries: FsEntry[]) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = listCachedDir(root);
    expect(listCachedDir(root)).toBe(old);
    listDir.mockResolvedValueOnce([entry("new.ts")]);
    await refreshDir(root);
    resolveOld([entry("old.ts")]);
    await old;
    expect(peekDir(root)).toEqual([entry("new.ts")]);
  });

  it("never restores a forgotten pending read or an unchanged refresh", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    let resolve!: (entries: FsEntry[]) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const refreshing = refreshCachedDirs();
    forgetDir(root);
    resolve([]);
    expect(await refreshing).toEqual([]);
    expect(peekDir(root)).toBeNull();
  });

  it("a stale failure cannot remove a newer listing", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    let reject!: (error: Error) => void;
    listDir.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const stale = refreshCachedDirs();
    listDir.mockResolvedValueOnce([entry("fresh.ts")]);
    await refreshDir(root);
    reject(new Error("gone"));
    expect(await stale).toEqual([]);
    expect(peekDir(root)).toEqual([entry("fresh.ts")]);
  });
  it("refreshes only the requested root and bounds concurrent folder reads", async () => {
    const current = `${root}/current`;
    const old = `${root}/old`;
    listDir.mockResolvedValue([]);
    await Promise.all(
      [old, ...Array.from({ length: 10 }, (_, i) => `${current}/${i}`)].map(listCachedDir),
    );
    listDir.mockClear();
    let active = 0;
    let peak = 0;
    listDir.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active--;
      return [];
    });
    expect(await refreshCachedDirs([current])).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(10);
    expect(listDir.mock.calls.some(([path]) => path === old)).toBe(false);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("does not publish unchanged listings or notify unrelated roots", async () => {
    vi.useFakeTimers();
    const a = `${root}/A`;
    const b = `${root}/B`;
    listDir.mockResolvedValue([]);
    await listCachedDir(a);
    await listCachedDir(b);
    const changedA = vi.fn();
    const changedB = vi.fn();
    const stopA = subscribeDirsChanged(changedA, a);
    const stopB = subscribeDirsChanged(changedB, b);
    try {
      notifyDirsChanged(a, true);
      await vi.runAllTimersAsync();
      expect(changedA).not.toHaveBeenCalled();
      listDir.mockImplementation(async (path) => (path === a ? [entry("new.ts")] : []));
      // An actual agent/filesystem notification bypasses the unchanged-poll backoff.
      notifyDirsChanged(a);
      await vi.runAllTimersAsync();
      expect(changedA).toHaveBeenCalledTimes(1);
      expect(changedB).not.toHaveBeenCalled();
    } finally {
      stopA();
      stopB();
    }
  });
  beforeEach(() => {
    forgetDir(root);
    listDir.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the first listing until refreshDir", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    expect(peekDir(root)).toEqual([]);

    listDir.mockResolvedValueOnce([entry("hello.ts")]);
    expect(await listCachedDir(root)).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(1);

    expect(await refreshDir(root)).toEqual([entry("hello.ts")]);
    expect(peekDir(root)).toEqual([entry("hello.ts")]);
  });

  it("refreshCachedDirs re-lists every cached folder", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("created.ts")]);
    await refreshCachedDirs();
    expect(peekDir(root)).toEqual([entry("created.ts")]);
  });

  it("notifyDirsChanged refreshes the cache and tells listeners", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);

    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange);
    listDir.mockResolvedValueOnce([entry("from-agent.ts")]);
    notifyDirsChanged();
    expect(peekDir(root)).toEqual([]);

    await vi.runAllTimersAsync();
    expect(peekDir(root)).toEqual([entry("from-agent.ts")]);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps the listing array identity when a refresh finds no change", async () => {
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    const before = await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("a.ts")]);
    expect(await refreshCachedDirs()).toEqual([]);
    expect(peekDir(root)).toBe(before);

    listDir.mockResolvedValueOnce([entry("a.ts"), entry("b.ts")]);
    expect(await refreshCachedDirs()).toEqual([root]);
    expect(peekDir(root)).not.toBe(before);
  });

  it("notifies listing subscribers after a changed refresh", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    const onListing = vi.fn();
    const stop = subscribeDirListings(onListing);
    listDir.mockResolvedValueOnce([entry("x.ts")]);
    notifyDirsChanged();
    await vi.runAllTimersAsync();
    expect(onListing).toHaveBeenCalled();
    stop();
  });
});

describe("windowEntries", () => {
  const many = (count: number): FsEntry[] =>
    Array.from({ length: count }, (_, i) => entry(`f${i}.ts`));

  it("returns everything at or below the threshold", () => {
    const entries = many(300);
    expect(windowEntries(entries, 10, [])).toEqual({
      shown: entries,
      hidden: 0,
    });
  });

  it("cuts to the limit above the threshold, keeping order", () => {
    const { shown, hidden } = windowEntries(many(1000), 200, []);
    expect(shown).toHaveLength(200);
    expect(shown[0].name).toBe("f0.ts");
    expect(hidden).toBe(800);
  });

  it("keeps a selected entry past the cut and an open ancestor of it", () => {
    const entries = many(1000);
    entries[700] = { ...entry("dir"), isDir: true };
    const { shown, hidden } = windowEntries(entries, 200, [
      `${root}/f900.ts`,
      `${root}/dir/deep/file.ts`,
    ]);
    expect(shown.map((e) => e.name)).toContain("f900.ts");
    expect(shown.map((e) => e.name)).toContain("dir");
    expect(shown).toHaveLength(202);
    expect(hidden).toBe(798);
  });

  it("does not match a sibling that only shares a name prefix", () => {
    const entries = many(1000);
    entries[500] = { ...entry("src"), isDir: true };
    const { shown } = windowEntries(entries, 200, [`${root}/src2/a.ts`]);
    expect(shown.map((e) => e.name)).not.toContain("src");
  });

  it("shows everything once the limit reaches the length", () => {
    const entries = many(500);
    expect(windowEntries(entries, 500, []).hidden).toBe(0);
    expect(windowEntries(entries, Infinity, []).shown).toHaveLength(500);
  });
});
