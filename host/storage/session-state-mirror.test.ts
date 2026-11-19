import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";

// Regression for #365: a session write must not need its own session_state
// upsert. The update trigger has to carry project_id and desktop_updated_at,
// which the removed upsert used to set, and an older trigger definition must be
// replaced on reopen with its missing rows backfilled.
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-state-mirror-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "host.db");
}
const snapshot = (projectId: string, desktopUpdatedAt: number | null) =>
  JSON.stringify({
    projectId,
    revision: 2,
    status: "idle",
    updatedAt: 200,
    ...(desktopUpdatedAt === null ? {} : { desktop: { updatedAt: desktopUpdatedAt } }),
    session: { id: "s", title: "s", harness: "codex", blocks: [] },
  });

describe("session_state mirror of sessions", () => {
  it("mirrors project_id and the desktop timestamp on a sessions update", async () => {
    const path = databasePath();
    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    await store.db.prepare(
      "INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status) VALUES ('s', 'p', ?, '{}', 1, 1, 100, 'idle')",
    ).run(snapshot("p", 1));
    await store.db.prepare(
      "UPDATE sessions SET project_id='q', snapshot=?, summary='{}', has_desktop=1, revision=2, updated_at=200, status='idle' WHERE id='s'",
    ).run(snapshot("q", 9));
    const state = await store.db
      .prepare("SELECT project_id, desktop_updated_at, revision FROM session_state WHERE id='s'")
      .get();
    expect(state).toMatchObject({ project_id: "q", desktop_updated_at: 9, revision: 2 });
  });

  it("replaces an older session_state_update trigger on reopen and backfills its rows", async () => {
    const path = databasePath();
    const first = new HostStore(path);
    await first.db.prepare(
      "INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status) VALUES ('s', 'p', ?, '{}', 1, 1, 100, 'idle')",
    ).run(snapshot("p", 1));
    // Simulate the pre-#365 trigger and stale mirror rows left by it.
    await first.db.exec(`DROP TRIGGER session_state_update;
      CREATE TRIGGER session_state_update AFTER UPDATE OF summary, revision, updated_at, status, has_desktop, provider_session_id, harness, session_cwd, shell_running ON sessions BEGIN
        UPDATE session_state SET summary=NEW.summary, revision=NEW.revision, updated_at=NEW.updated_at, status=NEW.status,
          has_desktop=COALESCE(NEW.has_desktop, 0), provider_session_id=NEW.provider_session_id, harness=NEW.harness,
          session_cwd=NEW.session_cwd, shell_running=COALESCE(NEW.shell_running, 0)
        WHERE id=NEW.id;
      END;
      UPDATE session_state SET project_id='stale', desktop_updated_at=NULL WHERE id='s';`);
    await first.close();

    const store = new HostStore(path);
    cleanups.push(async () => await store.close());
    const trigger = await store.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='session_state_update'")
      .get();
    expect(String(trigger!.sql)).toContain("desktop_updated_at");
    const state = await store.db
      .prepare("SELECT project_id, desktop_updated_at FROM session_state WHERE id='s'")
      .get();
    expect(state).toMatchObject({ project_id: "p", desktop_updated_at: 1 });
  });

  it("leaves an up-to-date trigger alone on reopen", async () => {
    const path = databasePath();
    const readTrigger = async (store: HostStore) =>
      (
        await store.db
          .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='session_state_update'")
          .get()
      )!.sql;
    const first = new HostStore(path);
    const before = await readTrigger(first);
    await first.close();
    const reopened = new HostStore(path);
    cleanups.push(async () => await reopened.close());
    expect(await readTrigger(reopened)).toBe(before);
  });
});
