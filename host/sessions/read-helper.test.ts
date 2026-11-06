import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SessionReadProcesses } from "../session-read-process";
import { SessionReadError } from "../domains/sessions/read-errors";

it("preserves an explicit size refusal across the real readonly helper", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-read-budget-"));
  const path = join(directory, "host.db");
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, snapshot TEXT);
      CREATE TABLE session_journal (session_id TEXT PRIMARY KEY, revision INTEGER);
    `);
    database.prepare("INSERT INTO sessions VALUES (?, ?)").run(
      "large-session",
      JSON.stringify({
        revision: 1,
        session: { blocks: [{ text: "x".repeat(32 * 1024 * 1024) }] },
      }),
    );
    database.close();
    const processes = new SessionReadProcesses();
    const failure = await processes
      .read({ kind: "host", path, sessionId: "large-session" }, AbortSignal.timeout(20_000))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionReadError);
    expect(failure).toMatchObject({ kind: "snapshot-budget" });
  } finally {
    if (database.isOpen) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 25_000);
