import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
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
import { AsyncHostNotes } from "./host-notes-async";
import { parseHead } from "../src/features/sync/model/conversationHead";

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
/** `stored`: the database's in-flight mark; `inFlight` also weighs the heartbeat. */
type Found = { row: Row; inFlight: boolean; stored: boolean };
export type DesktopMetadataList = {
  key: string;
  database: string;
  fingerprint: string;
  sessions: HostSessionSummary[];
  stored: boolean[];
  bytes: number;
};
export type DesktopMetadataReply =
  | DesktopMetadataList
  | {
      key: string;
      database: string;
      fingerprint: string;
      unchanged: true;
    };
type Handle = {
  db: DatabaseSync;
  /** File identity; a replaced database is a different file. */
  id: string;
  columns?: Set<string>;
  schemaVersion?: number;
  timer?: NodeJS.Timeout;
};

export type DesktopStampRow = { createdAt: number; updatedAt: number; stored: boolean };
export type DesktopMetadataRecord = { cwd: string; harness: string; stored: boolean };
export type DesktopSnapshotRecord = { value: HostSession; stored: boolean };

/** Release and development apps keep separate databases, and either may hold
 * a mirrored copy of a session the other started. The copy created first
 * owns it, so a later-saved mirror never replaces the owner's transcript;
 * on a tie the earlier database (the release app) owns it. */
function ownsBefore(createdAt: number, ownerCreatedAt: number): boolean {
  if (!Number.isFinite(createdAt)) return false;
  return !Number.isFinite(ownerCreatedAt) || createdAt < ownerCreatedAt;
}

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

  private stamps = new Map<string, { at: number; rows: DesktopStampRow[] }>();

  private handles = new Map<string, Handle>();
  private metadataReader?: AsyncHostNotes;
  private transcriptReader?: AsyncHostNotes;
  private metadataGeneration = 0;
  private stampFlights = new Map<string, Promise<DesktopStampRow[]>>();
  private recordFlights = new Map<string, Promise<DesktopMetadataRecord | undefined>>();
  private snapshotFlights = new Map<string, Promise<DesktopSnapshotRecord | undefined>>();
  private metadataFlights = new Map<string, Promise<DesktopMetadataReply>>();
  private metadataKeys = new Map<string, string>();
  private listMetadataCache = new Map<string, { at: number; value: DesktopMetadataList }>();
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
    required = false,
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
          if (
            required &&
            !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
          )
            throw new Error("Desktop session metadata is temporarily unavailable.", {
              cause: error,
            });
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

  /**
   * Changes whenever the desktop app commits: it writes through SQLite's WAL, so
   * the WAL (or, after a checkpoint, the database) file's size and time move.
   * Two stats per database instead of re-reading every session row.
   */
  fingerprint(): string {
    const parts: string[] = [];
    for (const path of this.paths())
      for (const file of [path, `${path}-wal`]) {
        try {
          const stat = statSync(file);
          parts.push(
            `${file}:${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`,
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          parts.push(
            code === "ENOENT" || code === "ENOTDIR" ? "-" : `unavailable:${code ?? "unknown"}`,
          );
        }
      }
    return parts.join("|");
  }

  /** Releases every cached connection (host shutdown). */
  close(): void {
    this.metadataGeneration++;
    this.metadataFlights.clear();
    this.metadataKeys.clear();
    this.listMetadataCache.clear();
    void this.metadataReader?.close();
    this.metadataReader = undefined;
    void this.transcriptReader?.close();
    this.transcriptReader = undefined;
    this.stampFlights.clear();
    this.recordFlights.clear();
    this.snapshotFlights.clear();
    this.stamps.clear();
    this.metadataCache.clear();
    this.listSnapshots.clear();
    for (const path of [...this.handles.keys()]) this.drop(path);
  }
  /** Read workers release OS handles before replying; metadata stays cached. */
  releaseReadHandles(): void {
    for (const path of [...this.handles.keys()]) this.drop(path);
  }
  async closeAsync(): Promise<void> {
    const reader = this.metadataReader;
    const transcripts = this.transcriptReader;
    this.close();
    await Promise.all([reader?.close(), transcripts?.close()]);
  }

  private rows(
    db: DatabaseSync,
    columns: Set<string>,
    where: string,
    args: string[],
    blocks = true,
    required = false,
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
      ${optional("is_draft", "0")}, ${optional("inbox_ask")}, ${optional("adopted_base")},
      ${optional("pending_context_replay")}
      FROM ${transcriptView ? "session_transcripts" : "sessions"} WHERE ${where}`;
    const running = new Set<string>();
    try {
      for (const r of db.prepare("SELECT session_id FROM in_flight_sessions").all())
        running.add(String(r.session_id));
    } catch (error) {
      if (
        required &&
        !(error instanceof Error && error.message.includes("no such table: in_flight_sessions"))
      )
        throw error;
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
        const stored = running.has(String(row.id));
        return { row, stored, inFlight: this.isRunning(String(row.id), stored) };
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

  /** The owning copy of each session across all desktop databases. `where`
   * may be derived from each database (a project filter that needs its cwds). */
  private collect(
    where: string | ((db: DatabaseSync, columns: Set<string>) => [string, string[]] | undefined),
    args: string[],
    blocks = true,
    required = false,
  ): Found[] {
    const best = new Map<string, Found>();
    for (const path of this.paths()) {
      for (const found of this.query(
        path,
        (db, columns) => {
          const set = columns();
          const filter =
            typeof where === "string" ? ([where, args] as [string, string[]]) : where(db, set);
          return filter ? this.rows(db, set, filter[0], filter[1], blocks, required) : [];
        },
        required,
      ) ?? []) {
        const id = String(found.row.id);
        const old = best.get(id);
        if (!old) best.set(id, found);
        else if (ownsBefore(Number(found.row.created_at), Number(old.row.created_at)))
          best.set(id, {
            ...found,
            inFlight: found.inFlight || old.inFlight,
            stored: found.stored || old.stored,
          });
        else if ((found.inFlight && !old.inFlight) || (found.stored && !old.stored))
          best.set(id, {
            ...old,
            inFlight: old.inFlight || found.inFlight,
            stored: old.stored || found.stored,
          });
      }
    }
    return [...best.values()];
  }

  private listSnapshots = new Map<
    string,
    {
      database: string;
      refreshed: number;
      live: string;
      ids: string[];
      stored: boolean[];
      content?: string;
      bytes: number;
      value: { fingerprint: string; sessions: HostSessionSummary[] };
    }
  >();

  /** Metadata-only validation is shared by direct lists and change watchers.
   * A database commit in another project may require checking local metadata,
   * but must not invalidate this project's materialized host/branch list. */
  listSnapshot(projectCwd: string, projectId: string, providers: readonly string[]) {
    const key = JSON.stringify([
      normalizeProjectPath(projectCwd, this.platform),
      projectId,
      providers,
    ]);
    const database = this.fingerprint();
    const previous = this.listSnapshots.get(key);
    if (
      previous &&
      previous.database === database &&
      Date.now() - previous.refreshed < 30_000 &&
      previous.live === this.live.listVersion(previous.ids, previous.stored)
    ) {
      this.listSnapshots.delete(key);
      this.listSnapshots.set(key, previous);
      return previous.value;
    }
    const rows = this.listRows(projectCwd, providers);
    const sessions = rows.map((row) => this.summaryOf(row, projectId));
    const json = JSON.stringify(sessions);
    const fingerprint = createHash("sha256").update(json).digest("base64url");
    const value =
      previous?.value.fingerprint === fingerprint ? previous.value : { fingerprint, sessions };
    const ids = value.sessions.map((session) => session.id);
    const stored = rows.map((row) => row.stored);
    this.listSnapshots.delete(key);
    this.listSnapshots.set(key, {
      database,
      refreshed: Date.now(),
      ids,
      stored,
      live: this.live.listVersion(ids, stored),
      bytes: Buffer.byteLength(json),
      value,
    });
    let bytes = 0;
    for (const entry of this.listSnapshots.values()) bytes += entry.bytes;
    while (this.listSnapshots.size > 32 || bytes > 16 * 1024 * 1024) {
      const first = this.listSnapshots.keys().next().value;
      if (first === undefined) break;
      bytes -= this.listSnapshots.get(first)!.bytes;
      this.listSnapshots.delete(first);
    }
    return value;
  }

  list(projectCwd: string, projectId: string, providers: readonly string[]): HostSessionSummary[] {
    return this.listSnapshot(projectCwd, projectId, providers).sessions;
  }

  /** Read-only metadata owner entry. Used by the storage worker, never IPC input. */
  readMetadataList(
    projectCwd: string,
    projectId: string,
    providers: readonly string[],
  ): DesktopMetadataList {
    const key = JSON.stringify([
      normalizeProjectPath(projectCwd, this.platform),
      projectId,
      providers,
    ]);
    const database = this.fingerprint(),
      previous = this.listMetadataCache.get(key);
    if (previous && previous.value.database === database && Date.now() - previous.at < 30_000)
      return previous.value;
    const rows = this.listRows(projectCwd, providers);
    // Running-state authority stays on the host's live heartbeat owner.
    const sessions = rows.map((entry) => this.summaryOf({ ...entry, inFlight: false }, projectId));
    const json = JSON.stringify(sessions);
    const stored = rows.map((entry) => entry.stored);
    const value = {
      key,
      database,
      sessions,
      stored,
      fingerprint: createHash("sha256")
        .update(json)
        .update(JSON.stringify(stored))
        .digest("base64url"),
      bytes: Buffer.byteLength(json),
    };
    this.listMetadataCache.delete(key);
    this.listMetadataCache.set(key, { at: Date.now(), value });
    let bytes = [...this.listMetadataCache.values()].reduce(
      (sum, entry) => sum + entry.value.bytes,
      0,
    );
    while (this.listMetadataCache.size > 32 || bytes > 16 * 1024 * 1024) {
      const first = this.listMetadataCache.keys().next().value;
      if (first === undefined) break;
      bytes -= this.listMetadataCache.get(first)!.value.bytes;
      this.listMetadataCache.delete(first);
    }
    return value;
  }

  /** The hot project-list path never waits for SQLite on the request event loop. */
  async listSnapshotAsync(projectCwd: string, projectId: string, providers: readonly string[]) {
    const requestKey = JSON.stringify([projectCwd, projectId, providers]),
      generation = this.metadataGeneration;
    let flight = this.metadataFlights.get(requestKey);
    if (!flight) {
      this.metadataReader ??= new AsyncHostNotes(this.paths);
      const knownKey = this.metadataKeys.get(requestKey),
        known = knownKey ? this.listSnapshots.get(knownKey)?.content : undefined;
      flight = this.metadataReader.desktopList(
        projectCwd,
        projectId,
        providers,
        this.platform,
        known,
      );
      this.metadataFlights.set(requestKey, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.metadataFlights.get(requestKey) === current)
            this.metadataFlights.delete(requestKey);
        })
        .catch(() => {});
    }
    let result = await flight;
    if (generation !== this.metadataGeneration)
      throw new Error("Desktop session metadata reader closed.");
    this.metadataKeys.delete(requestKey);
    this.metadataKeys.set(requestKey, result.key);
    while (this.metadataKeys.size > 128)
      this.metadataKeys.delete(this.metadataKeys.keys().next().value!);
    let previous = this.listSnapshots.get(result.key);
    if ("unchanged" in result && (!previous || previous.content !== result.fingerprint)) {
      result = await this.metadataReader!.desktopList(
        projectCwd,
        projectId,
        providers,
        this.platform,
      );
      if (generation !== this.metadataGeneration)
        throw new Error("Desktop session metadata reader closed.");
      previous = this.listSnapshots.get(result.key);
    }
    const complete = "unchanged" in result ? undefined : result;
    const base = complete?.sessions ?? previous!.value.sessions,
      stored = complete?.stored ?? previous!.stored;
    const ids = complete ? base.map((session) => session.id) : previous!.ids,
      live = this.live.listVersion(ids, stored);
    if (previous?.content === result.fingerprint && previous.live === live) {
      previous.database = result.database;
      previous.refreshed = Date.now();
      return previous.value;
    }
    const sessions = base.map((session, index) => ({
      ...session,
      status: this.isRunning(session.id, stored[index]) ? ("running" as const) : ("idle" as const),
    }));
    const value = {
      sessions,
      fingerprint: createHash("sha256").update(result.fingerprint).update(live).digest("base64url"),
    };
    this.listSnapshots.delete(result.key);
    this.listSnapshots.set(result.key, {
      database: result.database,
      refreshed: Date.now(),
      ids,
      stored,
      live,
      content: result.fingerprint,
      bytes: complete?.bytes ?? previous!.bytes,
      value,
    });
    let bytes = [...this.listSnapshots.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (this.listSnapshots.size > 32 || bytes > 16 * 1024 * 1024) {
      const first = this.listSnapshots.keys().next().value;
      if (first === undefined) break;
      bytes -= this.listSnapshots.get(first)!.bytes;
      this.listSnapshots.delete(first);
    }
    return value;
  }

  private listRows(projectCwd: string, providers: readonly string[]): Found[] {
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
      true,
    ).filter(
      ({ row }) =>
        providers.includes(String(row.harness)) &&
        normalizeProjectPath(String(row.cwd), this.platform) === target,
    );
  }

  /** When the owning desktop copy last changed, without reading its
   * transcript; polled while a remote client watches the session. A turn
   * running in any copy counts as running. */
  stamp(
    id: string,
    /** Reuse the database rows read this recently; only for pollers. */
    maxAgeMs = 0,
  ): { updatedAt: number; running: boolean } | undefined {
    return this.stampFromRows(id, this.stampRows(id, maxAgeMs));
  }

  private stampFromRows(id: string, rows: readonly DesktopStampRow[]) {
    let owner: { createdAt: number; updatedAt: number } | undefined;
    let running = false;
    for (const row of rows) {
      // The heartbeat is in memory, so it is always evaluated fresh.
      running ||= this.isRunning(id, row.stored);
      if (!owner || ownsBefore(row.createdAt, owner.createdAt)) owner = row;
    }
    return owner && { updatedAt: owner.updatedAt, running };
  }

  /** Polling caches only database rows; heartbeat authority is evaluated after every await. */
  async stampAsync(id: string, maxAgeMs = 0) {
    const generation = this.metadataGeneration;
    const now = Date.now();
    const cached = this.stamps.get(id);
    if (cached && now - cached.at < maxAgeMs) return this.stampFromRows(id, cached.rows);
    let flight = this.stampFlights.get(id);
    if (!flight) {
      this.metadataReader ??= new AsyncHostNotes(this.paths);
      flight = this.metadataReader.desktopStampRows(id, this.platform);
      this.stampFlights.set(id, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.stampFlights.get(id) === current) this.stampFlights.delete(id);
        })
        .catch(() => {});
    }
    const rows = await flight;
    this.assertReadGeneration(generation);
    if ((this.stamps.get(id)?.at ?? -Infinity) <= now) {
      this.stamps.delete(id);
      this.stamps.set(id, { at: now, rows });
      while (this.stamps.size > 64) this.stamps.delete(this.stamps.keys().next().value!);
    }
    return this.stampFromRows(id, rows);
  }

  private assertReadGeneration(generation: number) {
    if (generation !== this.metadataGeneration)
      throw new Error("Desktop session metadata reader closed.");
  }

  /** Worker-only raw rows. A busy/unavailable database must not become an idle stamp. */
  readStampRows(id: string): DesktopStampRow[] {
    return this.stampRows(id, 0, true);
  }

  /** Database reads behind `stamp()`. */
  private stampRows(id: string, maxAgeMs: number, required = false): DesktopStampRow[] {
    const now = Date.now();
    const cached = this.stamps.get(id);
    if (cached && now - cached.at < maxAgeMs) return cached.rows;
    const rows: DesktopStampRow[] = [];
    for (const path of this.paths()) {
      const found = this.query(
        path,
        (db) => {
          const row = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id=?").get(id);
          if (!row) return undefined;
          let stored = false;
          try {
            stored = !!db.prepare("SELECT 1 FROM in_flight_sessions WHERE session_id=?").get(id);
          } catch (error) {
            if (
              required &&
              !(
                error instanceof Error &&
                error.message.includes("no such table: in_flight_sessions")
              )
            )
              throw error;
            /* older desktop without the table */
          }
          return { createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), stored };
        },
        required,
      );
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

  async projectCwdAsync(id: string): Promise<string | undefined> {
    return (await this.metadataAsync(id))?.cwd;
  }

  /** Queue access checks must not materialize a potentially large transcript. */
  /** Queue RPCs ask this per call; rows only change with a desktop commit. */
  private metadataCache = new Map<string, { fingerprint: string; value?: DesktopMetadataRecord }>();

  metadata(id: string): { cwd: string; harness: string; running: boolean } | undefined {
    const value = this.readMetadataRecord(id);
    return (
      value && {
        cwd: value.cwd,
        harness: value.harness,
        running: this.isRunning(id, value.stored),
      }
    );
  }

  /** Worker metadata never applies its separate, empty heartbeat registry. */
  readMetadataRecord(id: string, required = false): DesktopMetadataRecord | undefined {
    const fingerprint = this.fingerprint();
    let cached = this.metadataCache.get(id);
    if (cached?.fingerprint !== fingerprint) {
      const found = this.collect("id=?", [id], false, required)[0];
      cached = {
        fingerprint,
        value: found && {
          cwd: String(found.row.cwd),
          harness: String(found.row.harness),
          stored: found.stored,
        },
      };
      this.metadataCache.delete(id);
      this.metadataCache.set(id, cached);
      while (this.metadataCache.size > 512)
        this.metadataCache.delete(this.metadataCache.keys().next().value!);
    }
    return cached.value;
  }

  async metadataAsync(
    id: string,
  ): Promise<{ cwd: string; harness: string; running: boolean } | undefined> {
    const generation = this.metadataGeneration;
    let flight = this.recordFlights.get(id);
    if (!flight) {
      this.metadataReader ??= new AsyncHostNotes(this.paths);
      flight = this.metadataReader.desktopMetadata(id, this.platform);
      this.recordFlights.set(id, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.recordFlights.get(id) === current) this.recordFlights.delete(id);
        })
        .catch(() => {});
    }
    const value = await flight;
    this.assertReadGeneration(generation);
    return (
      value && { cwd: value.cwd, harness: value.harness, running: this.isRunning(id, value.stored) }
    );
  }

  samePath(a: string, b: string): boolean {
    return normalizeProjectPath(a, this.platform) === normalizeProjectPath(b, this.platform);
  }

  snapshot(id: string, projectId: string): HostSession | undefined {
    const found = this.collect("id=?", [id])[0];
    return this.snapshotFromRow(id, projectId, found);
  }

  /** Worker-only transcript read; base cwd is checked separately from a worktree cwd. */
  readSnapshotRecord(
    id: string,
    projectId: string,
    expectedProjectCwd?: string,
  ): DesktopSnapshotRecord | undefined {
    const found = this.collect("id=?", [id], true, true)[0];
    if (!found) return undefined;
    if (
      expectedProjectCwd !== undefined &&
      !this.samePath(String(found.row.cwd), expectedProjectCwd)
    )
      throw new Error("Desktop session project changed while reading.");
    const value = this.snapshotFromRow(id, projectId, found);
    return value && { value, stored: found.stored };
  }

  async snapshotAsync(
    id: string,
    projectId: string,
    expectedProjectCwd?: string,
  ): Promise<HostSession | undefined> {
    const generation = this.metadataGeneration;
    const key = JSON.stringify([id, projectId, expectedProjectCwd]);
    let flight = this.snapshotFlights.get(key);
    if (!flight) {
      // A large transcript decode cannot hold up the metadata/poller worker.
      this.transcriptReader ??= new AsyncHostNotes(this.paths);
      flight = this.transcriptReader.desktopSnapshot(
        id,
        projectId,
        this.platform,
        expectedProjectCwd,
      );
      this.snapshotFlights.set(key, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.snapshotFlights.get(key) === current) this.snapshotFlights.delete(key);
        })
        .catch(() => {});
    }
    const record = await flight;
    this.assertReadGeneration(generation);
    if (!record) return undefined;
    const running = this.isRunning(id, record.stored);
    const { busy: _storedBusy, ...session } = record.value.session;
    return {
      ...record.value,
      status: running ? "running" : "idle",
      session: { ...session, ...(running ? { busy: true } : {}) },
    };
  }

  private snapshotFromRow(id: string, projectId: string, found?: Found): HostSession | undefined {
    if (!found) return undefined;
    const { row } = found;
    const updatedAt = Number(row.updated_at);
    // An unreadable transcript is unavailable, never empty: callers adopt and
    // refresh host copies from this snapshot, and an empty one would replace it.
    const blocks = parse(row.blocks_json);
    if (!Array.isArray(blocks)) {
      console.warn(`[bycoda] desktop transcript ${id} is unreadable; skipping its snapshot`);
      return undefined;
    }
    // The transcript this desktop last agreed on with the host; an older app has no column.
    const adoptedBase = parseHead(parse(row.adopted_base));
    const session: Session = {
      id: String(row.id),
      harness: String(row.harness) as Session["harness"],
      model: String(row.model ?? ""),
      modelSettings: (parse(row.model_settings) as Record<string, string>) ?? {},
      runtimeMode: row.runtime_mode as Session["runtimeMode"],
      title: String(row.title ?? ""),
      cwd: workCwd(row),
      blocks: blocks as Block[],
      ...(row.provider_session_id ? { providerSessionId: String(row.provider_session_id) } : {}),
      ...(row.provider_account_id ? { providerAccountId: String(row.provider_account_id) } : {}),
      ...(row.pending_context_replay
        ? { pendingContextReplay: String(row.pending_context_replay) }
        : {}),
      ...(row.branch ? { branch: String(row.branch) } : {}),
      ...(row.worktree_cwd ? { worktreeCwd: String(row.worktree_cwd) } : {}),
      ...(row.linked_work_item_json ? { linkedWorkItem: parse(row.linked_work_item_json) } : {}),
      ...(adoptedBase ? { adoptedBase } : {}),
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
