import { SessionReadProcesses } from "../session-read-process";
import { desktopDelegationParent } from "./delegated-children";
import { normalizeProjectPath, sameProjectPath } from "./project-path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { desktopReadSource, readDesktopSnapshot, type DesktopReadSource } from "./snapshot-read";
import { SessionReadError } from "../domains/sessions/read-errors";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type {
  HostSession,
  HostSessionSummary,
  RemoteProvider,
} from "../../src/features/connections/model/protocol";
import type { Block, Session } from "../../src/features/sessions/model/session";
import { sessionProviderHistory } from "../../src/features/sessions/model/sessionProviderHistory";
import {
  isOwnerStoppedTurn,
  isTurnInterruptionNotice,
} from "../../src/features/sessions/model/turnInterruption";
import { assistantSessionManagement } from "../../src/features/sessions/model/sessionProvenance";
import { DesktopLive } from "./desktopLive";
import { AsyncHostNotes } from "../host-notes-async";
import { isHostNotesAdmissionFault, type HostNotesDatabaseFactory } from "../host-notes-admission";
import { parseHead } from "../../src/features/sync/model/conversationHead";
import {
  buildLocalSessionLink,
  type LocalSessionLocator,
} from "../../src/features/sessions/model/localSessionReference";

// Must match the desktop app's Tauri identifiers and its session database
// (src-tauri/tauri*.conf.json, src-tauri/src/session_store.rs).
const RELEASE_IDENTIFIER = "com.bycoda.desktop";
const DEV_IDENTIFIER = "com.bycoda.desktop.dev";
const DATABASE = "bycoda.db";
/** A Host started by a development run (or told to) also reads the dev app's
 * database. An installed Host never does: the dev app is usually closed, so
 * every fresh connection rebuilt the dev WAL index (tens of ms per job). */
const DEV_HOST_SIGNALS = [
  "BYCODA_DESKTOP_INCLUDE_DEV",
  "BYCODA_DEV_PROFILE_ID",
  "BYCODA_DEV_PROFILE",
  "BYCODA_DEV_HOST_ENTRY",
  "BYCODA_DEV_URL",
] as const;

function devHostKey(env: NodeJS.ProcessEnv): string {
  return DEV_HOST_SIGNALS.map((name) => env[name] ?? "").join("\0");
}

function includesDevDatabase(env: NodeJS.ProcessEnv): boolean {
  return DEV_HOST_SIGNALS.some((name) => {
    const value = env[name]?.trim().toLowerCase();
    return !!value && value !== "0" && value !== "false";
  });
}

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
  const release = join(base, RELEASE_IDENTIFIER, DATABASE);
  const dev = join(base, DEV_IDENTIFIER, DATABASE);
  const found = existsSync(release) ? [release] : [];
  // With no release database (a machine that only runs the dev app) the dev
  // database is the only session source, so it is read either way.
  if ((found.length === 0 || includesDevDatabase(env)) && existsSync(dev)) found.push(dev);
  return found;
}

let pathsCache: { key: string; at: number; value: string[] } | undefined;

/** `desktopDatabasePaths()` stats up to three files; watchers ask per tick. */
function cachedDesktopDatabasePaths(): string[] {
  const key = [
    process.env.BYCODA_DESKTOP_DB,
    process.env.APPDATA,
    process.env.XDG_DATA_HOME,
    devHostKey(process.env),
  ].join("\0");
  const now = Date.now();
  if (pathsCache?.key === key && now - pathsCache.at < 3_000) return pathsCache.value;
  const value = desktopDatabasePaths();
  pathsCache = { key, at: now, value };
  return value;
}

// One entry per project and provider set. A round over every project (110+
// registered) must find each entry again, or each round re-reads them all.
const LIST_CACHE_ENTRIES = 512;
const LIST_CACHE_BYTES = 32 * 1024 * 1024;
/** Project-list jobs queued behind the metadata worker at once; a fan-out over
 * every project waits here instead of piling into the worker queue. */
const LIST_JOB_LIMIT = 2;

type Row = Record<string, unknown>;
/** `stored`: the database's in-flight mark; `inFlight` also weighs the heartbeat. */
type Found = { row: Row; inFlight: boolean; stored: boolean; source?: DesktopReadSource };
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

export type DesktopStampRow = {
  createdAt: number;
  updatedAt: number;
  stored: boolean;
  source?: DesktopReadSource;
};
export type DesktopMetadataRecord = {
  cwd: string;
  harness: string;
  stored: boolean;
};
export type DesktopSnapshotRecord = {
  value: HostSession;
  stored: boolean;
  source?: DesktopReadSource;
};
/** A snapshot without `session.blocks`; `lastUserText` is the last user block's text ("" if none). */
export type DesktopSessionMeta = Omit<HostSession, "session"> & {
  session: Omit<Session, "blocks">;
  lastUserText: string;
};
export type DesktopSnapshotMetaRecord = { value: DesktopSessionMeta; stored: boolean };

/** Release and development apps keep separate databases, and either may hold
 * a mirrored copy of a session the other started. The copy created first
 * owns it, so a later-saved mirror never replaces the owner's transcript;
 * on a tie the earlier database (the release app) owns it. */
function ownsBefore(createdAt: number, ownerCreatedAt: number): boolean {
  if (!Number.isFinite(createdAt)) return false;
  return !Number.isFinite(ownerCreatedAt) || createdAt < ownerCreatedAt;
}

/** Pins list/point reads to the app's covering index when this database has it.
 * Without the pin a lookup by id goes through the primary key to the table row,
 * whose later columns (`created_at`, `updated_at`, ...) sit behind the whole
 * transcript's overflow pages. Scanning the index touches no transcript page. */
function coverIndex(db: DatabaseSync): string {
  try {
    return db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='sessions_cwd_cover_idx'")
      .get()
      ? " INDEXED BY sessions_cwd_cover_idx"
      : "";
  } catch {
    return "";
  }
}

/** The normalized transcript's role index, when this database has it. */
function rolesIndex(db: DatabaseSync): string {
  try {
    return db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='session_blocks_roles'")
      .get()
      ? " INDEXED BY session_blocks_roles"
      : "";
  } catch {
    return "";
  }
}

/** One statement (one read snapshot): the normalized state of `id` and, when it exists,
 * the JSON of its last user block (including a draft, like the whole-transcript scan did).
 * The role index holds the extracted role, so no block is decoded to find it. */
function lastUserBlock(
  db: DatabaseSync,
  id: string,
): { length: unknown; block: unknown } | undefined {
  return (db
    .prepare(
      `SELECT st.length AS length,
        (SELECT b.block_json FROM session_blocks b WHERE b.session_id=?1 AND b.ordinal=
          (SELECT max(u.ordinal) FROM session_blocks u${rolesIndex(db)}
            WHERE u.session_id=?1 AND json_extract(u.block_json,'$.role')='user')) AS block
       FROM session_block_state st WHERE st.session_id=?1`,
    )
    .get(id) ?? undefined) as { length: unknown; block: unknown } | undefined;
}

/** The text of a user block given as a block or as its JSON; unreadable is empty. */
function userText(block: unknown): string {
  let value = block;
  if (typeof block === "string") {
    value = parse(block);
    if (value === undefined)
      console.warn("[bycoda] last user block of a desktop transcript is unreadable");
  }
  const text = (value as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text : "";
}

/**
 * Read-only view of the sessions the Bycoda desktop app keeps on this
 * machine. The desktop is the only writer; this never writes.
 */
/** Resolves with the shared read, or rejects as soon as `signal` aborts; the read itself continues. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const abort = () => new Error("Session read cancelled before completion.");
  if (signal.aborted) return Promise.reject(abort());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abort());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export class DesktopSessions {
  constructor(
    private readonly paths: () => string[] = cachedDesktopDatabasePaths,
    private readonly platform: NodeJS.Platform = process.platform,
    /** The app's heartbeat: running state and live prompts. */
    readonly live = new DesktopLive(),
    private readonly idleMs = 5000,
    private readonly openDatabase: HostNotesDatabaseFactory = (path, options) =>
      new DatabaseSync(path, options),
  ) {}

  private stamps = new Map<string, { at: number; rows: DesktopStampRow[] }>();

  private handles = new Map<string, Handle>();
  private metadataReader?: AsyncHostNotes;
  private transcriptReader?: AsyncHostNotes;
  private readonly sessionReadProcesses = new SessionReadProcesses();
  /** Single-session point reads (stamp, metadata, reference) have their own
   * worker: they must not wait behind a project-list fan-out. */
  private pointReader?: AsyncHostNotes;
  private metadataGeneration = 0;
  private stampFlights = new Map<string, Promise<DesktopStampRow[]>>();
  private recordFlights = new Map<string, Promise<DesktopMetadataRecord | undefined>>();
  private snapshotFlights = new Map<string, Promise<DesktopSnapshotRecord | undefined>>();
  private snapshotMetaFlights = new Map<string, Promise<DesktopSnapshotMetaRecord | undefined>>();
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
    run: (db: DatabaseSync, columns: () => Set<string>, physicalId: string) => T,
    required = false,
  ): T | undefined {
    for (let attempt = 0; ; attempt++) {
      try {
        const handle = this.handle(path);
        const result = run(handle.db, () => this.columns(handle), handle.id);
        this.release(path, handle);
        return result;
      } catch (error) {
        if (isHostNotesAdmissionFault(error) || error instanceof SessionReadError) throw error;
        // A stale handle (file replaced, schema migrated) is retried once fresh.
        this.drop(path);
        if (attempt > 0) {
          console.error("Could not read desktop sessions:", error);
          if (
            required &&
            !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
          )
            throw new SessionReadError("unavailable", {
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
    const db = this.openDatabase(path, { readOnly: true });
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
    void this.sessionReadProcesses.close().catch(() => undefined);
    this.metadataFlights.clear();
    this.metadataKeys.clear();
    this.listMetadataCache.clear();
    void this.metadataReader?.close();
    this.metadataReader = undefined;
    void this.transcriptReader?.close();
    this.transcriptReader = undefined;
    void this.pointReader?.close();
    this.pointReader = undefined;
    this.stampFlights.clear();
    this.recordFlights.clear();
    this.snapshotFlights.clear();
    this.snapshotMetaFlights.clear();
    this.stamps.clear();
    this.metadataCache.clear();
    this.listSnapshots.clear();
    for (const path of Array.from(this.handles.keys())) this.drop(path);
  }
  /** Read workers release OS handles before replying; metadata stays cached. */
  releaseReadHandles(): void {
    for (const path of Array.from(this.handles.keys())) this.drop(path);
  }
  async closeAsync(): Promise<void> {
    const reader = this.metadataReader;
    const transcripts = this.transcriptReader;
    const points = this.pointReader;
    this.close();
    await Promise.all([reader?.close(), transcripts?.close(), points?.close()]);
  }

  private rows(
    db: DatabaseSync,
    columns: Set<string>,
    where: string,
    args: string[],
    /** `"meta"`: every session field, but no transcript; only the last user block's text. */
    blocks: boolean | "meta" = true,
    required = false,
  ): Found[] {
    if (!columns.has("id") || !columns.has("blocks_json")) return [];
    const optional = (name: string, fallback = "NULL") =>
      columns.has(name) ? name : `${fallback} AS ${name}`;
    const meta = blocks === "meta";
    const summaryProjection =
      !blocks &&
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_list_summaries'")
        .get();
    const transcriptView =
      !!blocks &&
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='session_transcripts'")
        .get();
    // `inbox_ask` is read through its partial index below.
    const sql = blocks
      ? `SELECT id, cwd, harness, model, model_settings, runtime_mode, title,
      provider_session_id, blocks_json,
      created_at, updated_at, ${optional("last_activity_at")},
      ${optional("branch")}, ${optional("archived", "0")}, ${optional("worktree_cwd")},
      ${optional("has_user_message", "1")}, ${optional("pinned", "0")},
      ${optional("linked_work_item_json")}, ${optional("provider_account_id")},
      ${optional("is_draft", "0")}, ${optional("inbox_ask")}, ${optional("adopted_base")},
      ${optional("pending_context_replay")}, ${optional("assistant_management_json")}
      FROM ${transcriptView && !meta ? "session_transcripts" : "sessions"} WHERE ${where}`
      : `SELECT id, cwd, harness, model, runtime_mode, title,
      provider_session_id, created_at, updated_at, ${summaryProjection ? "projection.activity_at AS last_activity_at" : optional("last_activity_at")},
      ${optional("archived", "0")}, ${optional("worktree_cwd")},
      ${optional("has_user_message", "1")}, ${optional("pinned", "0")},
      ${optional("linked_work_item_json")}, ${optional("model_settings")}, ${optional("is_draft", "0")}, ${summaryProjection ? "projection.management_json AS assistant_management_json" : optional("assistant_management_json")}
      ${
        summaryProjection
          ? `, projection.interrupted AS summary_interrupted,
        projection.provider_history AS summary_provider_history`
          : ""
      }
      FROM sessions${coverIndex(db)} ${summaryProjection ? "LEFT JOIN session_list_summaries projection ON projection.session_id=sessions.id" : ""} WHERE ${where}`;
    // The partial index on `inbox_ask IS NOT NULL` is tiny; only those rows read
    // the table.
    const asked = new Set<string>();
    if (!blocks && columns.has("inbox_ask"))
      for (const r of db
        .prepare("SELECT id, inbox_ask FROM sessions WHERE inbox_ask IS NOT NULL")
        .all())
        if (r.inbox_ask) asked.add(String(r.id));
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
      .filter(
        (row) =>
          !Number(row.is_draft) &&
          Number(row.has_user_message) &&
          !row.inbox_ask &&
          !asked.has(String(row.id)),
      )
      .map((sqlRow) => {
        const row: Row = sqlRow;
        if (summaryProjection && typeof row.summary_provider_history === "string") {
          row.provider_history = parse(row.summary_provider_history);
          row.interrupted = Number(row.summary_interrupted) !== 0;
        } else {
          if (summaryProjection) {
            const stored = db
              .prepare(
                `SELECT ${optional("last_activity_at")}, ${optional("assistant_management_json")} FROM sessions WHERE id=?`,
              )
              .get(String(row.id));
            row.last_activity_at = stored?.last_activity_at;
            row.assistant_management_json = stored?.assistant_management_json;
          }
          row.provider_history = this.readProviderHistory(db, row);
          const normalized = db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_block_state'",
            )
            .get();
          const tail =
            normalized &&
            db
              .prepare("SELECT 1 FROM session_block_state WHERE session_id=? AND length>=0")
              .get(String(row.id))
              ? db
                  .prepare(
                    "SELECT block_json FROM session_blocks WHERE session_id=? ORDER BY ordinal DESC LIMIT 2",
                  )
                  .all(String(row.id))
                  .reverse()
                  .map((block) => parse(block.block_json))
              : (parse(
                  db
                    .prepare(
                      "SELECT CASE WHEN json_valid(blocks_json) THEN json_extract(blocks_json, '$[#-2]', '$[#-1]') END AS blocks FROM sessions WHERE id=?",
                    )
                    .get(String(row.id))?.blocks,
                ) ?? []);
          row.interrupted =
            !isOwnerStoppedTurn(tail) && isTurnInterruptionNotice(tail[tail.length - 1]);
        }
        if (meta) this.readTranscriptFacts(db, row, transcriptView);
        else if (
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
        return {
          row,
          stored,
          inFlight: this.isRunning(String(row.id), stored),
        };
      });
  }

  /**
   * What a metadata read needs from the transcript, without decoding it: the text of
   * the last user block. A normalized transcript answers with one statement through the
   * `session_blocks_roles` index (no block JSON is parsed but that one block). A row whose
   * normalized copy is not authoritative still holds its blob; that is decoded as before.
   * Sets `last_user_text`, or `transcript_unreadable` when the blob cannot be decoded.
   */
  private readTranscriptFacts(db: DatabaseSync, row: Row, hasNormalizedSchema: boolean): void {
    const id = String(row.id);
    if (hasNormalizedSchema) {
      const state = lastUserBlock(db, id);
      if (state && Number(state.length) >= 0) {
        row.last_user_text = userText(state.block);
        return;
      }
    }
    const blocks = parse(row.blocks_json);
    if (!Array.isArray(blocks)) {
      row.transcript_unreadable = true;
      return;
    }
    row.last_user_text = userText(blocks.filter((block) => block?.role === "user").at(-1));
  }

  private readProviderHistory(db: DatabaseSync, row: Row) {
    const id = String(row.id);
    const normalizedSchema = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_block_state'")
      .get();
    const normalized =
      normalizedSchema &&
      Number(
        db.prepare("SELECT length FROM session_block_state WHERE session_id=?").get(id)?.length ??
          -1,
      ) >= 0;
    const projection = `json_object('role',json_extract(block_json,'$.role'),
      'draft',json_extract(block_json,'$.draft'),
      'workspacePreparationPending',json_extract(block_json,'$.workspacePreparationPending'),
      'followUpDelivery',json_extract(block_json,'$.followUpDelivery'),
      'turnModel',json_extract(block_json,'$.turnModel'),
      'handoff',json_extract(block_json,'$.handoff'))`;
    const sql = normalized
      ? `SELECT ${projection} AS fact FROM session_blocks${rolesIndex(db)} WHERE session_id=? AND json_extract(block_json,'$.role') IN ('user','handoff') ORDER BY ordinal`
      : `SELECT ${projection} AS fact FROM (SELECT value AS block_json FROM json_each((SELECT CASE WHEN json_valid(blocks_json) THEN blocks_json ELSE '[]' END FROM sessions WHERE id=?))) WHERE json_extract(block_json,'$.role') IN ('user','handoff')`;
    const facts = db
      .prepare(sql)
      .all(id)
      .map((fact) => parse(fact.fact) as Block);
    return sessionProviderHistory({
      harness: String(row.harness) as Session["harness"],
      blocks: facts,
    });
  }

  private summaryOf({ row, inFlight }: Found, projectId: string): HostSessionSummary {
    const updatedAt = Number(row.updated_at);
    return {
      ...(assistantSessionManagement(parse(row.assistant_management_json))
        ? { managedBy: assistantSessionManagement(parse(row.assistant_management_json)) }
        : {}),
      projectId,
      revision: updatedAt,
      status: inFlight ? "running" : row.interrupted ? "interrupted" : "idle",
      lastActivityAt: Number(row.last_activity_at ?? row.updated_at),
      updatedAt,
      id: String(row.id),
      cwd: workCwd(row),
      title: String(row.title ?? ""),
      harness: String(row.harness) as RemoteProvider,
      providerHistory: row.provider_history as HostSessionSummary["providerHistory"],
      model: row.model ? String(row.model) : undefined,
      runtimeMode: row.runtime_mode as HostSessionSummary["runtimeMode"],
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      createdAt: Number(row.created_at) || updatedAt,
      archived: !!Number(row.archived),
      pinned: !!Number(row.pinned),
      linkedWorkItem: parse(row.linked_work_item_json),
      needsInput: false,
      delegationParent: desktopDelegationParent(row.model_settings),
      origin: "desktop",
    };
  }

  /** The owning copy of each session across all desktop databases. `where`
   * may be derived from each database (a project filter that needs its cwds). */
  private collect(
    where: string | ((db: DatabaseSync, columns: Set<string>) => [string, string[]] | undefined),
    args: string[],
    blocks: boolean | "meta" = true,
    required = false,
  ): Found[] {
    const best = new Map<string, Found>();
    let failure: unknown;
    for (const path of this.paths()) {
      let rows: Found[] | undefined;
      try {
        rows = this.query(
          path,
          (db, columns, physicalId) => {
            const set = columns();
            const filter =
              typeof where === "string" ? ([where, args] as [string, string[]]) : where(db, set);
            if (!filter) return [];
            const rows = this.rows(db, set, filter[0], filter[1], blocks, required);
            if (blocks === true && required) {
              const source = desktopReadSource(path, physicalId, "", "");
              for (const found of rows)
                found.source = {
                  ...source,
                  cwd: String(found.row.cwd),
                  harness: String(found.row.harness),
                };
            }
            return rows;
          },
          required,
        );
      } catch (error) {
        if (isHostNotesAdmissionFault(error)) throw error;
        // One unreadable database must not fail what the other can answer.
        console.warn(`[bycoda] desktop database ${path} is unavailable; using the others`, error);
        failure ??= error;
        continue;
      }
      for (const found of rows ?? []) {
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
    // Metadata may come from the databases that answered. A transcript is never
    // taken from a mirror while its owner failed, and an empty answer from the
    // survivors cannot prove the session is absent.
    if (failure !== undefined && (blocks || best.size === 0)) throw failure;
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
    while (this.listSnapshots.size > LIST_CACHE_ENTRIES || bytes > LIST_CACHE_BYTES) {
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
    while (this.listMetadataCache.size > LIST_CACHE_ENTRIES || bytes > LIST_CACHE_BYTES) {
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
    const knownKey = this.metadataKeys.get(requestKey),
      knownEntry = knownKey ? this.listSnapshots.get(knownKey) : undefined;
    // Unchanged database files (two stats) and unchanged heartbeat: the cached
    // list is current, so no worker job is queued at all.
    if (
      knownKey &&
      knownEntry &&
      knownEntry.database === this.fingerprint() &&
      Date.now() - knownEntry.refreshed < 30_000 &&
      knownEntry.live === this.live.listVersion(knownEntry.ids, knownEntry.stored)
    ) {
      this.listSnapshots.delete(knownKey);
      this.listSnapshots.set(knownKey, knownEntry);
      return knownEntry.value;
    }
    let flight = this.metadataFlights.get(requestKey);
    if (!flight) {
      flight = this.limitListJobs(generation, (reader) =>
        reader.desktopList(projectCwd, projectId, providers, this.platform, knownEntry?.content),
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
    while (this.metadataKeys.size > LIST_CACHE_ENTRIES * 2)
      this.metadataKeys.delete(this.metadataKeys.keys().next().value!);
    let previous = this.listSnapshots.get(result.key);
    if ("unchanged" in result && previous?.content !== result.fingerprint) {
      // The cache moved or evicted the entry while the job ran. The entry this
      // request was sent with is still the content the worker confirmed.
      if (knownEntry?.content === result.fingerprint) previous = knownEntry;
      else {
        result = await this.limitListJobs(generation, (reader) =>
          reader.desktopList(projectCwd, projectId, providers, this.platform),
        );
        if (generation !== this.metadataGeneration)
          throw new Error("Desktop session metadata reader closed.");
        previous = this.listSnapshots.get(result.key);
      }
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
    while (this.listSnapshots.size > LIST_CACHE_ENTRIES || bytes > LIST_CACHE_BYTES) {
      const first = this.listSnapshots.keys().next().value;
      if (first === undefined) break;
      bytes -= this.listSnapshots.get(first)!.bytes;
      this.listSnapshots.delete(first);
    }
    return value;
  }

  private listJobs = 0;
  private listWaiters: Array<() => void> = [];
  /** At most LIST_JOB_LIMIT project-list jobs wait in the metadata worker; the
   * rest of a fan-out waits here, so they cannot fill its queue. */
  private async limitListJobs<T>(
    generation: number,
    run: (reader: AsyncHostNotes) => Promise<T>,
  ): Promise<T> {
    while (this.listJobs >= LIST_JOB_LIMIT)
      await new Promise<void>((resolve) => this.listWaiters.push(resolve));
    this.listJobs++;
    try {
      this.assertReadGeneration(generation);
      this.metadataReader ??= new AsyncHostNotes(this.paths);
      return await run(this.metadataReader);
    } finally {
      this.listJobs--;
      this.listWaiters.shift()?.();
    }
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

  /** Polling caches only database rows; heartbeat authority is evaluated after every await.
   * Stamps share one point read even when cancellable: a helper fork per stamp cost a Node start per poll. */
  async stampAsync(id: string, maxAgeMs = 0, signal?: AbortSignal) {
    const generation = this.metadataGeneration;
    const now = Date.now();
    const cached = this.stamps.get(id);
    if (cached && now - cached.at < maxAgeMs) return this.stampFromRows(id, cached.rows);
    let flight = this.stampFlights.get(id);
    if (!flight) {
      this.pointReader ??= new AsyncHostNotes(this.paths);
      flight = this.pointReader.desktopStampRows(id, this.platform);
      this.stampFlights.set(id, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.stampFlights.get(id) === current) this.stampFlights.delete(id);
        })
        .catch(() => {});
    }
    const rows = signal ? await untilAborted(flight, signal) : await flight;
    this.assertReadGeneration(generation);
    signal?.throwIfAborted();
    this.rememberStampRows(id, now, rows);
    return this.stampFromRows(id, rows);
  }

  private rememberStampRows(id: string, now: number, rows: DesktopStampRow[]) {
    if ((this.stamps.get(id)?.at ?? -Infinity) > now) return;
    this.stamps.delete(id);
    this.stamps.set(id, { at: now, rows });
    while (this.stamps.size > 64) this.stamps.delete(this.stamps.keys().next().value!);
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
    let failure: unknown;
    for (const path of this.paths()) {
      let found: DesktopStampRow | undefined;
      try {
        found = this.query(
          path,
          (db, _columns, physicalId) => {
            // The covering index answers this without reading the transcript.
            const row = db
              .prepare(
                `SELECT created_at, updated_at, cwd, harness FROM sessions${coverIndex(db)} WHERE id=?`,
              )
              .get(id);
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
            return {
              createdAt: Number(row.created_at),
              updatedAt: Number(row.updated_at),
              stored,
              source: desktopReadSource(path, physicalId, String(row.cwd), String(row.harness)),
            };
          },
          required,
        );
      } catch (error) {
        if (isHostNotesAdmissionFault(error)) throw error;
        console.warn(`[bycoda] desktop database ${path} is unavailable; using the others`, error);
        failure ??= error;
        continue;
      }
      if (found) rows.push(found);
    }
    // A failed database might hold the owning copy. The survivors' rows are
    // used for this answer but not cached; with no row at all the stamp is
    // unknown, not "missing".
    if (failure !== undefined) {
      if (rows.length === 0) throw failure;
      return rows;
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

  async projectCwdAsync(id: string, signal?: AbortSignal): Promise<string | undefined> {
    if (signal) {
      const generation = this.metadataGeneration;
      const record = await this.sessionReadProcesses.read<DesktopMetadataRecord | undefined>(
        {
          kind: "desktop",
          paths: this.paths(),
          platform: this.platform,
          method: "metadata",
          sessionId: id,
        },
        signal,
      );
      this.assertReadGeneration(generation);
      signal.throwIfAborted();
      return record?.cwd;
    }
    return (await this.metadataAsync(id))?.cwd;
  }

  /** Worker-only identity lookup. Reads existing origin identity; never initializes it. */
  readLocalSessionReference(id: string): LocalSessionLocator | undefined {
    let selected: { createdAt: number; locator?: LocalSessionLocator } | undefined;
    for (const path of this.paths()) {
      const found = this.query(
        path,
        (db) => {
          const row = db
            .prepare(`SELECT created_at FROM sessions${coverIndex(db)} WHERE id=?`)
            .get(id);
          if (!row) return undefined;
          const hasAuthority = !!db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_authority_floor'",
            )
            .get();
          const authority = hasAuthority
            ? db.prepare("SELECT phase FROM native_authority_floor WHERE session_id=?").get(id)
            : undefined;
          // Keep the selected row's identity even when it is unavailable, so a
          // duplicate ID in another profile cannot become an implicit fallback.
          // Host references are produced from Host authority; an in-flight,
          // blocked or transferred Native row is not a verified Native target.
          if (authority && authority.phase !== "NATIVE")
            return { createdAt: Number(row.created_at) };
          const hasIdentity = !!db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_authority_identity'",
            )
            .get();
          const origin = hasIdentity
            ? db
                .prepare(
                  "SELECT source_store_id,source_profile_id FROM native_authority_identity WHERE id=1",
                )
                .get()
            : undefined;
          let locator: LocalSessionLocator | undefined;
          if (
            typeof origin?.source_store_id === "string" &&
            typeof origin.source_profile_id === "string"
          ) {
            locator = {
              kind: "native",
              sourceStoreId: origin.source_store_id,
              sourceProfileId: origin.source_profile_id,
              sessionId: id,
            };
            buildLocalSessionLink(locator);
          }
          return { createdAt: Number(row.created_at), locator };
        },
        true,
      );
      if (found && (!selected || ownsBefore(found.createdAt, selected.createdAt))) selected = found;
    }
    return selected?.locator;
  }

  async localSessionReferenceAsync(id: string): Promise<LocalSessionLocator | undefined> {
    const generation = this.metadataGeneration;
    this.pointReader ??= new AsyncHostNotes(this.paths);
    const result = await this.pointReader.desktopLocalSessionReference(id, this.platform);
    this.assertReadGeneration(generation);
    return result;
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
      this.pointReader ??= new AsyncHostNotes(this.paths);
      flight = this.pointReader.desktopMetadata(id, this.platform);
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
      value && {
        cwd: value.cwd,
        harness: value.harness,
        running: this.isRunning(id, value.stored),
      }
    );
  }

  samePath(a: string, b: string): boolean {
    return sameProjectPath(a, b, this.platform);
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
    return value && { value, stored: found.stored, source: found.source };
  }

  async snapshotAsync(
    id: string,
    projectId: string,
    expectedProjectCwd?: string,
    signal?: AbortSignal,
  ): Promise<HostSession | undefined> {
    const generation = this.metadataGeneration;
    if (signal)
      return readDesktopSnapshot({
        reads: this.sessionReadProcesses,
        paths: this.paths,
        platform: this.platform,
        id,
        projectId,
        expectedProjectCwd,
        signal,
        assertCurrent: () => this.assertReadGeneration(generation),
        isRunning: (stored) => this.isRunning(id, stored),
      });
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

  /** Worker-only. Like `readSnapshotRecord` without the transcript (see `rows`, "meta"). */
  readSnapshotMetaRecord(
    id: string,
    projectId: string,
    expectedProjectCwd?: string,
  ): DesktopSnapshotMetaRecord | undefined {
    const found = this.collect("id=?", [id], "meta", true)[0];
    if (!found) return undefined;
    if (
      expectedProjectCwd !== undefined &&
      !this.samePath(String(found.row.cwd), expectedProjectCwd)
    )
      throw new Error("Desktop session project changed while reading.");
    if (found.row.transcript_unreadable) {
      console.warn(`[bycoda] desktop transcript ${id} is unreadable; skipping its snapshot`);
      return undefined;
    }
    return {
      value: {
        ...this.metaFromRow(projectId, found),
        lastUserText: String(found.row.last_user_text ?? ""),
      },
      stored: found.stored,
    };
  }

  /**
   * A desktop session without its transcript: every field of `snapshotAsync` except
   * `session.blocks`, plus the text of the last user block. For callers that decide on the
   * session's project, folder, harness, model or settings, or on its last message (explicit
   * skill names). Never use it to adopt, refresh or build provider context: those need the
   * blocks. Runs on the point worker; a normalized transcript costs a few indexed reads.
   */
  async snapshotMetaAsync(
    id: string,
    projectId: string,
    expectedProjectCwd?: string,
  ): Promise<DesktopSessionMeta | undefined> {
    const generation = this.metadataGeneration;
    const key = JSON.stringify([id, projectId, expectedProjectCwd]);
    let flight = this.snapshotMetaFlights.get(key);
    if (!flight) {
      this.pointReader ??= new AsyncHostNotes(this.paths);
      flight = this.pointReader.desktopSnapshotMeta(
        id,
        projectId,
        this.platform,
        expectedProjectCwd,
      );
      this.snapshotMetaFlights.set(key, flight);
      const current = flight;
      void flight
        .finally(() => {
          if (this.snapshotMetaFlights.get(key) === current) this.snapshotMetaFlights.delete(key);
        })
        .catch(() => {});
    }
    const record = await flight;
    this.assertReadGeneration(generation);
    if (!record) return undefined;
    // The heartbeat is evaluated here, after the await, exactly like `snapshotAsync`.
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
    // An unreadable transcript is unavailable, never empty: callers adopt and
    // refresh host copies from this snapshot, and an empty one would replace it.
    const blocks = parse(found.row.blocks_json);
    if (!Array.isArray(blocks)) {
      console.warn(`[bycoda] desktop transcript ${id} is unreadable; skipping its snapshot`);
      return undefined;
    }
    const base = this.metaFromRow(projectId, found);
    return { ...base, session: { ...base.session, blocks: blocks as Block[] } };
  }

  /** Everything of a snapshot but the transcript; the one place a desktop row becomes a session,
   * so a metadata read cannot drift from a full one. */
  private metaFromRow(
    projectId: string,
    found: Found,
  ): Omit<HostSession, "session"> & { session: Omit<Session, "blocks"> } {
    const { row } = found;
    const updatedAt = Number(row.updated_at);
    // The transcript this desktop last agreed on with the host; an older app has no column.
    const adoptedBase = parseHead(parse(row.adopted_base));
    const session: Omit<Session, "blocks"> = {
      ...(assistantSessionManagement(parse(row.assistant_management_json))
        ? { managedBy: assistantSessionManagement(parse(row.assistant_management_json)) }
        : {}),
      id: String(row.id),
      harness: String(row.harness) as Session["harness"],
      model: String(row.model ?? ""),
      modelSettings: (parse(row.model_settings) as Record<string, string>) ?? {},
      runtimeMode: row.runtime_mode as Session["runtimeMode"],
      title: String(row.title ?? ""),
      cwd: workCwd(row),
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
      ...(session.managedBy ? { managedBy: session.managedBy } : {}),
      ...(row.block_revisions
        ? { blockRevisions: row.block_revisions as Record<string, number> }
        : {}),
      projectId,
      revision: updatedAt,
      status: found.inFlight ? "running" : row.interrupted ? "interrupted" : "idle",
      lastActivityAt: Number(row.last_activity_at ?? updatedAt),
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
