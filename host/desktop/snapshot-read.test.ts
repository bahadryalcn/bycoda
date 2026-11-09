import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { HostSession } from "../../src/features/connections/model/protocol";
import {
  DesktopSessions,
  type DesktopSnapshotRecord,
  type DesktopStampRow,
} from "./desktopSessions";
import { readDesktopSnapshot, type DesktopReadSource } from "./snapshot-read";

const source: DesktopReadSource = {
  database: "/desktop/owner.db",
  physicalId: "1:2:3",
  cwd: "/project",
  harness: "codex",
};
const snapshot = (): DesktopSnapshotRecord => ({
  value: {
    revision: 10,
    createdAt: 1,
    projectId: "project",
    session: { id: "session", blocks: [{ id: "block", role: "assistant", text: "saved" }] },
  } as HostSession,
  stored: false,
  source: { ...source },
});
const stamp = (): DesktopStampRow => ({
  createdAt: 1,
  updatedAt: 10,
  stored: false,
  source: { ...source },
});

function read(
  record: DesktopSnapshotRecord | undefined,
  rows: DesktopStampRow[],
  duringStamp?: () => void,
) {
  const controller = new AbortController();
  const reads = {
    read: vi
      .fn()
      .mockResolvedValueOnce(record)
      .mockImplementationOnce(async () => {
        duringStamp?.();
        return rows;
      }),
  };
  const assertCurrent = vi.fn();
  const running = vi.fn(() => true);
  return {
    controller,
    reads,
    assertCurrent,
    running,
    run: () =>
      readDesktopSnapshot({
        reads,
        paths: () => [source.database],
        platform: "darwin",
        id: "session",
        projectId: "project",
        expectedProjectCwd: source.cwd,
        signal: controller.signal,
        assertCurrent,
        isRunning: running,
      }),
  };
}

describe("cancellable desktop snapshot consistency", () => {
  it.each([10, 11, 100])(
    "serves coherent original revision when same owner advances to %i",
    async (revision) => {
      const record = snapshot(),
        latest = stamp();
      latest.updatedAt = revision;
      const job = read(record, [latest]);
      const value = await job.run();
      expect(value?.revision).toBe(10);
      expect(value?.session.blocks).toEqual(record.value.session.blocks);
      expect(value?.status).toBe("running");
      expect(value?.session.busy).toBe(true);
      expect(value).not.toHaveProperty("source");
      expect(job.reads.read).toHaveBeenCalledTimes(2);
      expect(job.assertCurrent).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [
      "replaced database",
      (row: DesktopStampRow) => {
        row.source!.physicalId = "1:9:9";
      },
    ],
    [
      "different database",
      (row: DesktopStampRow) => {
        row.source!.database = "/desktop/mirror.db";
      },
    ],
    [
      "moved project",
      (row: DesktopStampRow) => {
        row.source!.cwd = "/different-project";
      },
    ],
    [
      "different provider",
      (row: DesktopStampRow) => {
        row.source!.harness = "claude";
      },
    ],
    [
      "new owner",
      (row: DesktopStampRow) => {
        row.createdAt = 2;
      },
    ],
    [
      "revision regression",
      (row: DesktopStampRow) => {
        row.updatedAt = 9;
      },
    ],
    [
      "invalid revision",
      (row: DesktopStampRow) => {
        row.updatedAt = NaN;
      },
    ],
    [
      "missing provenance",
      (row: DesktopStampRow) => {
        delete row.source;
      },
    ],
  ] as const)("refuses %s without retrying", async (_name, change) => {
    const latest = stamp();
    change(latest);
    const job = read(snapshot(), [latest]);
    await expect(job.run()).rejects.toMatchObject({ kind: "source-changed" });
    expect(job.reads.read).toHaveBeenCalledTimes(2);
    expect(job.running).not.toHaveBeenCalled();
  });

  it("refuses deleted owner", async () => {
    await expect(read(snapshot(), []).run()).rejects.toMatchObject({ kind: "source-changed" });
  });

  it("does not substitute later-saved mirror for earliest-created owner", async () => {
    const mirror = stamp();
    mirror.createdAt = 2;
    mirror.updatedAt = 999;
    mirror.source!.database = "/desktop/mirror.db";
    expect((await read(snapshot(), [mirror, stamp()]).run())?.revision).toBe(10);
    const older = stamp();
    older.createdAt = 0.5;
    older.source!.database = "/desktop/new-owner.db";
    await expect(read(snapshot(), [stamp(), older]).run()).rejects.toMatchObject({
      kind: "source-changed",
    });
  });

  it("checks cancellation before any read and after stamp before disclosure", async () => {
    const before = read(snapshot(), [stamp()]);
    before.controller.abort();
    await expect(before.run()).rejects.toMatchObject({ name: "AbortError" });
    expect(before.reads.read).not.toHaveBeenCalled();
    const after = read(snapshot(), [stamp()], () => after.controller.abort());
    await expect(after.run()).rejects.toMatchObject({ name: "AbortError" });
    expect(after.running).not.toHaveBeenCalled();
  });

  it("does not perform second read when session absent", async () => {
    const job = read(undefined, []);
    await expect(job.run()).resolves.toBeUndefined();
    expect(job.reads.read).toHaveBeenCalledTimes(1);
  });
});

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("captures same physical source and base cwd from actual snapshot and cancellable child reads", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-snapshot-source-"));
  const path = join(folder, "desktop.db");
  const database = new DatabaseSync(path);
  const desktop = new DesktopSessions(() => [path]);
  cleanup.push(async () => {
    await desktop.closeAsync();
    database.close();
    const target = resolve(folder);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-snapshot-source-")
    )
      throw new Error("Unexpected fixture directory");
    rmSync(target, { recursive: true, force: true });
  });
  database.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT,harness TEXT,model TEXT,model_settings TEXT,runtime_mode TEXT,title TEXT,provider_session_id TEXT,blocks_json TEXT,created_at INTEGER,updated_at INTEGER); CREATE TABLE in_flight_sessions(session_id TEXT PRIMARY KEY)",
  );
  database
    .prepare(
      "INSERT INTO sessions(id,cwd,harness,title,blocks_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("session", folder, "codex", "Saved", "[]", 1, 10);
  const record = desktop.readSnapshotRecord("session", "project", folder);
  const rows = desktop.readStampRows("session");
  expect(record?.source).toEqual(rows[0].source);
  expect(record?.source).toMatchObject({
    database: realpathSync(path),
    cwd: folder,
    harness: "codex",
  });
  expect(record?.source?.physicalId).toMatch(/^\d+:\d+:\d+$/);
  const value = await desktop.snapshotAsync(
    "session",
    "project",
    folder,
    new AbortController().signal,
  );
  expect(value?.revision).toBe(10);
  expect(value?.session.id).toBe("session");
  expect(value).not.toHaveProperty("source");
});
