import { ChangeSignal } from "./changeSignal";
import { normalizeProjectPath } from "./desktopSessions";
import { isSessionErrorBlock, sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type {
  CommandReceipt,
  HostProject,
  HostSession,
  HostSessionSummary,
  RemoteProvider,
  SessionSync,
} from "../src/features/connections/model/protocol";
import type { LinkedWorkItem } from "../src/features/sessions/model/session";
import { sessionNeedsInput, type Block } from "../src/features/sessions/model/session";
import { changedBlocks } from "../src/features/sessions/model/blockChanges";
import { streamingTextUpdate } from "../src/features/sessions/model/stableBlocks";
import { snapshotWeight } from "../src/features/connections/model/snapshotWeight";
import { blockRevisions } from "./block-revisions";
import type { BlockChanges } from "../src/features/sessions/model/blockChanges";
import type { UsageMetadataPage, UsageTurnMetadata } from "./usage-report";
export { blockRevisions } from "./block-revisions";

const CACHED_SESSIONS = 32;
// Retried commands are deduplicated by receipt; a week far outlives any retry.
const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RECEIPT_PRUNE_EVERY = 500;
// Saves caused only by streamed deltas ("soft") update memory at once but reach
// SQLite at most this often per session. Durability trade-off accepted by the
// owner: if the host process dies mid-stream, up to this much streamed text of
// the running turn may be lost and the turn is marked interrupted on restart.
// Every other save ("hard") writes immediately and flushes pending soft state
// first, so no hard event and no settled turn is ever lost.
const CHECKPOINT_MS = 1_000;

/** Latest unwritten state of a session plus its event rows, in revision order. */
interface PendingWrite {
  value: HostSession;
  events: { revision: number; event: unknown }[];
  changed: Map<string, Block>;
  structural: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// Persistent ordered aggregate: a content edit copies only O(log blocks) nodes.
// The four representatives preserve sessionIssue's turn boundary and reply rules.
interface SummaryBlocks {
  left?: SummaryBlocks;
  right?: SummaryBlocks;
  user?: Block;
  error?: Block;
  reply?: Block;
  notice?: Block;
  draft: number;
  approval: number;
  weight: number;
}
interface BlockIndex {
  positions: Map<string, number>;
  root: SummaryBlocks;
}
const blockIndexes = new WeakMap<Block[], BlockIndex>();
function aggregate(left: SummaryBlocks, right: SummaryBlocks): SummaryBlocks {
  return {
    left,
    right,
    user: right.user ?? left.user,
    error: right.error ?? left.error,
    reply: right.reply ?? left.reply,
    notice: right.notice ?? left.notice,
    draft: left.draft + right.draft,
    approval: left.approval + right.approval,
    weight: left.weight + right.weight,
  };
}
function blockSummary(block?: Block): SummaryBlocks {
  return {
    user: block?.role === "user" && !block.draft ? block : undefined,
    error: block && isSessionErrorBlock(block) ? block : undefined,
    reply: block?.role === "assistant" && block.text.trim() ? block : undefined,
    notice: block?.notice === "error" ? block : undefined,
    draft: block?.role === "user" && block.draft ? 1 : 0,
    approval: block?.approval && !block.approval.decided ? 1 : 0,
    weight: block ? snapshotWeight(block) : 0,
  };
}
function indexBlocks(blocks: Block[]): BlockIndex {
  const cached = blockIndexes.get(blocks);
  if (cached) return cached;
  const positions = new Map<string, number>();
  const build = (start: number, end: number): SummaryBlocks => {
    if (end - start <= 1) {
      const block = blocks[start];
      if (block) positions.set(block.id, start);
      return blockSummary(block);
    }
    const middle = (start + end) >>> 1;
    return aggregate(build(start, middle), build(middle, end));
  };
  const result = { positions, root: build(0, blocks.length) };
  blockIndexes.set(blocks, result);
  return result;
}
function patchBlockIndex(previous: Block[], blocks: Block[], changes?: BlockChanges): boolean {
  if (previous === blocks) return false;
  if (!changes || previous.length !== blocks.length) return true;
  const before = indexBlocks(previous);
  for (const [id, block] of changes) {
    const position = before.positions.get(id);
    if (!block || position === undefined || blocks[position] !== block) return true;
  }
  // BlockChanges describes payloads, not order (a reorder can have an empty
  // delta). Only the streaming lineage guarantees stable positions. Resolve
  // other arrays here at save time, never by scanning again at checkpoint.
  if (
    streamingTextUpdate(previous, blocks) === undefined &&
    blocks.some((block, position) => block.id !== previous[position].id)
  )
    return true;
  const patch = (
    node: SummaryBlocks,
    start: number,
    end: number,
    position: number,
  ): SummaryBlocks => {
    if (end - start <= 1) return blockSummary(blocks[position]);
    const middle = (start + end) >>> 1;
    return position < middle
      ? aggregate(patch(node.left!, start, middle, position), node.right!)
      : aggregate(node.left!, patch(node.right!, middle, end, position));
  };
  let root = before.root;
  for (const id of changes.keys()) root = patch(root, 0, blocks.length, before.positions.get(id)!);
  blockIndexes.set(blocks, { positions: before.positions, root });
  return false;
}

export class HostStore {
  readonly db: DatabaseSync;
  readonly environmentId: string;
  readonly attachmentDir: string;
  // This process is the only session writer, so recently used snapshots are
  // served from memory instead of re-parsing whole transcripts. Callers must
  // treat returned values as immutable.
  private cache = new Map<string, HostSession>();
  private cacheWeights = new Map<string, number>();
  private stateMetadata = new Map<
    string,
    { revision: number; status: HostSession["status"]; desktop: boolean }
  >();
  private receiptWrites = 0;
  // token -> data_version at the moment its device row was last seen.
  private authCache = new Map<string, number>();
  // Write-behind state, consulted before the cache and SQLite by every read.
  // Kept apart from the LRU cache so eviction can never drop unwritten data.
  private pending = new Map<string, PendingWrite>();
  private inTransaction = false;
  private commitEffects: Array<() => void> = [];
  private flushedInTransaction: PendingWrite[] = [];
  /** Snapshot upserts issued so far; lets tests count checkpoints. */
  snapshotWrites = 0;
  /** Incremented whenever session metadata or content changes in this process. */
  changeVersion = 0;
  readonly changes = new ChangeSignal();
  private projectVersions = new Map<string, number>();

  /** Like `changeVersion`, but only moves for changes inside one project. */
  projectVersion(projectId: string): number {
    return this.projectVersions.get(projectId) ?? 0;
  }

  private touchProject(projectId: string): void {
    this.projectVersions.set(projectId, this.projectVersion(projectId) + 1);
    this.changes.notify();
  }

  constructor(path: string) {
    this.attachmentDir = join(dirname(path), "attachments");
    this.db = new DatabaseSync(path);
    // WAL with synchronous=NORMAL: a commit survives a host crash; a power loss or
    // OS crash can roll back the last few commits, never corrupt the database.
    // FULL fsynced every streamed checkpoint and kept the disk (and fseventsd) busy.
    this.db
      .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_journal (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, revision INTEGER NOT NULL, metadata TEXT NOT NULL, block_ids TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_journal_blocks (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, block_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id,block_id));
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, signature TEXT NOT NULL, receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, revision));
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sync_records (table_name TEXT NOT NULL, id TEXT NOT NULL, value TEXT, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (table_name, id));`);
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all();
    if (!columns.some((column) => column.name === "summary"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN summary TEXT");
    // Plain columns mirroring snapshot fields so adopted() never parses
    // transcripts. save() is the only snapshot writer and keeps them in sync.
    if (!columns.some((column) => column.name === "has_desktop")) {
      // One transaction: a crash midway must not leave has_desktop without
      // the other columns or the backfill.
      this.db.exec(`BEGIN;
        ALTER TABLE sessions ADD COLUMN has_desktop INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN revision INTEGER;
        ALTER TABLE sessions ADD COLUMN updated_at INTEGER;
        ALTER TABLE sessions ADD COLUMN status TEXT;
        UPDATE sessions SET
          has_desktop = json_extract(snapshot, '$.desktop') IS NOT NULL,
          revision = json_extract(snapshot, '$.revision'),
          updated_at = json_extract(snapshot, '$.updatedAt'),
          status = json_extract(snapshot, '$.status');
        COMMIT;`);
    }
    // What host startup reads from every session, so it never parses a
    // transcript it does not have to rewrite. save() keeps them in sync.
    if (!columns.some((column) => column.name === "provider_session_id")) {
      this.db.exec(`BEGIN;
        ALTER TABLE sessions ADD COLUMN provider_session_id TEXT;
        ALTER TABLE sessions ADD COLUMN harness TEXT;
        ALTER TABLE sessions ADD COLUMN session_cwd TEXT;
        ALTER TABLE sessions ADD COLUMN shell_running INTEGER NOT NULL DEFAULT 0;
        UPDATE sessions SET
          provider_session_id = NULLIF(json_extract(snapshot, '$.session.providerSessionId'), ''),
          harness = json_extract(snapshot, '$.session.harness'),
          session_cwd = json_extract(snapshot, '$.session.cwd'),
          shell_running = EXISTS (
            SELECT 1 FROM json_each(snapshot, '$.session.blocks')
            WHERE COALESCE(json_extract(value, '$.shell.running'), 0) <> 0
          );
        COMMIT;`);
    }
    // Receipts only dedupe retried commands, so old ones are dead weight.
    // Existing rows are stamped now, so they get a full retention window.
    const receiptColumns = this.db.prepare("PRAGMA table_info(receipts)").all();
    if (!receiptColumns.some((column) => column.name === "created_at")) {
      this.db.exec(`BEGIN;
        ALTER TABLE receipts ADD COLUMN created_at INTEGER;
        UPDATE receipts SET created_at = ${Date.now()};
        COMMIT;`);
    }
    this.pruneReceipts();
    this.migrateSessionState();
    // Covering partial index: adopted() is answered from the index alone.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS sessions_adopted ON sessions(id, project_id, revision, updated_at, status) WHERE has_desktop=1",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS session_state_adopted ON session_state(id, project_id, revision, updated_at, status, desktop_updated_at) WHERE has_desktop=1",
    );
    // Sync pulls read records by revision range.
    this.db.exec("CREATE INDEX IF NOT EXISTS sync_records_rev ON sync_records(rev)");
    this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('environmentId', ?)").run(randomUUID());
    this.environmentId = String(
      this.db.prepare("SELECT value FROM metadata WHERE key='environmentId'").get()!.value,
    );
  }

  /** Narrow mirror of the `sessions` columns that checkpoints change. The
   * `sessions` row holds the multi-MB snapshot, and SQLite rewrites a whole
   * row (and its overflow pages) whenever any column in it changes, so
   * streaming checkpoints only touch this table. Hard saves write both, which
   * keeps the `sessions` columns reasonably current for an older host binary
   * after a rollback. Existing columns are never dropped or renamed. */
  private migrateSessionState(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS session_state (
      id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      summary TEXT,
      revision INTEGER,
      updated_at INTEGER,
      status TEXT,
      has_desktop INTEGER NOT NULL DEFAULT 0,
      desktop_updated_at INTEGER,
      provider_session_id TEXT,
      harness TEXT,
      session_cwd TEXT,
      shell_running INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS session_state_project ON session_state(project_id);`);
    // An older host binary only knows `sessions`; these keep the side table
    // current when it writes there after a rollback.
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS session_state_insert AFTER INSERT ON sessions BEGIN
      INSERT OR REPLACE INTO session_state
        (id, project_id, summary, revision, updated_at, status, has_desktop, desktop_updated_at, provider_session_id, harness, session_cwd, shell_running)
      VALUES (NEW.id, NEW.project_id, NEW.summary, NEW.revision, NEW.updated_at, NEW.status, COALESCE(NEW.has_desktop, 0),
        json_extract(NEW.snapshot, '$.desktop.updatedAt'),
        NEW.provider_session_id, NEW.harness, NEW.session_cwd, COALESCE(NEW.shell_running, 0));
    END;
    CREATE TRIGGER IF NOT EXISTS session_state_update AFTER UPDATE OF summary, revision, updated_at, status, has_desktop, provider_session_id, harness, session_cwd, shell_running ON sessions BEGIN
      UPDATE session_state SET summary=NEW.summary, revision=NEW.revision, updated_at=NEW.updated_at, status=NEW.status,
        has_desktop=COALESCE(NEW.has_desktop, 0), provider_session_id=NEW.provider_session_id, harness=NEW.harness,
        session_cwd=NEW.session_cwd, shell_running=COALESCE(NEW.shell_running, 0)
      WHERE id=NEW.id;
    END;`);
    // Idempotent: also adopts rows added while the triggers did not exist.
    this.db.exec(`INSERT OR IGNORE INTO session_state
      (id, project_id, summary, revision, updated_at, status, has_desktop, desktop_updated_at, provider_session_id, harness, session_cwd, shell_running)
      SELECT id, project_id, summary, revision, updated_at, status, has_desktop,
        json_extract(snapshot, '$.desktop.updatedAt'),
        provider_session_id, harness, session_cwd, shell_running
      FROM sessions WHERE id NOT IN (SELECT id FROM session_state)`);
  }

  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    this.flushedInTransaction = [];
    try {
      const value = fn();
      this.db.exec("COMMIT");
      this.inTransaction = false;
      this.flushedInTransaction = [];
      const effects = this.commitEffects.splice(0);
      for (const effect of effects) {
        try {
          effect();
        } catch (error) {
          console.error("Committed command dispatch failed:", error);
        }
      }
      return value;
    } catch (error) {
      this.inTransaction = false;
      this.cache.clear();
      this.cacheWeights.clear();
      this.commitEffects = [];
      // Pending state flushed inside this transaction is rolled back with it.
      for (const entry of this.flushedInTransaction.splice(0)) this.restore(entry);
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back host transaction:", rollbackError);
      }
      throw error;
    }
  }

  /** Provider side effects must never escape an uncommitted command batch. */
  afterCommit(effect: () => void): void {
    if (this.inTransaction) this.commitEffects.push(effect);
    else effect();
  }

  project(id: string): HostProject {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!row) throw new Error("Project is not registered on this machine");
    return row as unknown as HostProject;
  }

  projects(): HostProject[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY name")
      .all() as unknown as HostProject[];
  }

  addProject(cwd: string, name: string): HostProject {
    // Use the same filesystem identity as desktop session discovery. Legacy
    // spellings remain registered so their sessions and feature data stay valid.
    const path = normalizeProjectPath(cwd);
    const existing = this.projects().find((project) => normalizeProjectPath(project.cwd) === path);
    if (existing) return existing;
    this.changes.notify();
    this.db.prepare("INSERT OR IGNORE INTO projects VALUES (?, ?, ?)").run(randomUUID(), cwd, name);
    return this.db.prepare("SELECT * FROM projects WHERE cwd=?").get(cwd) as unknown as HostProject;
  }

  private remember(value: HostSession, weight?: number): HostSession {
    if (weight === undefined && this.cache.get(value.session.id) === value)
      weight = this.cacheWeights.get(value.session.id);
    weight ??= snapshotWeight(value);
    this.cache.delete(value.session.id);
    this.cache.set(value.session.id, value);
    this.cacheWeights.set(value.session.id, weight);
    let bytes = [...this.cache.keys()].reduce(
      (sum, id) => sum + (this.cacheWeights.get(id) ?? 0),
      0,
    );
    while (this.cache.size > CACHED_SESSIONS || bytes > 64 * 1024 * 1024) {
      // One active transcript is already owned by the engine. Keeping its
      // immutable reference avoids rehydrating a giant journal every token.
      if (this.cache.size === 1 && value.status === "running") break;
      const id = this.cache.keys().next().value!;
      bytes -= this.cacheWeights.get(id) ?? 0;
      this.cache.delete(id);
      this.cacheWeights.delete(id);
    }
    return value;
  }

  private find(id: string): HostSession | undefined {
    const unwritten = this.pending.get(id);
    if (unwritten) return unwritten.value;
    const cached = this.cache.get(id);
    if (cached) return this.remember(cached);
    const row = this.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(id);
    if (!row) return undefined;
    let value = JSON.parse(String(row.snapshot)) as HostSession;
    const journal = this.db.prepare("SELECT * FROM session_journal WHERE session_id=?").get(id);
    if (journal && Number(journal.revision) > value.revision) {
      const blocks = new Map(value.session.blocks.map((block) => [block.id, block]));
      const revisions = { ...value.blockRevisions };
      for (const changed of this.db
        .prepare("SELECT * FROM session_journal_blocks WHERE session_id=?")
        .all(id)) {
        blocks.set(String(changed.block_id), JSON.parse(String(changed.payload)));
        revisions[String(changed.block_id)] = Number(changed.revision);
      }
      const metadata = JSON.parse(String(journal.metadata)) as HostSession;
      const ids = JSON.parse(String(journal.block_ids)) as string[];
      value = {
        ...metadata,
        blockRevisions: Object.fromEntries(
          ids.map((blockId) => [blockId, revisions[blockId] ?? value.revision]),
        ),
        session: {
          ...metadata.session,
          blocks: ids.map((blockId) => {
            const block = blocks.get(blockId);
            if (!block) throw new Error("Incomplete session journal");
            return block;
          }),
        },
      };
    }
    return this.remember(value);
  }

  session(id: string): HostSession {
    const value = this.find(id);
    if (!value) throw new Error("Session not found on this machine");
    return value;
  }

  /** Lightweight existence/running check for queue RPCs; never loads blocks. */
  sessionStatus(id: string): string {
    const pending = this.pending.get(id);
    if (pending) return pending.value.status;
    const row = this.db.prepare("SELECT status FROM session_state WHERE id=?").get(id);
    if (!row) throw new Error("Session not found on this machine");
    return String(row.status);
  }

  summaries(projectId: string): HostSessionSummary[] {
    return this.db
      .prepare("SELECT id, summary FROM session_state WHERE project_id=?")
      .all(projectId)
      .map((row) => {
        const unwritten = this.pending.get(String(row.id));
        if (unwritten) return summary(unwritten.value);
        const cached = row.summary
          ? (JSON.parse(String(row.summary)) as HostSessionSummary)
          : undefined;
        // `model` is "" for the provider default; only its absence marks a summary
        // written before the field existed.
        if (
          typeof cached?.model === "string" &&
          cached.needsInput !== undefined &&
          cached.providerSessionId !== undefined
        )
          return cached;
        const fresh = summary(this.session(String(row.id)));
        this.db
          .prepare("UPDATE session_state SET summary=? WHERE id=?")
          .run(JSON.stringify(fresh), String(row.id));
        return fresh;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Whether any session of the project is running, without building
   * summaries. Unwritten state wins over the stored row. */
  hasRunning(projectId: string): boolean {
    for (const { value } of this.pending.values())
      if (value.projectId === projectId && value.status === "running") return true;
    for (const row of this.db
      .prepare("SELECT id FROM session_state WHERE project_id=? AND status='running'")
      .all(projectId))
      if (!this.pending.has(String(row.id))) return true;
    return false;
  }

  sync(id: string, revision?: number): SessionSync {
    const value = this.session(id);
    const { blockRevisions, ...snapshot } = value;
    if (revision === value.revision) return { kind: "unchanged", revision };
    if (revision === undefined || revision > value.revision || !blockRevisions)
      return { kind: "snapshot", value: snapshot };
    const {
      session: { blocks, ...session },
      ...rest
    } = snapshot;
    return {
      kind: "delta",
      base: revision,
      value: { ...rest, session },
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.filter((block) => (blockRevisions[block.id] ?? value.revision) > revision),
    };
  }

  /** Sessions taken over from this machine's desktop app, without parsing
   * their transcripts. */
  adopted(): {
    id: string;
    projectId: string;
    revision: number;
    updatedAt: number;
    status: HostSession["status"];
    /** The desktop copy's `updated_at` the host has caught up with. */
    desktopUpdatedAt: number;
  }[] {
    const rows = new Map(
      this.db
        .prepare(
          `SELECT id, project_id, revision, updated_at, status, desktop_updated_at
        FROM session_state WHERE has_desktop=1`,
        )
        .all()
        .map((row) => [
          String(row.id),
          {
            id: String(row.id),
            projectId: String(row.project_id),
            revision: Number(row.revision),
            updatedAt: Number(row.updated_at),
            status: String(row.status) as HostSession["status"],
            desktopUpdatedAt: Number(row.desktop_updated_at ?? 0),
          },
        ]),
    );
    for (const [id, { value }] of this.pending) {
      if (value.desktop == null) rows.delete(id);
      else
        rows.set(id, {
          id,
          projectId: value.projectId,
          revision: value.revision,
          updatedAt: value.updatedAt,
          status: value.status,
          desktopUpdatedAt: value.desktop.updatedAt,
        });
    }
    return [...rows.values()];
  }

  /** Everything startup needs per session, without parsing transcripts. */
  startupStates(): {
    id: string;
    hasDesktop: boolean;
    running: boolean;
    shellRunning: boolean;
    providerSessionId: string | null;
    harness: string | null;
    cwd: string | null;
  }[] {
    return this.db
      .prepare(
        `SELECT id, has_desktop, status, shell_running, provider_session_id, harness, session_cwd
        FROM session_state ORDER BY updated_at DESC`,
      )
      .all()
      .map((row) => {
        const unwritten = this.pending.get(String(row.id))?.value;
        if (unwritten)
          return {
            id: unwritten.session.id,
            hasDesktop: unwritten.desktop != null,
            running: unwritten.status === "running",
            shellRunning: unwritten.session.blocks.some((block) => block.shell?.running),
            providerSessionId: unwritten.session.providerSessionId || null,
            harness: unwritten.session.harness ?? null,
            cwd: unwritten.session.cwd ?? null,
          };
        return {
          id: String(row.id),
          hasDesktop: !!Number(row.has_desktop),
          running: row.status === "running",
          shellRunning: !!Number(row.shell_running),
          providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
          harness: row.harness == null ? null : String(row.harness),
          cwd: row.session_cwd == null ? null : String(row.session_cwd),
        };
      });
  }

  sessions(projectId?: string): HostSession[] {
    const rows = projectId
      ? this.db.prepare("SELECT id FROM session_state WHERE project_id=?").all(projectId)
      : this.db.prepare("SELECT id FROM session_state").all();
    return rows
      .map((row) => this.session(String(row.id)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Usage reads expose only timing/token metadata. SQLite projects persisted JSON;
   * no transcript text or full snapshot is parsed into JS on this read path. */
  usageMetadataPage(projectId: string, cursor: string | undefined, limit: number): UsageMetadataPage {
    this.project(projectId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid usage page limit");
    const candidates = this.db.prepare("SELECT st.id,CASE WHEN j.revision>s.revision THEN json_extract(j.metadata,'$.session.harness') ELSE st.harness END AS harness FROM session_state st JOIN sessions s ON s.id=st.id LEFT JOIN session_journal j ON j.session_id=st.id WHERE st.project_id=? AND st.id>? ORDER BY st.id LIMIT ?").all(projectId, cursor ?? "", limit + 1);
    const selected = candidates.slice(0, limit);
    const sessions: UsageMetadataPage["sessions"] = [];
    let budget = 32 * 1024 * 1024; let skippedSessions = 0;
    const cap = 4000;
    for (const candidate of selected) {
      const sessionId = String(candidate.id);
      const pending = this.pending.get(sessionId)?.value;
      if (pending) {
        const turns: UsageTurnMetadata[] = [];
        let visited = 0;
        for (const block of pending.session.blocks) {
          if (++visited > 10000 || turns.length > cap) break;
          if (block.role !== "user") continue;
          turns.push({ startedAt: block.startedAt, durationMs: block.durationMs, draft: block.draft, continuationOf: block.continuationOf,
            inputTokens: block.turnMetrics?.inputTokens, outputTokens: block.turnMetrics?.outputTokens, cacheReadTokens: block.turnMetrics?.cacheReadTokens, cacheWriteTokens: block.turnMetrics?.cacheWriteTokens });
        }
        sessions.push({ sessionId, provider: pending.session.harness, turns: turns.slice(0, cap), turnsTruncated: visited > 10000 || turns.length > cap });
        continue;
      }
      const size = this.db.prepare("SELECT length(CAST(snapshot AS BLOB)) + COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM session_journal_blocks WHERE session_id=?),0) + COALESCE((SELECT length(CAST(metadata AS BLOB))+length(CAST(block_ids AS BLOB)) FROM session_journal WHERE session_id=?),0) AS bytes FROM sessions WHERE id=?").get(sessionId, sessionId, sessionId);
      const bytes = Number(size?.bytes ?? 0);
      if (bytes > 4 * 1024 * 1024 || bytes > budget) { skippedSessions++; continue; }
      budget -= bytes;
      const turns = this.db.prepare(`WITH base AS MATERIALIZED (
          SELECT json_extract(value,'$.id') AS block_id,value AS payload
          FROM sessions,json_each(snapshot,'$.session.blocks') WHERE sessions.id=?
        ), current_journal AS (
          SELECT j.* FROM session_journal j JOIN sessions s ON s.id=j.session_id
          WHERE j.session_id=? AND j.revision>s.revision
        ), effective AS (
          SELECT COALESCE(d.payload,b.payload) AS payload FROM current_journal j,json_each(j.block_ids) ids
          LEFT JOIN session_journal_blocks d ON d.session_id=j.session_id AND d.block_id=ids.value
          LEFT JOIN base b ON b.block_id=ids.value
          UNION ALL SELECT payload FROM base WHERE NOT EXISTS(SELECT 1 FROM current_journal)
        ) SELECT json_extract(payload,'$.startedAt') AS startedAt,json_extract(payload,'$.durationMs') AS durationMs,
          json_extract(payload,'$.draft') AS draft,json_extract(payload,'$.continuationOf') AS continuationOf,
          json_extract(payload,'$.turnMetrics.inputTokens') AS inputTokens,json_extract(payload,'$.turnMetrics.outputTokens') AS outputTokens,
          json_extract(payload,'$.turnMetrics.cacheReadTokens') AS cacheReadTokens,json_extract(payload,'$.turnMetrics.cacheWriteTokens') AS cacheWriteTokens
        FROM effective WHERE json_extract(payload,'$.role')='user' LIMIT ?`).all(sessionId, sessionId, cap + 1) as unknown as UsageTurnMetadata[];
      sessions.push({ sessionId, provider: String(candidate.harness ?? "unknown"), turns: turns.slice(0, cap), turnsTruncated: turns.length > cap });
    }
    return { sessions, scannedSessions: selected.length, skippedSessions, nextCursor: candidates.length > limit ? String(selected.at(-1)!.id) : null };
  }

  /** Reads the indexed revision column without parsing the transcript snapshot. */
  sessionRevision(id: string): number | undefined {
    const pending = this.pending.get(id);
    if (pending) return pending.value.revision;
    const cached = this.cache.get(id);
    if (cached) return cached.revision;
    return this.sessionStateMetadata(id)?.revision;
  }

  sessionStateMetadata(
    id: string,
  ): { revision: number; status: HostSession["status"]; desktop: boolean } | undefined {
    const pending = this.pending.get(id)?.value;
    if (pending)
      return {
        revision: pending.revision,
        status: pending.status,
        desktop: pending.desktop != null,
      };
    const cached = this.cache.get(id);
    if (cached)
      return {
        revision: cached.revision,
        status: cached.status,
        desktop: cached.desktop != null,
      };
    const known = this.stateMetadata.get(id);
    if (known) {
      this.stateMetadata.delete(id);
      this.stateMetadata.set(id, known);
      return known;
    }
    const row = this.db
      .prepare("SELECT revision,status,has_desktop FROM session_state WHERE id=?")
      .get(id);
    if (!row) return undefined;
    const value = {
      revision: Number(row.revision),
      status: row.status as HostSession["status"],
      desktop: !!Number(row.has_desktop),
    };
    this.rememberStateMetadata(id, value);
    return value;
  }

  private rememberStateMetadata(
    id: string,
    value: {
      revision: number;
      status: HostSession["status"];
      desktop: boolean;
    },
  ) {
    this.stateMetadata.delete(id);
    this.stateMetadata.set(id, value);
    while (this.stateMetadata.size > 4096)
      this.stateMetadata.delete(this.stateMetadata.keys().next().value!);
  }

  private updateStateMetadata(value: HostSession) {
    const update = () =>
      this.rememberStateMetadata(value.session.id, {
        revision: value.revision,
        status: value.status,
        desktop: value.desktop != null,
      });
    if (this.inTransaction) this.commitEffects.push(update);
    else update();
  }

  /** Returns the saved value, stamped with per-block change revisions.
   * `deferred` marks a save caused purely by streamed deltas: memory is
   * current at once, SQLite catches up at the next checkpoint. */
  save(
    input: HostSession,
    event: unknown,
    options: { deferred?: boolean; blockChanges?: BlockChanges } = {},
  ): HostSession {
    this.changeVersion++;
    this.touchProject(input.projectId);
    const previous = this.find(input.session.id);
    if (previous && previous.projectId !== input.projectId) this.touchProject(previous.projectId);
    const value = {
      ...input,
      // Older snapshots have no creation time. Preserve their last recorded
      // timestamp when they are first written by this version of the host.
      createdAt: input.createdAt ?? previous?.createdAt ?? previous?.updatedAt ?? input.updatedAt,
      blockRevisions: blockRevisions(previous, input, options.blockChanges),
    };
    const id = value.session.id;
    const row = { revision: value.revision, event };
    if (options.deferred && previous) {
      let changes =
        options.blockChanges ?? changedBlocks(previous.session.blocks, value.session.blocks);
      if (!changes) {
        const position = streamingTextUpdate(previous.session.blocks, value.session.blocks);
        if (position !== undefined)
          changes = new Map([[value.session.blocks[position].id, value.session.blocks[position]]]);
      }
      const structural = patchBlockIndex(previous.session.blocks, value.session.blocks, changes);
      const entry = this.pending.get(id) ?? {
        value,
        events: [],
        changed: new Map<string, Block>(),
        structural: false,
      };
      entry.structural ||= structural;
      if (changes) for (const [id, block] of changes) if (block) entry.changed.set(id, block);
      entry.value = value;
      entry.events.push(row);
      this.pending.set(id, entry);
      this.arm(id, entry);
      this.updateStateMetadata(value);
      return value;
    }
    // Pending soft state goes out in the same write, so the stored snapshot
    // never goes backwards and event rows stay in revision order.
    const entry = this.take(id);
    try {
      this.write(value, [...(entry?.events ?? []), row]);
    } catch (error) {
      if (entry) this.restore(entry);
      throw error;
    }
    const remembered = this.remember(value);
    this.updateStateMetadata(value);
    return remembered;
  }

  /** Writes every session whose latest state is still only in memory. */
  flushAll(): void {
    for (const id of [...this.pending.keys()]) this.flushPending(id);
    for (const row of this.db.prepare("SELECT session_id FROM session_journal").all())
      this.write(this.session(String(row.session_id)), []);
  }

  private flushPending(id: string): void {
    const entry = this.take(id);
    if (!entry) return;
    try {
      this.writeJournal(entry.value, entry.events, entry);
    } catch (error) {
      this.restore(entry);
      throw error;
    }
    // The aggregate counts each block independently (a conservative estimate
    // even with shared children). Reserve space for array and revision keys.
    const {
      blockRevisions: _revisions,
      session: { blocks, ...session },
      ...metadata
    } = entry.value;
    const weight =
      indexBlocks(blocks).root.weight +
      blocks.length * 128 +
      snapshotWeight({ ...metadata, session });
    this.remember(entry.value, weight);
  }

  private take(id: string): PendingWrite | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    this.pending.delete(id);
    if (this.inTransaction) this.flushedInTransaction.push(entry);
    return entry;
  }

  /** Puts back state whose write failed or was rolled back. */
  private restore(entry: PendingWrite): void {
    const id = entry.value.session.id;
    const newer = this.pending.get(id);
    if (newer === entry) return;
    if (newer) {
      newer.events = [...entry.events, ...newer.events];
      newer.changed = new Map([...entry.changed, ...newer.changed]);
      newer.structural ||= entry.structural;
      return;
    }
    this.pending.set(id, entry);
    this.arm(id, entry);
  }

  private arm(id: string, entry: PendingWrite): void {
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      try {
        this.flushPending(id);
      } catch (error) {
        // Stays pending and is retried; a timer must never take the host down.
        console.error(
          "Session checkpoint failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }, CHECKPOINT_MS);
    entry.timer.unref?.();
  }

  private write(value: HostSession, rows: { revision: number; event: unknown }[]): void {
    // Both tables store the same summary: build and serialize it once per save.
    const summaryJson = JSON.stringify(summary(value));
    const run = () => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status, provider_session_id, harness, session_cwd, shell_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, snapshot=excluded.snapshot, summary=excluded.summary, has_desktop=excluded.has_desktop, revision=excluded.revision, updated_at=excluded.updated_at, status=excluded.status, provider_session_id=excluded.provider_session_id, harness=excluded.harness, session_cwd=excluded.session_cwd, shell_running=excluded.shell_running`,
        )
        .run(
          value.session.id,
          value.projectId,
          JSON.stringify(value),
          summaryJson,
          value.desktop == null ? 0 : 1,
          value.revision,
          value.updatedAt,
          value.status,
          value.session.providerSessionId || null,
          value.session.harness ?? null,
          value.session.cwd ?? null,
          value.session.blocks.some((block) => block.shell?.running) ? 1 : 0,
        );
      this.db
        .prepare(
          `INSERT INTO session_state (id, project_id, summary, revision, updated_at, status, has_desktop, desktop_updated_at, provider_session_id, harness, session_cwd, shell_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, summary=excluded.summary, revision=excluded.revision, updated_at=excluded.updated_at, status=excluded.status, has_desktop=excluded.has_desktop, desktop_updated_at=excluded.desktop_updated_at, provider_session_id=excluded.provider_session_id, harness=excluded.harness, session_cwd=excluded.session_cwd, shell_running=excluded.shell_running`,
        )
        .run(
          value.session.id,
          value.projectId,
          summaryJson,
          value.revision,
          value.updatedAt,
          value.status,
          value.desktop == null ? 0 : 1,
          value.desktop?.updatedAt ?? null,
          value.session.providerSessionId || null,
          value.session.harness ?? null,
          value.session.cwd ?? null,
          value.session.blocks.some((block) => block.shell?.running) ? 1 : 0,
        );
      const insert = this.db.prepare("INSERT INTO events VALUES (?, ?, ?)");
      for (const row of rows) insert.run(value.session.id, row.revision, JSON.stringify(row.event));
      this.db
        .prepare("DELETE FROM events WHERE session_id=? AND revision<?")
        .run(value.session.id, value.revision - 2_000);
      this.db.prepare("DELETE FROM session_journal WHERE session_id=?").run(value.session.id);
      this.db
        .prepare("DELETE FROM session_journal_blocks WHERE session_id=?")
        .run(value.session.id);
    };
    if (this.inTransaction) run();
    else this.transaction(run);
    this.snapshotWrites++;
  }

  /** Streaming checkpoints serialize changed blocks only. Hard commands still
   * commit a full compatible checkpoint together with their receipt. */
  private writeJournal(
    value: HostSession,
    rows: { revision: number; event: unknown }[],
    changes?: PendingWrite,
  ): void {
    const id = value.session.id;
    const journal = this.db
      .prepare("SELECT revision FROM session_journal WHERE session_id=?")
      .get(id);
    const incremental = changes && !changes.structural;
    const previous =
      journal ?? this.db.prepare("SELECT revision FROM session_state WHERE id=?").get(id);
    const revision = Number(previous?.revision ?? -1);
    const {
      blockRevisions: _revisions,
      session: { blocks, ...session },
      ...rest
    } = value;
    const run = () => {
      const writeBlock = this.db.prepare(
        "INSERT INTO session_journal_blocks VALUES (?, ?, ?, ?) ON CONFLICT(session_id,block_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
      );
      for (const block of incremental ? changes.changed.values() : blocks) {
        const stamp = value.blockRevisions?.[block.id] ?? value.revision;
        if (stamp > revision) writeBlock.run(id, block.id, stamp, JSON.stringify(block));
      }
      if (incremental && journal)
        this.db
          .prepare("UPDATE session_journal SET revision=?,metadata=? WHERE session_id=?")
          .run(value.revision, JSON.stringify({ ...rest, session }), id);
      else
        this.db
          .prepare(
            "INSERT INTO session_journal VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata,block_ids=excluded.block_ids",
          )
          .run(
            id,
            value.revision,
            JSON.stringify({ ...rest, session }),
            JSON.stringify(blocks.map((block) => block.id)),
          );
      this.db
        .prepare(
          "UPDATE session_state SET summary=?, revision=?, updated_at=?, status=?, has_desktop=?, desktop_updated_at=? WHERE id=?",
        )
        .run(
          JSON.stringify(summary(value)),
          value.revision,
          value.updatedAt,
          value.status,
          value.desktop == null ? 0 : 1,
          value.desktop?.updatedAt ?? null,
          id,
        );
      const insert = this.db.prepare("INSERT INTO events VALUES (?, ?, ?)");
      for (const row of rows) insert.run(id, row.revision, JSON.stringify(row.event));
      this.db
        .prepare("DELETE FROM events WHERE session_id=? AND revision<?")
        .run(id, value.revision - 2_000);
    };
    if (this.inTransaction) run();
    else this.transaction(run);
  }

  updateSession(
    id: string,
    patch: {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      linkedWorkItem?: LinkedWorkItem | null;
    },
  ): HostSessionSummary {
    return this.transaction(() => {
      const current = this.session(id);
      if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 200))
        throw new Error("Invalid session title");
      const next = this.save(
        {
          ...current,
          revision: current.revision + 1,
          archived: patch.archived ?? current.archived,
          pinned: patch.pinned ?? current.pinned,
          session: {
            ...current.session,
            ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
            ...(patch.linkedWorkItem === undefined
              ? {}
              : { linkedWorkItem: patch.linkedWorkItem ?? undefined }),
          },
        },
        { type: "session.metadata", patch },
      );
      return summary(next);
    });
  }

  deleteSession(id: string): void {
    this.transaction(() => {
      const current = this.session(id);
      if (current.status === "running") throw new Error("Stop this session before deleting it");
      this.take(id);
      this.db.prepare("DELETE FROM events WHERE session_id=?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
      this.cache.delete(id);
      this.commitEffects.push(() => this.stateMetadata.delete(id));
      this.changeVersion++;
      this.touchProject(current.projectId);
    });
  }

  receipt(id: string, signature: string): CommandReceipt | undefined {
    const row = this.db.prepare("SELECT * FROM receipts WHERE id=?").get(id);
    if (!row) return undefined;
    if (row.signature !== signature)
      throw new Error("Command ID was already used with a different payload");
    return JSON.parse(String(row.receipt)) as CommandReceipt;
  }

  receiptStatus(id: string): CommandReceipt | undefined {
    const row = this.db.prepare("SELECT receipt FROM receipts WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.receipt)) as CommandReceipt) : undefined;
  }

  recordReceipt(signature: string, receipt: CommandReceipt): void {
    this.db
      .prepare("INSERT INTO receipts (id, signature, receipt, created_at) VALUES (?, ?, ?, ?)")
      .run(receipt.commandId, signature, JSON.stringify(receipt), Date.now());
    if (++this.receiptWrites % RECEIPT_PRUNE_EVERY === 0) this.pruneReceipts();
  }

  /** Clients retry a command for seconds to minutes, never days. */
  pruneReceipts(now = Date.now()): void {
    this.db
      .prepare("DELETE FROM receipts WHERE created_at IS NULL OR created_at < ?")
      .run(now - RECEIPT_RETENTION_MS);
  }

  events(
    id: string,
    after: number,
  ): { snapshot?: HostSession; events?: unknown[]; revision: number } {
    const snapshot = this.session(id);
    const rows: { revision: number; event: unknown }[] = this.db
      .prepare(
        "SELECT revision, payload FROM events WHERE session_id=? AND revision>? ORDER BY revision",
      )
      .all(id, after)
      .map((row) => ({
        revision: Number(row.revision),
        event: JSON.parse(String(row.payload)),
      }));
    // Event rows of unwritten soft saves are newer than every stored row.
    for (const row of this.pending.get(id)?.events ?? []) if (row.revision > after) rows.push(row);
    if (
      after > snapshot.revision ||
      (after < snapshot.revision && Number(rows[0]?.revision) !== after + 1)
    ) {
      return { snapshot, revision: snapshot.revision };
    }
    return {
      events: rows,
      revision: snapshot.revision,
    };
  }

  issueDevice(name: string): { id: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run(id, name, this.hash(token));
    return { id, token };
  }

  revokeDevice(id: string): boolean {
    this.authCache.clear();
    return Number(this.db.prepare("DELETE FROM devices WHERE id=?").run(id).changes) > 0;
  }

  /** Owner-facing metadata only: device token hashes must never leave the store. */
  pairedDevices(currentToken: string): { devices: { id: string; name: string; isCurrent: boolean }[]; devicesTruncated: boolean } {
    const hash = this.hash(currentToken);
    if (!this.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash)) throw new Error("Device authorization was revoked");
    const rows = this.db.prepare("SELECT id, name, hash=? AS is_current FROM devices ORDER BY is_current DESC, id LIMIT 257").all(hash);
    return { devices: rows.slice(0, 256).map((row) => ({ id: String(row.id), name: String(row.name).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) || String(row.id), isCurrent: Number(row.is_current) === 1 })), devicesTruncated: rows.length > 256 };
  }

  /** The current device has a separate explicit revoke-self flow. */
  revokeOtherDevice(id: string, currentToken: string): boolean {
    const hash = this.hash(currentToken);
    const caller = this.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash);
    if (!caller) throw new Error("Device authorization was revoked");
    if (caller.id === id) throw new Error("Use the revoke-self action for this device");
    this.authCache.clear();
    return Number(this.db.prepare("DELETE FROM devices WHERE id=? AND hash<>? AND EXISTS (SELECT 1 FROM devices WHERE hash=?)").run(id, hash, hash).changes) > 0;
  }

  /** Lets a desktop revoke only the credential it is using. */
  revokeToken(token: string): boolean {
    this.authCache.clear();
    return (
      Number(this.db.prepare("DELETE FROM devices WHERE hash=?").run(this.hash(token)).changes) > 0
    );
  }

  /** Long polls re-check the credential on every tick, so a positive answer
   * is remembered. It is dropped at once by a revocation through this store,
   * and by any commit from another connection (the CLI revoking from its own
   * process) via SQLite's data_version, which this host's own writes never
   * move. */
  authenticated(token: string): boolean {
    const version = this.dataVersion();
    if (this.authCache.get(token) === version) return true;
    this.authCache.delete(token);
    const known = !!this.db.prepare("SELECT id FROM devices WHERE hash=?").get(this.hash(token));
    if (known) {
      this.authCache.set(token, version);
      while (this.authCache.size > 256) this.authCache.delete(this.authCache.keys().next().value!);
    }
    return known;
  }

  private dataVersionStatement?: ReturnType<DatabaseSync["prepare"]>;

  private dataVersion(): number {
    this.dataVersionStatement ??= this.db.prepare("PRAGMA data_version");
    return Number(this.dataVersionStatement.get()?.data_version);
  }

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  close(): void {
    try {
      this.flushAll();
    } finally {
      this.db.close();
    }
  }
}

export function summary(value: HostSession): HostSessionSummary {
  const blocks = value.session.blocks;
  const { root, positions } = indexBlocks(blocks);
  const representatives = [...new Set([root.user, root.error, root.reply, root.notice])]
    .filter((block): block is Block => block !== undefined)
    .sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  return {
    ...summaryFromBlocks({ ...value, session: { ...value.session, blocks: representatives } }),
    draft: root.draft > 0,
    needsInput:
      !value.session.worktreeRemoved &&
      (root.approval > 0 || value.session.pendingQuestion != null),
  };
}

function summaryFromBlocks(value: HostSession): HostSessionSummary {
  const issue = sessionIssue({ ...value.session, busy: value.status === "running" });
  const turn = value.session.blocks.findLast((block) => block.role === "user" && !block.draft);
  return {
    ...(issue
      ? {
          issue,
          issueTurnId: turn?.id,
          issueMessage: (
            value.session.retryMessage ||
            value.session.blocks.findLast((block) => block.notice === "error")?.text ||
            ""
          ).slice(0, 500),
        }
      : {}),
    projectId: value.projectId,
    revision: value.revision,
    runId: value.runId,
    status: value.status,
    updatedAt: value.updatedAt,
    id: value.session.id,
    cwd: value.session.cwd,
    title: value.session.title,
    harness: value.session.harness as RemoteProvider,
    model: value.session.model,
    runtimeMode: value.session.runtimeMode,
    providerSessionId: value.session.providerSessionId ?? null,
    createdAt: value.createdAt ?? value.updatedAt,
    archived: value.archived,
    pinned: value.pinned,
    linkedWorkItem: value.session.linkedWorkItem,
    needsInput: sessionNeedsInput(value.session),
    draft: value.session.blocks.some((block) => block.role === "user" && block.draft),
  };
}
