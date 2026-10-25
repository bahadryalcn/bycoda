import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { DesktopSessions } from "./desktopSessions";
import { DesktopLive } from "./desktopLive";
import { AsyncHostNotes } from "./host-notes-async";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-desktop-owner-")),
    path = join(folder, "desktop.db");
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE sessions(id TEXT PRIMARY KEY,cwd TEXT NOT NULL,harness TEXT NOT NULL,model TEXT,model_settings TEXT,runtime_mode TEXT,title TEXT,provider_session_id TEXT,blocks_json TEXT NOT NULL,created_at INTEGER,updated_at INTEGER,is_draft INTEGER DEFAULT 0,has_user_message INTEGER DEFAULT 1,inbox_ask INTEGER DEFAULT 0); CREATE TABLE in_flight_sessions(session_id TEXT PRIMARY KEY);`,
  );
  const insert = db.prepare(
    "INSERT INTO sessions(id,cwd,harness,model_settings,runtime_mode,title,blocks_json,created_at,updated_at,is_draft,inbox_ask) VALUES(?,?,?,'{}','supervised',?,'[]',1,1,?,?)",
  );
  for (const [id, cwd, provider, draft, ask] of [
    ["visible", folder, "codex", 0, 0],
    ["draft", folder, "codex", 1, 0],
    ["internal", folder, "codex", 0, 1],
    ["other-provider", folder, "claude", 0, 0],
    ["other-project", `${folder}/elsewhere`, "codex", 0, 0],
  ] as const)
    insert.run(id, cwd, provider, id, draft, ask);
  const paths = [path];
  const live = new DesktopLive(),
    desktop = new DesktopSessions(() => paths, process.platform, live);
  cleanup.push(async () => {
    await desktop.closeAsync();
    db.close();
    const target = resolve(folder);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-desktop-owner-")
    )
      throw new Error("Unexpected owned fixture directory");
    rmSync(target, { recursive: true, force: true });
  });
  return { db, live, desktop, cwd: folder, path, paths };
}

it("filters in the read worker and reapplies current heartbeat authority without opening a main-thread connection", async () => {
  const { db, live, desktop, cwd } = fixture();
  const first = await desktop.listSnapshotAsync(cwd, "P", ["codex"]);
  expect(first.sessions.map((session) => session.id)).toEqual(["visible"]);
  expect(desktop.opened).toBe(0);
  const reader = (desktop as unknown as { metadataReader: AsyncHostNotes }).metadataReader;
  const metadata = await reader.desktopList(cwd, "P", ["codex"], process.platform);
  const unchanged = await reader.desktopList(
    cwd,
    "P",
    ["codex"],
    process.platform,
    metadata.fingerprint,
  );
  expect("unchanged" in unchanged && unchanged.unchanged).toBe(true);
  expect(Object.hasOwn(unchanged, "sessions")).toBe(false);
  expect(Object.hasOwn(unchanged, "stored")).toBe(false);
  expect(await desktop.listSnapshotAsync(cwd, "P", ["codex"])).toBe(first);
  live.beat({ clientId: "window", sessions: [{ id: "visible", busy: true }] });
  const busy = await desktop.listSnapshotAsync(cwd, "P", ["codex"]);
  expect(busy.sessions[0].status).toBe("running");
  expect(busy.fingerprint).not.toBe(first.fingerprint);
  live.beat({ clientId: "window", sessions: [] });
  const idle = await desktop.listSnapshotAsync(cwd, "P", ["codex"]);
  expect(idle.sessions[0].status).toBe("idle");
  db.prepare(
    "UPDATE sessions SET title='unrelated change',updated_at=2 WHERE id='other-project'",
  ).run();
  expect(await desktop.listSnapshotAsync(cwd, "P", ["codex"])).toBe(idle);
  db.prepare("UPDATE sessions SET title='visible change',updated_at=3 WHERE id='visible'").run();
  const changed = await desktop.listSnapshotAsync(cwd, "P", ["codex"]);
  expect(changed.sessions[0].title).toBe("visible change");
  expect(changed.fingerprint).not.toBe(idle.fingerprint);
  expect(desktop.opened).toBe(0);
});

it("does not block a main-thread timer and uses a heartbeat arriving during a locked read", async () => {
  const { db, live, desktop, cwd } = fixture();
  await desktop.listSnapshotAsync(cwd, "warm", ["codex"]);
  db.exec("BEGIN EXCLUSIVE");
  db.prepare("UPDATE sessions SET title='committed after lock' WHERE id='visible'").run();
  let completed = false;
  const pending = desktop.listSnapshotAsync(cwd, "cold", ["codex"]).then((value) => {
    completed = true;
    return value;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completed).toBe(false);
    live.beat({ clientId: "new-live", sessions: [{ id: "visible", busy: true }] });
  } finally {
    db.exec("COMMIT");
  }
  const value = await pending;
  expect(value.sessions[0].title).toBe("committed after lock");
  expect(value.sessions[0].status).toBe("running");
  expect(desktop.opened).toBe(0);
});

it("runs stamp, queue metadata, canonical project and complete snapshot reads off the request thread", async () => {
  const { db, live, desktop, cwd } = fixture();
  const blocks = Array.from({ length: 1001 }, (_, index) => ({
    id: `block-${index}`,
    role: "assistant",
    text: String(index),
  }));
  db.prepare("UPDATE sessions SET blocks_json=?,updated_at=7 WHERE id='visible'").run(
    JSON.stringify(blocks),
  );
  expect(await desktop.stampAsync("visible")).toEqual({ updatedAt: 7, running: false });
  expect(await desktop.metadataAsync("visible")).toEqual({ cwd, harness: "codex", running: false });
  expect(await desktop.projectCwdAsync("visible")).toBe(cwd);
  expect(await desktop.metadataAsync("draft")).toBeUndefined();
  expect(await desktop.metadataAsync("internal")).toBeUndefined();
  const snapshot = await desktop.snapshotAsync("visible", "P", `${cwd}/.`);
  expect(snapshot?.session.blocks).toEqual(blocks);
  expect(snapshot?.revision).toBe(7);
  live.beat({ clientId: "window", sessions: [{ id: "visible", busy: true }] });
  expect((await desktop.stampAsync("visible", 60_000))?.running).toBe(true);
  expect((await desktop.metadataAsync("visible"))?.running).toBe(true);
  expect((await desktop.snapshotAsync("visible", "P", cwd))?.session.busy).toBe(true);
  live.beat({ clientId: "window", sessions: [] });
  const idle = await desktop.snapshotAsync("visible", "P", cwd);
  expect(idle?.status).toBe("idle");
  expect(idle?.session.busy).toBeUndefined();
  await expect(desktop.snapshotAsync("visible", "P", `${cwd}/other`)).rejects.toThrow(
    "project changed",
  );
  db.prepare("UPDATE sessions SET blocks_json='invalid' WHERE id='visible'").run();
  expect(await desktop.snapshotAsync("visible", "P", cwd)).toBeUndefined();
  expect(desktop.opened).toBe(0);
});

it("preserves earliest-copy ownership and fresh heartbeat authority across async readers", async () => {
  const { db, desktop, path, paths, cwd, live } = fixture();
  const mirror = join(cwd, "mirror.db");
  copyFileSync(path, mirror);
  const other = new DatabaseSync(mirror);
  try {
    other
      .prepare(
        "UPDATE sessions SET created_at=2,updated_at=100,title='newer mirror' WHERE id='visible'",
      )
      .run();
    other.prepare("INSERT INTO in_flight_sessions VALUES('visible')").run();
  } finally {
    other.close();
  }
  paths.unshift(mirror);
  expect(await desktop.stampAsync("visible")).toEqual({ updatedAt: 1, running: true });
  expect((await desktop.snapshotAsync("visible", "P", cwd))?.session.title).toBe("visible");
  live.beat({ clientId: "owner", sessions: [] });
  expect((await desktop.stampAsync("visible", 60_000))?.running).toBe(false);
  expect((await desktop.metadataAsync("visible"))?.running).toBe(false);
  expect((await desktop.snapshotAsync("visible", "P", cwd))?.status).toBe("idle");
  db.prepare("UPDATE sessions SET title='owner change',updated_at=3 WHERE id='visible'").run();
  expect((await desktop.stampAsync("visible"))?.updatedAt).toBe(3);
  expect((await desktop.snapshotAsync("visible", "P", cwd))?.session.title).toBe("owner change");
  expect(desktop.opened).toBe(0);
});

it("keeps timers responsive through locked stamp, metadata and snapshot reads and uses the latest heartbeat", async () => {
  const { db, desktop, cwd, live } = fixture();
  await desktop.stampAsync("visible");
  await desktop.snapshotAsync("visible", "P", cwd);
  db.exec("BEGIN EXCLUSIVE");
  db.prepare("UPDATE sessions SET title='after lock',updated_at=4 WHERE id='visible'").run();
  let released = false;
  const release = setTimeout(() => {
    db.exec("COMMIT");
    released = true;
  }, 1500);
  const started = performance.now();
  const pending = Promise.all([
    desktop.stampAsync("visible"),
    desktop.metadataAsync("visible"),
    desktop.snapshotAsync("visible", "P", cwd),
  ]);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const timerMs = performance.now() - started;
    expect(timerMs).toBeLessThan(500);
    expect(released).toBe(false);
    live.beat({ clientId: "during-lock", sessions: [{ id: "visible", busy: true }] });
    const [stamp, metadata, snapshot] = await pending;
    expect(stamp).toEqual({ updatedAt: 4, running: true });
    expect(metadata?.running).toBe(true);
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.session.title).toBe("after lock");
    expect(desktop.opened).toBe(0);
    console.info(JSON.stringify({ kind: "desktop async lock", heldMs: 1500, timerMs }));
  } finally {
    clearTimeout(release);
    if (!released) db.exec("ROLLBACK");
    await pending.catch(() => {});
  }
});

it("coalesces raw stamp reads and rejects completions from a closed generation", async () => {
  const { desktop } = fixture();
  let release!: (value: { createdAt: number; updatedAt: number; stored: boolean }[]) => void;
  const result = new Promise<{ createdAt: number; updatedAt: number; stored: boolean }[]>(
    (resolve) => {
      release = resolve;
    },
  );
  const read = vi.spyOn(AsyncHostNotes.prototype, "desktopStampRows").mockReturnValue(result);
  try {
    const first = desktop.stampAsync("visible"),
      second = desktop.stampAsync("visible");
    expect(read).toHaveBeenCalledTimes(1);
    await desktop.closeAsync();
    release([{ createdAt: 1, updatedAt: 2, stored: false }]);
    await expect(first).rejects.toThrow("reader closed");
    await expect(second).rejects.toThrow("reader closed");
  } finally {
    read.mockRestore();
  }
});
