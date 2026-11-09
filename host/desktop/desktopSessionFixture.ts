import { vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostEngine } from "../engine";
import { HostStore } from "../store";
import { createHostServer } from "../server";
import { DesktopSessions } from "./desktopSessions";
import { DesktopLive } from "./desktopLive";

// Real HTTP/SQLite jobs need more than 1 s on busy Windows runners, while
// remaining below the 12 s desktop writer transfer deadline.
export const WAIT_FOR_DESKTOP_JOB = { timeout: 10_000 };

type Seed = {
  id: string;
  cwd: string;
  harness?: string;
  updated?: number;
  draft?: number;
  user?: number;
  worktree?: string;
};

export async function setupDesktopHost(cleanups: Array<() => Promise<void>>) {
  const clock = { now: 1_000_000 };
  const directory = mkdtempSync(join(tmpdir(), "bycoda-desktop-test-"));
  const projectDir = join(directory, "project");
  mkdirSync(projectDir);
  const dbPath = join(directory, "bycoda.db");
  const desktopDb = new DatabaseSync(dbPath);
  desktopDb.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, harness TEXT NOT NULL, model TEXT, model_settings TEXT, runtime_mode TEXT, title TEXT, provider_session_id TEXT, blocks_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER, branch TEXT, archived INTEGER DEFAULT 0, worktree_cwd TEXT, has_user_message INTEGER DEFAULT 1, pinned INTEGER DEFAULT 0, linked_work_item_json TEXT, provider_account_id TEXT, is_draft INTEGER DEFAULT 0);
    CREATE TABLE in_flight_sessions (session_id TEXT PRIMARY KEY, cwd TEXT NOT NULL, sort_index INTEGER NOT NULL);`);
  const seed = (s: Seed) =>
    desktopDb
      .prepare(
        "INSERT INTO sessions (id, cwd, harness, model, model_settings, runtime_mode, title, provider_session_id, blocks_json, created_at, updated_at, is_draft, has_user_message, worktree_cwd) VALUES (?, ?, ?, 'codex:test', '{}', 'supervised', ?, ?, ?, 1, ?, ?, ?, ?)",
      )
      .run(
        s.id,
        s.cwd,
        s.harness ?? "codex",
        `Title ${s.id}`,
        `prov-${s.id}`,
        JSON.stringify([{ id: "b1", role: "user", text: "hi" }]),
        s.updated ?? 100,
        s.draft ?? 0,
        s.user ?? 1,
        s.worktree ?? null,
      );
  const store = new HostStore(join(directory, "host.db"));
  const bind = vi.fn();
  let finish = () => {};
  let signalProviderStarted!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    signalProviderStarted = resolve;
  });
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        signalProviderStarted();
      }),
  );
  const engine = new HostEngine(store, {
    codex: {
      send,
      stop: async () => finish(),
      cancel: async () => finish(),
      bind,
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(projectDir);
  const server = await createHostServer(
    engine,
    ["codex"],
    undefined,
    undefined,
    undefined,
    new DesktopSessions(() => [dbPath], process.platform, new DesktopLive(() => clock.now)),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
  const device = await store.issueDevice("Laptop");
  const call = async (method: string, params: unknown = {}) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${device.token}` },
      body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
    });
    return (await response.json()) as { result?: any; error?: string };
  };
  cleanups.push(async () => {
    finish();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    desktopDb.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    dbPath,
    desktopDb,
    seed,
    store,
    engine,
    project,
    call,
    bind,
    send,
    projectDir,
    clock,
    providerStarted,
  };
}
