import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { SessionReadProcesses } from "../session-read-process";
import { SessionReadError } from "../domains/sessions/read-errors";

it("reuses the readonly helper after a size refusal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-read-budget-"));
  const path = join(directory, "host.db");
  const database = new DatabaseSync(path);
  const spawn = vi.fn(fork);
  const processes = new SessionReadProcesses(
    new URL("../session-read-helper.mjs", import.meta.url),
    spawn,
  );
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
    const small = { revision: 1, session: { blocks: [] } };
    database.prepare("INSERT INTO sessions VALUES (?, ?)").run("small", JSON.stringify(small));
    const failure = await processes
      .read({ kind: "host", path, sessionId: "large-session" }, AbortSignal.timeout(20_000))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionReadError);
    expect(failure).toMatchObject({ kind: "snapshot-budget" });
    // An exclusive write verifies the previous read transaction released its lock.
    database.exec("BEGIN EXCLUSIVE; COMMIT");
    await expect(
      processes.read({ kind: "host", path, sessionId: "small" }, AbortSignal.timeout(20_000)),
    ).resolves.toEqual(small);
    expect(spawn.mock.calls.length).toBe(1);
  } finally {
    await processes.close();
    if (database.isOpen) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 25_000);

it("exits when its parent disconnects", async () => {
  const child = fork(fileURLToPath(new URL("../session-read-helper.mjs", import.meta.url)), [], {
    execArgv: ["--experimental-transform-types"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const exit = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    child.disconnect();
    await expect(exit).resolves.toEqual([0, null]);
  } finally {
    clearTimeout(timer);
  }
});
