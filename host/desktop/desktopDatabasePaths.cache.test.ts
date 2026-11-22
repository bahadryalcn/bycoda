import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedDesktopDatabasePaths, desktopDatabasePathsFresh } from "./desktopSessions";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync), statSync: vi.fn(actual.statSync) };
});
vi.mock("node:fs/promises", { spy: true });

describe("cachedDesktopDatabasePaths", () => {
  const saved = process.env.BYCODA_DESKTOP_DB;
  let dir: string;
  let database: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desktop-db-paths-"));
    database = join(dir, "bycoda.db");
    process.env.BYCODA_DESKTOP_DB = database;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:00Z"));
  });

  afterEach(async () => {
    vi.mocked(stat).mockRestore();
    vi.useRealTimers();
    if (saved === undefined) delete process.env.BYCODA_DESKTOP_DB;
    else process.env.BYCODA_DESKTOP_DB = saved;
    await rm(dir, { recursive: true, force: true });
  });

  it("serves the expired value without a sync disk check, then picks up a new database", async () => {
    // First call is synchronous: no database yet.
    expect(cachedDesktopDatabasePaths()).toEqual([]);
    await writeFile(database, "");

    // Past the 3 s TTL: the old value is returned at once with no existsSync on this thread.
    vi.setSystemTime(new Date("2026-11-21T10:00:04Z"));
    vi.mocked(existsSync).mockClear();
    expect(cachedDesktopDatabasePaths()).toEqual([]);
    expect(existsSync).not.toHaveBeenCalled();

    // The asynchronous refresh settles and the new file is returned.
    await vi.waitFor(() => expect(cachedDesktopDatabasePaths()).toEqual([database]));
    expect(existsSync).not.toHaveBeenCalled();
  });

  it("never serves an answer older than the age bound, sync or async", async () => {
    expect(cachedDesktopDatabasePaths()).toEqual([]);
    await writeFile(database, "");
    // Host started before the desktop DB existed; >30 s later the next call sees it.
    vi.setSystemTime(new Date("2026-11-21T10:01:00Z"));
    expect(await desktopDatabasePathsFresh()).toEqual([database]);
    await rm(database);
    vi.setSystemTime(new Date("2026-11-21T10:02:00Z"));
    expect(cachedDesktopDatabasePaths()).toEqual([]);
  });

  it("expires the last good answer after consecutive timeouts and recovers", async () => {
    await writeFile(database, "");
    expect(cachedDesktopDatabasePaths()).toEqual([database]);
    await rm(database);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-21T10:00:03Z"));
    vi.mocked(stat).mockImplementation(() => new Promise(() => {}));
    expect(cachedDesktopDatabasePaths()).toEqual([database]);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(cachedDesktopDatabasePaths()).toEqual([database]);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(stat).toHaveBeenCalledTimes(2);
    const expired = desktopDatabasePathsFresh();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await expired).toEqual([]);
    vi.mocked(stat).mockRestore();
    await writeFile(database, "");
    expect(await desktopDatabasePathsFresh()).toEqual([database]);
  });

  it("reuses an answer from an unreadable candidate for one TTL, then checks again", async () => {
    await writeFile(database, "");
    vi.mocked(statSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    // The candidate that could not be checked reads as absent, without throwing.
    expect(cachedDesktopDatabasePaths()).toEqual([]);
    const calls = vi.mocked(statSync).mock.calls.length;
    expect(cachedDesktopDatabasePaths()).toEqual([]);
    expect(vi.mocked(statSync).mock.calls.length).toBe(calls);
    vi.setSystemTime(new Date("2026-11-21T10:00:04Z"));
    expect(cachedDesktopDatabasePaths()).toEqual([database]);
  });
});
