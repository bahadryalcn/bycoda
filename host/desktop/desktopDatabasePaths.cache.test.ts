import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedDesktopDatabasePaths, desktopDatabasePathsFresh } from "./desktopSessions";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

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
});
