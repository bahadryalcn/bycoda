import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type {
  HostSession,
  HostSessionSummary,
  RemoteProvider,
} from "../src/features/connections/model/protocol";
import type { Block, Session } from "../src/features/sessions/model/session";
import { DesktopLive } from "./desktopLive";

// Must match the desktop app's Tauri identifiers and its session database
// (src-tauri/tauri*.conf.json, src-tauri/src/session_store.rs).
const IDENTIFIERS = ["com.bycoda.desktop", "com.bycoda.desktop.dev"];
const DATABASE = "bycoda.db";

/** Tauri's app data directories, one per identifier, for this platform. */
export function desktopDatabasePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string[] {
  const override = env.BYCODA_DESKTOP_DB;
  if (override)
    return override
      .split(delimiter)
      .filter(Boolean)
      .filter((p) => existsSync(p));
  const base =
    platform === "win32"
      ? env.APPDATA || join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : env.XDG_DATA_HOME || join(home, ".local", "share");
  return IDENTIFIERS.map((id) => join(base, id, DATABASE)).filter((p) => existsSync(p));
}

let pathsCache: { key: string; at: number; value: string[] } | undefined;

/** `desktopDatabasePaths()` stats up to three files; watchers ask per tick. */
function cachedDesktopDatabasePaths(): string[] {
  const key = [process.env.BYCODA_DESKTOP_DB, process.env.APPDATA, process.env.XDG_DATA_HOME].join(
    "\0",
  );
  const now = Date.now();
  if (pathsCache?.key === key && now - pathsCache.at < 3_000) return pathsCache.value;
  const value = desktopDatabasePaths();
  pathsCache = { key, at: now, value };
  return value;
}

// Project lists are rebuilt several times a second, each time matching every
// desktop cwd; realpath on each is a syscall chain. A folder's real path
// changes rarely, so results are reused briefly.
const NORMALIZED_PATH_TTL_MS = 5_000;
const NORMALIZED_PATH_LIMIT = 512;
const normalizedPaths = new Map<string, { value: string; at: number }>();

export function normalizeProjectPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const key = `${platform}\0${path}`;
  const now = Date.now();
  const known = normalizedPaths.get(key);
  if (known && now - known.at < NORMALIZED_PATH_TTL_MS) return known.value;
  const value = resolveProjectPath(path, platform);
  normalizedPaths.delete(key);
  normalizedPaths.set(key, { value, at: now });
  while (normalizedPaths.size > NORMALIZED_PATH_LIMIT)
    normalizedPaths.delete(normalizedPaths.keys().next().value!);
  return value;
}

function resolveProjectPath(path: string, platform: NodeJS.Platform): string {
  let value = path;
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\"))
    value = join(homedir(), value.slice(1));
  try {
    value = realpathSync.native(value);
  } catch {
    /* project folder may be gone; compare as written */
  }
  value = value.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return platform === "win32" || platform === "darwin" ? value.toLowerCase() : value;
}

type Row = Record<string, unknown>;
type Found = { row: Row; inFlight: boolean };
type Handle = {
  db: DatabaseSync;
  /** File identity; a replaced database is a different file. */
  id: string;
  columns?: Set<string>;
  schemaVersion?: number;
  timer?: NodeJS.Timeout;
};

/**
 * Read-only view of the sessions the Bycoda desktop app keeps on this
 * machine. The desktop is the only writer; this never writes.
 */
export class DesktopSessions {
  constructor(
    private readonly paths: () => string[] = cachedDesktopDatabasePaths,
    private readonly platform: NodeJS.Platform = process.platform,
    /** The app's heartbeat: running state and live prompts. */
    readonly live = new DesktopLive(),
    private readonly idleMs = 5000,
  ) {}

  private stamps = new Map<
    string,
    { at: number; rows: { updatedAt: number; stored: boolean }[] }
  >();

  private handles = new Map<string, Handle>();
  /** Connections opened so far (for tests). */
  opened = 0;

  /** Running per the app's heartbeat; the database's in-flight mark (which a
   * crashed app leaves behind) only counts for an app without one. */
  private isRunning(id: string, stored: boolean): boolean {
    return this.live.running(id, stored);
  }

  /** Opens one read-only connection per database and keeps it for a while:
   * `stamp()` runs every watcher tick. It is dropped when idle, because on
   * Windows an open handle stops the desktop app from replacing the file. */
  private query<T>(
    path: string,
    run: (db: DatabaseSync, columns: () => Set<string>) => T,
  ): T | undefined {
    for (let attempt = 0; ; attempt++) {
      try {
        const handle = this.handle(path);
        const result = run(handle.db, () => this.columns(handle));
        this.release(path, handle);
        return result;
      } catch (error) {
        // A stale handle (file replaced, schema migrated) is retried once fresh.
        this.drop(path);
        if (attempt > 0) {
          console.error("Could not read desktop sessions:", error);
          return undefined;
        }
      }
    }
  }

  private handle(path: string): Handle {
    const file = statSync(path, { bigint: true });
    const id = `${file.dev}:${file.ino}:${file.birthtimeNs}`;
    const cached = this.handles.get(path);
    if (cached?.id === id) {
      clearTimeout(cached.timer);
      return cached;
    }
    this.drop(path);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=2000");
    } catch (error) {
      db.close();
      throw error;
    }
    this.opened++;
    const handle: Handle = { db, id };
    this.handles.set(path, handle);
    return handle;
  }

  /** Column names of `sessions`, re-read only when the schema version moves. */
  private columns(handle: Handle): Set<string> {
    const version = Number(handle.db.prepare("PRAGMA schema_version").get()?.schema_version);
    if (!handle.columns || handle.schemaVersion !== version) {
      handle.columns = new Set(
        handle.db
          .prepare("PRAGMA table_info(sessions)")
          .all()
          .map((c) => String(c.name)),
      );
      handle.schemaVersion = version;
    }
    return handle.columns;
  }

  private release(path: string, handle: Handle): void {
    clearTimeout(handle.timer);
    handle.timer = setTimeout(() => this.drop(path), this.idleMs);
    handle.timer.unref();
  }

  private drop(path: string): void {
    const handle = this.handles.get(path);
    if (!handle) return;
    this.handles.delete(path);
    clearTimeout(handle.timer);
    try {
      handle.db.close();
    } catch {
      /* already closed */
    }
  }

  /** Releases every cached connection (host shutdown). */
  close(): void {
    for (const path of [...this.handles.keys()]) this.drop(path);
  }

  private rows(
    db: DatabaseSync,
    columns: Set<string>,
    where: string,
    args: string[],
    blocks = true,
  ): Found[] {
    if (!columns.has("id") || !columns.has("blocks_json")) return [];
    const optional = (name: string, fallback = "NULL") =>
      columns.has(name) ? name : `${fallback} AS ${name}`;
    const transcriptView =
      blocks &&
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='session_transcripts'")
        .get();
    const sql = `SELECT id, cwd, harness, model, model_settings, runtime_mode, title,
      provider_session_id, ${blocks ? "blocks_json" : "NULL AS blocks_json"},
      created_at, updated_at,
      ${optional("branch")}, ${optional("archived", "0")}, ${optional("worktree_cwd")},
      ${optional("has_user_message", "1")}, ${optional("pinned", "0")},
      ${optional("linked_work_item_json")}, ${optional("provider_account_id")},
      ${optional("is_draft", "0")}, ${optional("inbox_ask")}
      FROM ${transcriptView ? "session_transcripts" : "sessions"} WHERE ${where}`;
    const running = new Set<string>();
    try {
      for (const r of db.prepare("SELECT session_id FROM in_flight_sessions").all())
        running.add(String(r.session_id));
    } catch {
      /* older desktop without the table */
    }
    return db
      .prepare(sql)
      .all(...args)
      .filter((row) => !Number(row.is_draft) && Number(row.has_user_message) && !row.inbox_ask)
      .map((sqlRow) => {
        const row: Row = sqlRow;
        if (
          transcriptView &&
          Number(
            db
              .prepare("SELECT length FROM session_block_state WHERE session_id=?")
              .get(String(row.id))?.length ?? -1,
          ) >= 0
        ) {
          row.block_revisions = Object.fromEntries(
            db
              .prepare("SELECT block_id, revision FROM session_blocks WHERE session_id=?")
              .all(String(row.id))
              .map((block) => [String(block.block_id), Number(block.revision)]),
          );
        }
        return { row, inFlight: this.isRunning(String(row.id), running.has(String(row.id))) };
      });
  }

  private summaryOf({ row, inFlight }: Found, projectId: string): HostSessionSummary {
    const updatedAt = Number(row.updated_at);
    return {
      projectId,
      revision: updatedAt,
      status: inFlight ? "running" : "idle",
      updatedAt,
      id: String(row.id),
      cwd: workCwd(row),
      title: String(row.title ?? ""),
      harness: String(row.harness) as RemoteProvider,
      model: row.model ? String(row.model) : undefined,
      runtimeMode: row.runtime_mode as HostSessionSummary["runtimeMode"],
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      createdAt: Number(row.created_at) || updatedAt,
      archived: !!Number(row.archived),
      pinned: !!Number(row.pinned),
      linkedWorkItem: parse(row.linked_work_item_json),
      needsInput: false,
      origin: "desktop",
    };
  }

  /** Newest copy of each session across all desktop databases. `where` may
   * be derived from each database (a project filter that needs its cwds). */
  private collect(
    where: string | ((db: DatabaseSync, columns: Set<string>) => [string, string[]] | undefined),
    args: string[],
    blocks = true,
  ): Found[] {
    const best = new Map<string, Found>();
    for (const path of this.paths()) {
      for (const found of this.query(path, (db, columns) => {
        const set = columns();
        const filter =
          typeof where === "string" ? ([where, args] as [string, string[]]) : where(db, set);
        return filter ? this.rows(db, set, filter[0], filter[1], blocks) : [];
      }) ?? []) {
        const id = String(found.row.id);
        const old = best.get(id);
        if (!old || Number(found.row.updated_at) > Number(old.row.updated_at)) best.set(id, found);
      }
    }
    return [...best.values()];
  }

  list(projectCwd: string, projectId: string, providers: readonly string[]): HostSessionSummary[] {
    const target = normalizeProjectPath(projectCwd, this.platform);
    if (providers.length === 0) return [];
    // Listing is polled; transcripts are only read for an opened session.
    // Path matching needs realpath and case rules SQL cannot express, so the
    // distinct folders are matched here and the rows are then fetched by exact
    // cwd and harness: the same rows the per-row JS match below would keep.
    return this.collect(
      (db, columns) => {
        if (!columns.has("cwd") || !columns.has("id")) return undefined;
        const cwds = db
          .prepare("SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL")
          .all()
          .map((row) => String(row.cwd))
          .filter((cwd) => normalizeProjectPath(cwd, this.platform) === target);
        if (cwds.length === 0) return undefined;
        const marks = (n: number) => Array(n).fill("?").join(",");
        return [
          `cwd IN (${marks(cwds.length)}) AND harness IN (${marks(providers.length)})`,
          [...cwds, ...providers],
        ];
      },
      [],
      false,
    )
      .filter(
        ({ row }) =>
          providers.includes(String(row.harness)) &&
          normalizeProjectPath(String(row.cwd), this.platform) === target,
      )
      .map((found) => this.summaryOf(found, projectId));
  }

  /** When the newest desktop copy last changed, without reading its
   * transcript; polled while a remote client watches the session. */
  stamp(
    id: string,
    /** Reuse the database rows read this recently; only for pollers. */
    maxAgeMs = 0,
  ): { updatedAt: number; running: boolean } | undefined {
    let best: { updatedAt: number; running: boolean } | undefined;
    for (const row of this.stampRows(id, maxAgeMs)) {
      // The heartbeat is in memory, so it is always evaluated fresh.
      const found = {
        updatedAt: row.updatedAt,
        running: this.isRunning(id, row.stored),
      };
      if (!best || found.updatedAt > best.updatedAt) best = found;
    }
    return best;
  }

  /** Database reads behind `stamp()`. */
  private stampRows(id: string, maxAgeMs: number): { updatedAt: number; stored: boolean }[] {
    const now = Date.now();
    const cached = this.stamps.get(id);
    if (cached && now - cached.at < maxAgeMs) return cached.rows;
    const rows: { updatedAt: number; stored: boolean }[] = [];
    for (const path of this.paths()) {
      const found = this.query(path, (db) => {
        const row = db.prepare("SELECT updated_at FROM sessions WHERE id=?").get(id);
        if (!row) return undefined;
        let stored = false;
        try {
          stored = !!db.prepare("SELECT 1 FROM in_flight_sessions WHERE session_id=?").get(id);
        } catch {
          /* older desktop without the table */
        }
        return { updatedAt: Number(row.updated_at), stored };
      });
      if (found) rows.push(found);
    }
    this.stamps.delete(id);
    this.stamps.set(id, { at: now, rows });
    while (this.stamps.size > 64) this.stamps.delete(this.stamps.keys().next().value!);
    return rows;
  }

  /** The row's project folder, for matching it to a host project. */
  projectCwd(id: string): string | undefined {
    // Only the cwd is needed; skip the transcript.
    const found = this.collect("id=?", [id], false)[0];
    return found ? String(found.row.cwd) : undefined;
  }

  samePath(a: string, b: string): boolean {
    return normalizeProjectPath(a, this.platform) === normalizeProjectPath(b, this.platform);
  }

  snapshot(id: string, projectId: string): HostSession | undefined {
    const found = this.collect("id=?", [id])[0];
    if (!found) return undefined;
    const { row } = found;
    const updatedAt = Number(row.updated_at);
    const session: Session = {
      id: String(row.id),
      harness: String(row.harness) as Session["harness"],
      model: String(row.model ?? ""),
      modelSettings: (parse(row.model_settings) as Record<string, string>) ?? {},
      runtimeMode: row.runtime_mode as Session["runtimeMode"],
      title: String(row.title ?? ""),
      cwd: workCwd(row),
      blocks: (parse(row.blocks_json) as Block[]) ?? [],
      ...(row.provider_session_id ? { providerSessionId: String(row.provider_session_id) } : {}),
      ...(row.provider_account_id ? { providerAccountId: String(row.provider_account_id) } : {}),
      ...(row.branch ? { branch: String(row.branch) } : {}),
      ...(row.worktree_cwd ? { worktreeCwd: String(row.worktree_cwd) } : {}),
      ...(row.linked_work_item_json ? { linkedWorkItem: parse(row.linked_work_item_json) } : {}),
      // A turn the desktop is running shows as running to whoever watches.
      ...(found.inFlight ? { busy: true } : {}),
    };
    return {
      session,
      ...(row.block_revisions
        ? { blockRevisions: row.block_revisions as Record<string, number> }
        : {}),
      projectId,
      revision: updatedAt,
      status: found.inFlight ? "running" : "idle",
      createdAt: Number(row.created_at) || updatedAt,
      updatedAt,
      archived: !!Number(row.archived),
      pinned: !!Number(row.pinned),
    };
  }
}

/** Where the provider ran: the selected worktree, else the project folder. */
function workCwd(row: Row): string {
  return String(row.worktree_cwd || row.cwd);
}

function parse(value: unknown): any {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
