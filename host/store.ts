import { ChangeSignal } from "./changeSignal";
import { normalizeProjectPath } from "./desktopSessions";
import { isSessionErrorBlock, sessionIssue } from "../src/features/sessions/model/sessionIssue";
import { StoreDatabase, type StoreStatement } from "./store-db";
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
import type {
  ManagedWorkspace,
  WorkspaceFeatureClaim,
  WorkspaceOperation,
  WorkspacePolicyOverride,
  WorkspaceState,
} from "./workspace-contracts";
import type { WorkspaceActivityPersistence } from "./workspace-activity-store";
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
const CHECKPOINT_MS = 1000;
/** Latest unwritten state of a session plus its event rows, in revision order. */
interface PendingWrite {
  value: HostSession;
  events: {
    revision: number;
    event: unknown;
  }[];
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
  readonly db: StoreDatabase;
  readonly ready: Promise<void>;
  private closePromise?: Promise<void>;
  environmentId = "";
  readonly attachmentDir: string;
  // This process is the only session writer, so recently used snapshots are
  // served from memory instead of re-parsing whole transcripts. Callers must
  // treat returned values as immutable.
  private cache = new Map<string, HostSession>();
  private cacheWeights = new Map<string, number>();
  private stateMetadata = new Map<
    string,
    {
      revision: number;
      status: HostSession["status"];
      desktop: boolean;
    }
  >();
  private receiptWrites = 0;
  // token -> data_version at the moment its device row was last seen.
  private authCache = new Map<string, number>();
  // Write-behind state, consulted before the cache and SQLite by every read.
  // Kept apart from the LRU cache so eviction can never drop unwritten data.
  private pending = new Map<string, PendingWrite>();
  private inTransaction = false;
  private commitEffects: Array<() => void | Promise<void>> = [];
  private flushedInTransaction: PendingWrite[] = [];
  /** Snapshot upserts issued so far; lets tests count checkpoints. */
  snapshotWrites = 0;
  /** Incremented whenever session metadata or content changes in this process. */
  private committedChangeVersion = 0;
  private transactionChanges = 0;
  private transactionProjectChanges = new Map<string, number>();
  get changeVersion(): number {
    return this.committedChangeVersion + (this.transactionActive ? this.transactionChanges : 0);
  }
  private bumpChangeVersion(): void {
    if (this.transactionActive) this.transactionChanges++;
    else this.committedChangeVersion++;
  }
  readonly changes = new ChangeSignal();
  private projectVersions = new Map<string, number>();
  private summaryRows = new Map<
    string,
    {
      version: number;
      external: number;
      rows: Map<string, HostSessionSummary>;
      sorted?: HostSessionSummary[];
    }
  >();
  /** Patch one streamed row instead of reparsing the project's entire history. */
  private async savedSummary(value: HostSession): Promise<void> {
    if (this.closePromise) return;
    if (this.inTransaction) {
      this.afterCommit(() => {
        if (!this.closePromise) return this.db.scope(() => this.savedSummary(value));
      });
      return;
    }
    const entry = this.summaryRows.get(value.projectId);
    if (!entry) return;
    if (
      this.inTransaction ||
      entry.version + 1 !== this.projectVersion(value.projectId) ||
      entry.external !== (await this.dataVersion())
    ) {
      this.summaryRows.delete(value.projectId);
      return;
    }
    entry.rows.set(value.session.id, summary(value));
    entry.version = this.projectVersion(value.projectId);
    entry.sorted = undefined;
  }
  /** Like `changeVersion`, but only moves for changes inside one project. */
  projectVersion(projectId: string): number {
    return (
      (this.projectVersions.get(projectId) ?? 0) +
      (this.transactionActive ? (this.transactionProjectChanges.get(projectId) ?? 0) : 0)
    );
  }
  private touchProject(projectId: string): void {
    if (this.transactionActive)
      this.transactionProjectChanges.set(
        projectId,
        (this.transactionProjectChanges.get(projectId) ?? 0) + 1,
      );
    else {
      this.projectVersions.set(projectId, this.projectVersion(projectId) + 1);
      this.changes.notify();
    }
  }
  constructor(path: string) {
    this.attachmentDir = join(dirname(path), "attachments");
    this.db = new StoreDatabase(path);
    this.db.onMutation = (sql) => this.externalMutation(sql);
    this.db.onCommit = (effect) => this.afterCommit(effect);
    this.ready = this.db
      .storeScope(async () => await this.initialize())
      .catch((error) => {
        this.db.fail(error);
        throw error;
      });
    void this.ready.catch(() => undefined);
  }
  private externalMutation(sql: string): void {
    if (
      /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|REPLACE\s+INTO)\s+["`\[]?devices\b/i.test(
        sql,
      )
    )
      this.authCache.clear();
    if (
      !/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|REPLACE\s+INTO)\s+["`\[]?(?:sessions|session_state|session_journal|session_journal_blocks)\b/i.test(
        sql,
      )
    )
      return;
    this.cache.clear();
    this.cacheWeights.clear();
    this.summaryRows.clear();
    this.stateMetadata.clear();
    this.bumpChangeVersion();
    for (const project of this.projectVersions.keys()) this.touchProject(project);
  }
  private async initialize(): Promise<void> {
    // WAL with synchronous=NORMAL: a commit survives a host crash; a power loss or
    // OS crash can roll back the last few commits, never corrupt the database.
    // FULL fsynced every streamed checkpoint and kept the disk (and fseventsd) busy.
    await this.db
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
    // Additive, host-local records: deleting a conversation or project must not
    // cascade into loss of branch ownership, recovery journals or receipts.
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_workspaces (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, project_id TEXT NOT NULL,
        environment_id TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE, branch_ref TEXT NOT NULL, state TEXT NOT NULL,
        revision INTEGER NOT NULL, payload TEXT NOT NULL,
        UNIQUE(repository_id, environment_id, owner_kind, owner_id),
        UNIQUE(repository_id, branch_ref)
      );
      CREATE INDEX IF NOT EXISTS managed_workspaces_project ON managed_workspaces(project_id, environment_id);
      CREATE TABLE IF NOT EXISTS workspace_operations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, phase TEXT NOT NULL, payload TEXT NOT NULL,
        UNIQUE(workspace_id, kind, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS workspace_mutation_receipts (
        scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, signature TEXT NOT NULL,
        response TEXT NOT NULL, PRIMARY KEY(scope, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS workspace_policies (
        project_id TEXT NOT NULL, environment_id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(project_id, environment_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_feature_claims (
        id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, project_id TEXT NOT NULL,
        feature_key TEXT NOT NULL, scope TEXT NOT NULL, workspace_id TEXT NOT NULL,
        payload TEXT NOT NULL, UNIQUE(repository_id, feature_key, scope)
      );
      CREATE INDEX IF NOT EXISTS workspace_feature_claims_workspace ON workspace_feature_claims(workspace_id);
      CREATE TABLE IF NOT EXISTS workspace_execution_activities (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS workspace_execution_activities_workspace ON workspace_execution_activities(workspace_id);
      CREATE TABLE IF NOT EXISTS workspace_execution_reservations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL
      );
    `);
    const columns = await this.db.prepare("PRAGMA table_info(sessions)").all();
    if (!columns.some((column) => column.name === "summary"))
      await this.db.exec("ALTER TABLE sessions ADD COLUMN summary TEXT");
    // Plain columns mirroring snapshot fields so adopted() never parses
    // transcripts. save() is the only snapshot writer and keeps them in sync.
    if (!columns.some((column) => column.name === "has_desktop")) {
      // One transaction: a crash midway must not leave has_desktop without
      // the other columns or the backfill.
      await this.db.exec(`BEGIN;
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
      await this.db.exec(`BEGIN;
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
    const receiptColumns = await this.db.prepare("PRAGMA table_info(receipts)").all();
    if (!receiptColumns.some((column) => column.name === "created_at")) {
      await this.db.exec(`BEGIN;
        ALTER TABLE receipts ADD COLUMN created_at INTEGER;
        UPDATE receipts SET created_at = ${Date.now()};
        COMMIT;`);
    }
    await this.pruneReceipts();
    await this.migrateSessionState();
    // Covering partial index: adopted() is answered from the index alone.
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS sessions_adopted ON sessions(id, project_id, revision, updated_at, status) WHERE has_desktop=1",
    );
    await this.db.exec(
      "CREATE INDEX IF NOT EXISTS session_state_adopted ON session_state(id, project_id, revision, updated_at, status, desktop_updated_at) WHERE has_desktop=1",
    );
    // Sync pulls read records by revision range.
    await this.db.exec("CREATE INDEX IF NOT EXISTS sync_records_rev ON sync_records(rev)");
    await this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES ('environmentId', ?)")
      .run(randomUUID());
    this.environmentId = String(
      (await this.db.prepare("SELECT value FROM metadata WHERE key='environmentId'").get())!.value,
    );
  }
  /** Narrow mirror of the `sessions` columns that checkpoints change. The
   * `sessions` row holds the multi-MB snapshot, and SQLite rewrites a whole
   * row (and its overflow pages) whenever any column in it changes, so
   * streaming checkpoints only touch this table. Hard saves write both, which
   * keeps the `sessions` columns reasonably current for an older host binary
   * after a rollback. Existing columns are never dropped or renamed. */
  private async migrateSessionState(): Promise<void> {
    await this.db.exec(`CREATE TABLE IF NOT EXISTS session_state (
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
    await this.db
      .exec(`CREATE TRIGGER IF NOT EXISTS session_state_insert AFTER INSERT ON sessions BEGIN
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
    await this.db.exec(`INSERT OR IGNORE INTO session_state
      (id, project_id, summary, revision, updated_at, status, has_desktop, desktop_updated_at, provider_session_id, harness, session_cwd, shell_running)
      SELECT id, project_id, summary, revision, updated_at, status, has_desktop,
        json_extract(snapshot, '$.desktop.updatedAt'),
        provider_session_id, harness, session_cwd, shell_running
      FROM sessions WHERE id NOT IN (SELECT id FROM session_state)`);
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.db.scope(async () => {
      if (this.inTransaction) return await fn();
      await this.db.exec("BEGIN IMMEDIATE");
      const pendingBefore = new Map(
        [...this.pending].map(([id, entry]) => [
          id,
          {
            ...entry,
            events: [...entry.events],
            changed: new Map(entry.changed),
            timer: undefined,
          },
        ]),
      );
      this.inTransaction = true;
      this.transactionChanges = 0;
      this.transactionProjectChanges.clear();
      this.flushedInTransaction = [];
      try {
        const value = await fn();
        await this.db.exec("COMMIT");
        this.committedChangeVersion += this.transactionChanges;
        for (const [id, count] of this.transactionProjectChanges)
          this.projectVersions.set(id, (this.projectVersions.get(id) ?? 0) + count);
        const changed = this.transactionProjectChanges.size > 0;
        this.inTransaction = false;
        this.transactionChanges = 0;
        this.transactionProjectChanges.clear();
        this.flushedInTransaction = [];
        const effects = this.commitEffects.splice(0);
        this.db.outsideScope(() => {
          try {
            if (changed) this.changes.notify();
          } catch (error) {
            console.error("Committed change notification failed:", error);
          }
          for (const effect of effects) {
            try {
              void Promise.resolve(effect()).catch((error) =>
                console.error("Committed command dispatch failed:", error),
              );
            } catch (error) {
              console.error("Committed command dispatch failed:", error);
            }
          }
        });
        return value;
      } catch (error) {
        this.inTransaction = false;
        this.transactionChanges = 0;
        this.transactionProjectChanges.clear();
        this.cache.clear();
        this.summaryRows.clear();
        this.cacheWeights.clear();
        this.stateMetadata.clear();
        this.authCache.clear();
        this.commitEffects = [];
        this.flushedInTransaction = [];
        for (const entry of this.pending.values()) clearTimeout(entry.timer);
        this.pending.clear();
        for (const entry of pendingBefore.values()) this.restore(entry);
        try {
          await this.db.exec("ROLLBACK");
        } catch (rollbackError) {
          console.error("Could not roll back host transaction:", rollbackError);
        }
        throw error;
      }
    });
  }
  /** Derived readers may use uncommitted rows, but must not publish them in a
   * revision cache: a rollback followed by another write can reuse a revision. */
  get transactionActive(): boolean {
    return this.db.ownsScope && this.inTransaction;
  }
  /** Provider side effects must never escape an uncommitted command batch. */
  afterCommit(effect: () => void | Promise<void>): void {
    if (this.transactionActive) this.commitEffects.push(effect);
    else {
      this.db.outsideScope(() => {
        try {
          void Promise.resolve(effect()).catch((error) =>
            console.error("Committed command dispatch failed:", error),
          );
        } catch (error) {
          console.error("Committed command dispatch failed:", error);
        }
      });
    }
  }
  async managedWorkspace(id: string): Promise<ManagedWorkspace | null> {
    return this.db.storeScope(async () => {
      const row = await this.db
        .prepare("SELECT payload FROM managed_workspaces WHERE id=?")
        .get(id);
      return row ? JSON.parse(String(row.payload)) : null;
    });
  }
  async managedWorkspaces(
    filter: {
      projectId?: string;
      repositoryId?: string;
      environmentId?: string;
      states?: WorkspaceState[];
    } = {},
  ): Promise<ManagedWorkspace[]> {
    return this.db.storeScope(async () => {
      const clauses: string[] = [],
        values: string[] = [];
      for (const [column, value] of [
        ["project_id", filter.projectId],
        ["repository_id", filter.repositoryId],
        ["environment_id", filter.environmentId],
      ])
        if (value !== undefined) {
          clauses.push(`${column}=?`);
          values.push(value);
        }
      if (filter.states) {
        if (!filter.states.length) return [];
        clauses.push(`state IN (${filter.states.map(() => "?").join(",")})`);
        values.push(...filter.states);
      }
      const rows = await this.db
        .prepare(
          `SELECT payload FROM managed_workspaces${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id`,
        )
        .all(...values);
      return rows.map((row) => JSON.parse(String(row.payload)));
    });
  }
  async insertManagedWorkspace(workspace: ManagedWorkspace): Promise<void> {
    return this.db.storeScope(async () => {
      await this.db
        .prepare(`INSERT INTO managed_workspaces
        (id, repository_id, project_id, environment_id, owner_kind, owner_id, path, branch_ref, state, revision, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          workspace.id,
          workspace.repositoryId,
          workspace.projectId,
          workspace.environmentId,
          workspace.owner.kind,
          workspace.owner.id,
          workspace.path,
          workspace.branchRef,
          workspace.state,
          workspace.revision,
          JSON.stringify(workspace),
        );
    });
  }
  async updateManagedWorkspace(
    workspace: ManagedWorkspace,
    expectedRevision: number,
    options: { retarget?: boolean } = {},
  ): Promise<void> {
    return this.db.storeScope(async () => {
      const previous = await this.managedWorkspace(workspace.id);
      if (
        !previous ||
        previous.revision !== expectedRevision ||
        workspace.revision !== expectedRevision + 1
      )
        throw Object.assign(new Error("Workspace revision changed"), {
          code: "WORKSPACE_REVISION_CONFLICT",
        });
      for (const key of [
        "repositoryId",
        "projectId",
        "environmentId",
        "owner",
        "path",
        "branchRef",
        "baseRef",
        "baseCommit",
      ] as const)
        if (canonicalWorkspaceJson(previous[key]) !== canonicalWorkspaceJson(workspace[key]))
          throw new Error(`Workspace identity is immutable: ${key}`);
      if (
        !options.retarget &&
        (previous.targetBranchRef !== workspace.targetBranchRef ||
          (previous as ManagedWorkspace & { targetDirectory?: string }).targetDirectory !==
            (workspace as ManagedWorkspace & { targetDirectory?: string }).targetDirectory)
      )
        throw new Error("Workspace identity is immutable: targetBranchRef/targetDirectory");
      const result = await this.db
        .prepare(
          "UPDATE managed_workspaces SET state=?, revision=?, payload=? WHERE id=? AND revision=?",
        )
        .run(
          workspace.state,
          workspace.revision,
          JSON.stringify(workspace),
          workspace.id,
          expectedRevision,
        );
      if (!Number(result.changes))
        throw Object.assign(new Error("Workspace revision changed"), {
          code: "WORKSPACE_REVISION_CONFLICT",
        });
    });
  }
  async workspaceOperation(id: string): Promise<WorkspaceOperation | null> {
    return this.db.storeScope(async () => {
      const row = await this.db
        .prepare("SELECT payload FROM workspace_operations WHERE id=?")
        .get(id);
      return row ? JSON.parse(String(row.payload)) : null;
    });
  }
  workspaceActivityPersistence(): WorkspaceActivityPersistence {
    return {
      load: () =>
        this.db.storeScope(async () => {
          const activities = await this.db
            .prepare("SELECT payload FROM workspace_execution_activities ORDER BY id")
            .all();
          const reservations = await this.db
            .prepare("SELECT payload FROM workspace_execution_reservations ORDER BY id")
            .all();
          return {
            activities: activities.map((row) => JSON.parse(String(row.payload))),
            reservations: reservations.map((row) => JSON.parse(String(row.payload))),
          };
        }),
      saveActivity: (activity) =>
        this.transaction(async () => {
          if (
            await this.db
              .prepare("SELECT id FROM workspace_execution_reservations WHERE workspace_id=?")
              .get(activity.workspaceId)
          )
            throw new Error("Workspace is reserved.");
          await this.db
            .prepare(
              "INSERT INTO workspace_execution_activities (id, workspace_id, payload) VALUES (?, ?, ?)",
            )
            .run(activity.id, activity.workspaceId, JSON.stringify(activity));
        }),
      removeActivity: (id) =>
        this.db.storeScope(async () => {
          await this.db.prepare("DELETE FROM workspace_execution_activities WHERE id=?").run(id);
        }),
      saveReservation: (reservation) =>
        this.transaction(async () => {
          if (
            await this.db
              .prepare("SELECT id FROM workspace_execution_activities WHERE workspace_id=?")
              .get(reservation.workspaceId)
          )
            throw new Error("Workspace is still in use or activity is unknown.");
          const previous = await this.db
            .prepare("SELECT payload FROM workspace_execution_reservations WHERE id=?")
            .get(reservation.id);
          if (previous) {
            if (
              canonicalWorkspaceJson(JSON.parse(String(previous.payload))) !==
              canonicalWorkspaceJson(reservation)
            )
              throw new Error("Workspace reservation request changed.");
            return;
          }
          await this.db
            .prepare(
              "INSERT INTO workspace_execution_reservations (id, workspace_id, operation_id, payload) VALUES (?, ?, ?, ?)",
            )
            .run(
              reservation.id,
              reservation.workspaceId,
              reservation.operationId,
              JSON.stringify(reservation),
            );
        }),
      removeReservation: (id) =>
        this.db.storeScope(async () => {
          await this.db.prepare("DELETE FROM workspace_execution_reservations WHERE id=?").run(id);
        }),
    };
  }
  async workspaceOperations(workspaceId?: string): Promise<WorkspaceOperation[]> {
    return this.db.storeScope(async () => {
      const rows =
        workspaceId === undefined
          ? await this.db.prepare("SELECT payload FROM workspace_operations ORDER BY id").all()
          : await this.db
              .prepare("SELECT payload FROM workspace_operations WHERE workspace_id=? ORDER BY id")
              .all(workspaceId);
      return rows.map((row) => JSON.parse(String(row.payload)));
    });
  }
  async findWorkspaceOperation(request: {
    workspaceId: string;
    kind: WorkspaceOperation["kind"];
    idempotencyKey: string;
  }): Promise<WorkspaceOperation | null> {
    return this.db.storeScope(async () => {
      const row = await this.db
        .prepare(
          "SELECT payload FROM workspace_operations WHERE workspace_id=? AND kind=? AND idempotency_key=?",
        )
        .get(request.workspaceId, request.kind, request.idempotencyKey);
      return row ? JSON.parse(String(row.payload)) : null;
    });
  }
  async saveWorkspaceOperation(
    operation: WorkspaceOperation,
    expectedPhase: WorkspaceOperation["phase"] | null,
  ): Promise<void> {
    return this.transaction(async () => {
      if (operation.phase === "blocked" && !operation.resumePhase)
        throw new Error("Blocked workspace operation must retain its recovery phase");
      if (expectedPhase === null) {
        await this.db
          .prepare(
            "INSERT INTO workspace_operations (id, workspace_id, kind, idempotency_key, phase, payload) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            operation.id,
            operation.workspaceId,
            operation.kind,
            operation.idempotencyKey,
            operation.phase,
            JSON.stringify(operation),
          );
        return;
      }
      const previous = await this.workspaceOperation(operation.id);
      if (!previous || previous.phase !== expectedPhase)
        throw Object.assign(new Error("Workspace operation phase changed"), {
          code: "WORKSPACE_OPERATION_CONFLICT",
        });
      for (const key of [
        "workspaceId",
        "kind",
        "idempotencyKey",
        "expectedRevision",
        "createdAt",
      ] as const)
        if (previous[key] !== operation[key])
          throw new Error(`Workspace operation identity is immutable: ${key}`);
      // The original creation snapshot or reviewed plan is authority, not
      // progress. Recovery may add rescue data and receipts, never retarget the
      // reserved directory, source baseline or approved Git/conversation state.
      const previousPlan = previous.kind === "create" ? previous.plannedWorkspace : previous.plan;
      const nextPlan = operation.kind === "create" ? operation.plannedWorkspace : operation.plan;
      if (canonicalWorkspaceJson(previousPlan) !== canonicalWorkspaceJson(nextPlan))
        throw new Error("Workspace operation plan is immutable");
      // Once recorded, recovery authority and acknowledgements cannot disappear
      // through a stale same-phase payload. Progress-only fields remain mutable.
      const oldFields = previous as unknown as Record<string, unknown>;
      const newFields = operation as unknown as Record<string, unknown>;
      for (const key of [
        "reservationId",
        "target",
        "requestFingerprint",
        "rescueUserBlockIds",
        "transcriptRescueId",
        "undoTranscriptRescueId",
        "conversationResult",
        "intendedTargetHead",
        "receipt",
      ])
        if (
          oldFields[key] !== undefined &&
          canonicalWorkspaceJson(oldFields[key]) !== canonicalWorkspaceJson(newFields[key])
        )
          throw new Error(`Workspace operation recovery identity is immutable: ${key}`);
      if (oldFields.finalized === true && newFields.finalized !== true)
        throw new Error("Workspace operation finalization cannot be reversed");
      const result = await this.db
        .prepare(
          "UPDATE workspace_operations SET phase=?, payload=? WHERE id=? AND phase=? AND payload=?",
        )
        .run(
          operation.phase,
          JSON.stringify(operation),
          operation.id,
          expectedPhase,
          JSON.stringify(previous),
        );
      if (!Number(result.changes))
        throw Object.assign(new Error("Workspace operation phase changed"), {
          code: "WORKSPACE_OPERATION_CONFLICT",
        });
    });
  }
  /** Receipts deliberately have no age-based pruning: retries after retirement
   * or restart must not repeat Git mutations. Scope is a host-selected namespace. */
  async workspaceReceipt<T>(scope: string, key: string, request: unknown): Promise<T | null> {
    return this.db.storeScope(async () => {
      const row = await this.db
        .prepare(
          "SELECT signature, response FROM workspace_mutation_receipts WHERE scope=? AND idempotency_key=?",
        )
        .get(scope, key);
      if (!row) return null;
      if (row.signature !== canonicalWorkspaceJson(request))
        throw Object.assign(
          new Error("Idempotency key was already used with a different request"),
          { code: "WORKSPACE_IDEMPOTENCY_CONFLICT" },
        );
      return JSON.parse(String(row.response)) as T;
    });
  }
  async saveWorkspaceReceipt(
    scope: string,
    key: string,
    request: unknown,
    response: unknown,
  ): Promise<void> {
    return this.db.storeScope(async () => {
      await this.db
        .prepare(
          "INSERT INTO workspace_mutation_receipts (scope, idempotency_key, signature, response) VALUES (?, ?, ?, ?)",
        )
        .run(scope, key, canonicalWorkspaceJson(request), JSON.stringify(response));
    });
  }
  async workspacePolicy(
    projectId: string,
    environmentId: string,
  ): Promise<{ revision: number; policy: WorkspacePolicyOverride } | null> {
    return this.db.storeScope(async () => {
      const row = await this.db
        .prepare(
          "SELECT revision, payload FROM workspace_policies WHERE project_id=? AND environment_id=?",
        )
        .get(projectId, environmentId);
      return row
        ? { revision: Number(row.revision), policy: JSON.parse(String(row.payload)) }
        : null;
    });
  }
  async saveWorkspacePolicy(
    projectId: string,
    environmentId: string,
    policy: WorkspacePolicyOverride,
    expectedRevision: number,
  ): Promise<{ revision: number; policy: WorkspacePolicyOverride }> {
    return this.transaction(async () => {
      const previous = await this.workspacePolicy(projectId, environmentId);
      if ((previous?.revision ?? 0) !== expectedRevision)
        throw Object.assign(new Error("Workspace policy revision changed"), {
          code: "WORKSPACE_POLICY_REVISION_CONFLICT",
        });
      const revision = expectedRevision + 1;
      if (previous)
        await this.db
          .prepare(
            "UPDATE workspace_policies SET revision=?, payload=? WHERE project_id=? AND environment_id=?",
          )
          .run(revision, JSON.stringify(policy), projectId, environmentId);
      else
        await this.db
          .prepare(
            "INSERT INTO workspace_policies (project_id, environment_id, revision, payload) VALUES (?, ?, ?, ?)",
          )
          .run(projectId, environmentId, revision, JSON.stringify(policy));
      return { revision, policy };
    });
  }
  async workspaceFeatureClaims(
    filter: {
      projectId?: string;
      repositoryId?: string;
      featureKey?: string;
      workspaceId?: string;
    } = {},
  ): Promise<WorkspaceFeatureClaim[]> {
    return this.db.storeScope(async () => {
      const clauses: string[] = [],
        values: string[] = [];
      for (const [column, value] of [
        ["project_id", filter.projectId],
        ["repository_id", filter.repositoryId],
        ["feature_key", filter.featureKey],
        ["workspace_id", filter.workspaceId],
      ])
        if (value !== undefined) {
          clauses.push(`${column}=?`);
          values.push(value);
        }
      const rows = await this.db
        .prepare(
          `SELECT payload FROM workspace_feature_claims${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY id`,
        )
        .all(...values);
      return rows.map((row) => JSON.parse(String(row.payload)));
    });
  }
  async insertWorkspaceFeatureClaim(claim: WorkspaceFeatureClaim): Promise<void> {
    return this.db.storeScope(async () => {
      await this.db
        .prepare(
          "INSERT INTO workspace_feature_claims (id, repository_id, project_id, feature_key, scope, workspace_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          claim.id,
          claim.repositoryId,
          claim.projectId,
          claim.featureKey,
          claim.scope ?? "",
          claim.workspaceId,
          JSON.stringify(claim),
        );
    });
  }
  async deleteWorkspaceFeatureClaim(claimId: string, workspaceId: string): Promise<boolean> {
    return this.db.storeScope(
      async () =>
        Number(
          (
            await this.db
              .prepare("DELETE FROM workspace_feature_claims WHERE id=? AND workspace_id=?")
              .run(claimId, workspaceId)
          ).changes,
        ) > 0,
    );
  }
  async project(id: string): Promise<HostProject> {
    return this.db.storeScope(async () => {
      const row = await this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!row) throw new Error("Project is not registered on this machine");
      return row as unknown as HostProject;
    });
  }
  async projects(): Promise<HostProject[]> {
    return this.db.storeScope(async () => {
      return (await this.db
        .prepare("SELECT * FROM projects ORDER BY name")
        .all()) as unknown as HostProject[];
    });
  }
  async addProject(cwd: string, name: string): Promise<HostProject> {
    return this.db.storeScope(async () => {
      // Use the same filesystem identity as desktop session discovery. Legacy
      // spellings remain registered so their sessions and feature data stay valid.
      const path = normalizeProjectPath(cwd);
      const existing = (await this.projects()).find(
        (project) => normalizeProjectPath(project.cwd) === path,
      );
      if (existing) return existing;
      await this.db
        .prepare("INSERT OR IGNORE INTO projects VALUES (?, ?, ?)")
        .run(randomUUID(), cwd, name);
      this.afterCommit(() => this.changes.notify());
      return (await this.db
        .prepare("SELECT * FROM projects WHERE cwd=?")
        .get(cwd)) as unknown as HostProject;
    });
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
  private async find(id: string): Promise<HostSession | undefined> {
    const unwritten = this.pending.get(id);
    if (unwritten) return unwritten.value;
    const cached = this.cache.get(id);
    if (cached) return this.remember(cached);
    const row = await this.db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(id);
    if (!row) return undefined;
    let value = JSON.parse(String(row.snapshot)) as HostSession;
    const journal = await this.db
      .prepare("SELECT * FROM session_journal WHERE session_id=?")
      .get(id);
    if (journal && Number(journal.revision) > value.revision) {
      const blocks = new Map(value.session.blocks.map((block) => [block.id, block]));
      const revisions = { ...value.blockRevisions };
      for (const changed of await this.db
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
  async session(id: string): Promise<HostSession> {
    return this.db.storeScope(async () => {
      const value = await this.find(id);
      if (!value) throw new Error("Session not found on this machine");
      return value;
    });
  }
  /** Authorization must not parse/load a transcript, even on a cold cache. */
  async sessionAuthority(id: string): Promise<{ projectId: string; provider: string } | undefined> {
    return this.db.storeScope(async () => {
      const pending = this.pending.get(id)?.value;
      if (pending) return { projectId: pending.projectId, provider: pending.session.harness };
      const row = await this.db
        .prepare("SELECT project_id,harness FROM session_state WHERE id=?")
        .get(id);
      return row && { projectId: String(row.project_id), provider: String(row.harness) };
    });
  }
  /** Lightweight existence/running check for queue RPCs; never loads blocks. */
  async sessionStatus(id: string): Promise<string> {
    return this.db.storeScope(async () => {
      const pending = this.pending.get(id);
      if (pending) return pending.value.status;
      const row = await this.db.prepare("SELECT status FROM session_state WHERE id=?").get(id);
      if (!row) throw new Error("Session not found on this machine");
      return String(row.status);
    });
  }
  async summaries(projectId: string): Promise<HostSessionSummary[]> {
    return this.db.storeScope(async () => {
      const external = await this.dataVersion();
      const entry = this.summaryRows.get(projectId);
      if (
        !this.inTransaction &&
        entry?.version === this.projectVersion(projectId) &&
        entry.external === external
      ) {
        entry.sorted ??= [...entry.rows.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        return entry.sorted.slice();
      }
      const list = (
        await Promise.all(
          (
            await this.db
              .prepare("SELECT id, summary FROM session_state WHERE project_id=?")
              .all(projectId)
          ).map(async (row) => {
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
            const fresh = summary(await this.session(String(row.id)));
            await this.db
              .prepare("UPDATE session_state SET summary=? WHERE id=?")
              .run(JSON.stringify(fresh), String(row.id));
            return fresh;
          }),
        )
      ).sort((a, b) => b.updatedAt - a.updatedAt);
      if (!this.inTransaction && list.length <= 100000) {
        this.summaryRows.delete(projectId);
        this.summaryRows.set(projectId, {
          version: this.projectVersion(projectId),
          external,
          rows: new Map(list.map((item) => [item.id, item])),
          sorted: list,
        });
        while (
          this.summaryRows.size > 16 ||
          [...this.summaryRows.values()].reduce((count, item) => count + item.rows.size, 0) > 100000
        )
          this.summaryRows.delete(this.summaryRows.keys().next().value!);
      }
      return list.slice();
    });
  }
  /** Whether any session of the project is running, without building
   * summaries. Unwritten state wins over the stored row. */
  async hasRunning(projectId: string): Promise<boolean> {
    return this.db.storeScope(async () => {
      for (const { value } of this.pending.values())
        if (value.projectId === projectId && value.status === "running") return true;
      for (const row of await this.db
        .prepare("SELECT id FROM session_state WHERE project_id=? AND status='running'")
        .all(projectId))
        if (!this.pending.has(String(row.id))) return true;
      return false;
    });
  }
  async sync(id: string, revision?: number): Promise<SessionSync> {
    return this.db.storeScope(async () => {
      const value = await this.session(id);
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
    });
  }
  /** Sessions taken over from this machine's desktop app, without parsing
   * their transcripts. */
  async adopted(projectId?: string): Promise<
    {
      id: string;
      projectId: string;
      revision: number;
      updatedAt: number;
      status: HostSession["status"];
      /** The desktop copy's `updated_at` the host has caught up with. */
      desktopUpdatedAt: number;
    }[]
  > {
    return this.db.storeScope(async () => {
      const rows = new Map(
        (
          await this.db
            .prepare(`SELECT id, project_id, revision, updated_at, status, desktop_updated_at
        FROM session_state WHERE has_desktop=1${projectId === undefined ? "" : " AND project_id=?"}`)
            .all(...(projectId === undefined ? [] : [projectId]))
        ).map((row) => [
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
        if (projectId !== undefined && value.projectId !== projectId) {
          rows.delete(id);
          continue;
        }
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
    });
  }
  /** Everything startup needs per session, without parsing transcripts. */
  async startupStates(): Promise<
    {
      id: string;
      hasDesktop: boolean;
      running: boolean;
      shellRunning: boolean;
      workspaceId?: string;
      providerSessionId: string | null;
      harness: string | null;
      cwd: string | null;
    }[]
  > {
    return this.db.storeScope(async () => {
      return (
        await this.db
          .prepare(`SELECT id, has_desktop, status, shell_running, provider_session_id, harness, session_cwd,
          json_extract(summary, '$.workspaceId') AS workspace_id
        FROM session_state ORDER BY updated_at DESC`)
          .all()
      ).map((row) => {
        const unwritten = this.pending.get(String(row.id))?.value;
        if (unwritten)
          return {
            id: unwritten.session.id,
            hasDesktop: unwritten.desktop != null,
            running: unwritten.status === "running",
            shellRunning: unwritten.session.blocks.some((block) => block.shell?.running),
            workspaceId: unwritten.session.workspaceId,
            providerSessionId: unwritten.session.providerSessionId || null,
            harness: unwritten.session.harness ?? null,
            cwd: unwritten.session.cwd ?? null,
          };
        return {
          id: String(row.id),
          hasDesktop: !!Number(row.has_desktop),
          running: row.status === "running",
          shellRunning: !!Number(row.shell_running),
          workspaceId: row.workspace_id == null ? undefined : String(row.workspace_id),
          providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
          harness: row.harness == null ? null : String(row.harness),
          cwd: row.session_cwd == null ? null : String(row.session_cwd),
        };
      });
    });
  }
  async sessions(projectId?: string): Promise<HostSession[]> {
    return this.db.storeScope(async () => {
      const rows = projectId
        ? await this.db.prepare("SELECT id FROM session_state WHERE project_id=?").all(projectId)
        : await this.db.prepare("SELECT id FROM session_state").all();
      return (await Promise.all(rows.map(async (row) => await this.session(String(row.id))))).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
    });
  }
  /** Usage reads expose only timing/token metadata. SQLite projects persisted JSON;
   * no transcript text or full snapshot is parsed into JS on this read path. */
  async usageMetadataPage(
    projectId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<UsageMetadataPage> {
    return this.db.storeScope(async () => {
      await this.project(projectId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid usage page limit");
      const candidates = await this.db
        .prepare(
          "SELECT st.id,CASE WHEN j.revision>s.revision THEN json_extract(j.metadata,'$.session.harness') ELSE st.harness END AS harness FROM session_state st JOIN sessions s ON s.id=st.id LEFT JOIN session_journal j ON j.session_id=st.id WHERE st.project_id=? AND st.id>? ORDER BY st.id LIMIT ?",
        )
        .all(projectId, cursor ?? "", limit + 1);
      const selected = candidates.slice(0, limit);
      const sessions: UsageMetadataPage["sessions"] = [];
      let budget = 32 * 1024 * 1024;
      let skippedSessions = 0;
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
            turns.push({
              startedAt: block.startedAt,
              durationMs: block.durationMs,
              draft: block.draft,
              continuationOf: block.continuationOf,
              inputTokens: block.turnMetrics?.inputTokens,
              outputTokens: block.turnMetrics?.outputTokens,
              cacheReadTokens: block.turnMetrics?.cacheReadTokens,
              cacheWriteTokens: block.turnMetrics?.cacheWriteTokens,
            });
          }
          sessions.push({
            sessionId,
            provider: pending.session.harness,
            turns: turns.slice(0, cap),
            turnsTruncated: visited > 10000 || turns.length > cap,
          });
          continue;
        }
        const size = await this.db
          .prepare(
            "SELECT length(CAST(snapshot AS BLOB)) + COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM session_journal_blocks WHERE session_id=?),0) + COALESCE((SELECT length(CAST(metadata AS BLOB))+length(CAST(block_ids AS BLOB)) FROM session_journal WHERE session_id=?),0) AS bytes FROM sessions WHERE id=?",
          )
          .get(sessionId, sessionId, sessionId);
        const bytes = Number(size?.bytes ?? 0);
        if (bytes > 4 * 1024 * 1024 || bytes > budget) {
          skippedSessions++;
          continue;
        }
        budget -= bytes;
        const turns = (await this.db
          .prepare(`WITH base AS MATERIALIZED (
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
        FROM effective WHERE json_extract(payload,'$.role')='user' LIMIT ?`)
          .all(sessionId, sessionId, cap + 1)) as unknown as UsageTurnMetadata[];
        sessions.push({
          sessionId,
          provider: String(candidate.harness ?? "unknown"),
          turns: turns.slice(0, cap),
          turnsTruncated: turns.length > cap,
        });
      }
      return {
        sessions,
        scannedSessions: selected.length,
        skippedSessions,
        nextCursor: candidates.length > limit ? String(selected.at(-1)!.id) : null,
      };
    });
  }
  /** Reads the indexed revision column without parsing the transcript snapshot. */
  async sessionRevision(id: string): Promise<number | undefined> {
    return this.db.storeScope(async () => {
      const pending = this.pending.get(id);
      if (pending) return pending.value.revision;
      const cached = this.cache.get(id);
      if (cached) return cached.revision;
      return (await this.sessionStateMetadata(id))?.revision;
    });
  }
  async sessionStateMetadata(id: string): Promise<
    | {
        revision: number;
        status: HostSession["status"];
        desktop: boolean;
      }
    | undefined
  > {
    return this.db.storeScope(async () => {
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
      const row = await this.db
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
    });
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
  async save(
    input: HostSession,
    event: unknown,
    options: {
      deferred?: boolean;
      journal?: boolean;
      blockChanges?: BlockChanges;
    } = {},
  ): Promise<HostSession> {
    return this.db.storeScope(() =>
      this.transaction(async () => {
        this.bumpChangeVersion();
        this.touchProject(input.projectId);
        const previous = await this.find(input.session.id);
        if (previous && previous.projectId !== input.projectId)
          this.touchProject(previous.projectId);
        const value = {
          ...input,
          // Older snapshots have no creation time. Preserve their last recorded
          // timestamp when they are first written by this version of the host.
          createdAt:
            input.createdAt ?? previous?.createdAt ?? previous?.updatedAt ?? input.updatedAt,
          blockRevisions: blockRevisions(previous, input, options.blockChanges),
        };
        const id = value.session.id;
        const row = { revision: value.revision, event };
        if (
          (options.deferred || options.journal) &&
          previous &&
          previous.projectId === input.projectId
        ) {
          let changes =
            options.blockChanges ?? changedBlocks(previous.session.blocks, value.session.blocks);
          if (!changes) {
            const position = streamingTextUpdate(previous.session.blocks, value.session.blocks);
            if (position !== undefined)
              changes = new Map([
                [value.session.blocks[position].id, value.session.blocks[position]],
              ]);
          }
          const structural = patchBlockIndex(
            previous.session.blocks,
            value.session.blocks,
            changes,
          );
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
          this.updateStateMetadata(value);
          if (options.journal) await this.flushPending(id);
          else this.arm(id, entry);
          await this.savedSummary(value);
          return value;
        }
        // Pending soft state goes out in the same write, so the stored snapshot
        // never goes backwards and event rows stay in revision order.
        const entry = this.take(id);
        try {
          await this.write(value, [...(entry?.events ?? []), row]);
        } catch (error) {
          if (entry) this.restore(entry);
          throw error;
        }
        const remembered = this.remember(value);
        this.updateStateMetadata(value);
        await this.savedSummary(value);
        return remembered;
      }),
    );
  }
  /** Writes every session whose latest state is still only in memory. */
  async flushAll(): Promise<void> {
    return this.db.storeScope(async () => {
      for (const id of [...this.pending.keys()]) await this.flushPending(id);
      for (const row of await this.db.prepare("SELECT session_id FROM session_journal").all())
        await this.write(await this.session(String(row.session_id)), []);
    });
  }
  private async flushPending(id: string): Promise<void> {
    const entry = this.take(id);
    if (!entry) return;
    try {
      await this.writeJournal(entry.value, entry.events, entry);
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
    if (entry.timer || this.closePromise || this.db.restartRequired) return;
    entry.timer = this.db.outsideScope(() =>
      setTimeout(async () => {
        entry.timer = undefined;
        try {
          await this.db.storeScope(() => this.flushPending(id));
        } catch (error) {
          // Stays pending and is retried; a timer must never take the host down.
          console.error(
            "Session checkpoint failed:",
            error instanceof Error ? error.message : "unknown error",
          );
        }
      }, CHECKPOINT_MS),
    );
    entry.timer.unref?.();
  }
  private async write(
    value: HostSession,
    rows: {
      revision: number;
      event: unknown;
    }[],
  ): Promise<void> {
    // Both tables store the same summary: build and serialize it once per save.
    const summaryJson = JSON.stringify(summary(value));
    const run = async () => {
      await this.db
        .prepare(`INSERT INTO sessions (id, project_id, snapshot, summary, has_desktop, revision, updated_at, status, provider_session_id, harness, session_cwd, shell_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, snapshot=excluded.snapshot, summary=excluded.summary, has_desktop=excluded.has_desktop, revision=excluded.revision, updated_at=excluded.updated_at, status=excluded.status, provider_session_id=excluded.provider_session_id, harness=excluded.harness, session_cwd=excluded.session_cwd, shell_running=excluded.shell_running`)
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
      await this.db
        .prepare(`INSERT INTO session_state (id, project_id, summary, revision, updated_at, status, has_desktop, desktop_updated_at, provider_session_id, harness, session_cwd, shell_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, summary=excluded.summary, revision=excluded.revision, updated_at=excluded.updated_at, status=excluded.status, has_desktop=excluded.has_desktop, desktop_updated_at=excluded.desktop_updated_at, provider_session_id=excluded.provider_session_id, harness=excluded.harness, session_cwd=excluded.session_cwd, shell_running=excluded.shell_running`)
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
      for (const row of rows)
        await insert.run(value.session.id, row.revision, JSON.stringify(row.event));
      await this.db
        .prepare("DELETE FROM events WHERE session_id=? AND revision<?")
        .run(value.session.id, value.revision - 2000);
      await this.db.prepare("DELETE FROM session_journal WHERE session_id=?").run(value.session.id);
      await this.db
        .prepare("DELETE FROM session_journal_blocks WHERE session_id=?")
        .run(value.session.id);
    };
    if (this.inTransaction) await run();
    else await this.transaction(run);
    this.snapshotWrites++;
  }
  /** Streaming and immediately durable provider-event checkpoints serialize
   * changed blocks only. Commands/receipts and settled turns still commit full
   * compatible snapshots; journal publication remains in the same transaction. */
  private async writeJournal(
    value: HostSession,
    rows: {
      revision: number;
      event: unknown;
    }[],
    changes?: PendingWrite,
  ): Promise<void> {
    const id = value.session.id;
    const journal = await this.db
      .prepare("SELECT revision FROM session_journal WHERE session_id=?")
      .get(id);
    const incremental = changes && !changes.structural;
    const previous =
      journal ?? (await this.db.prepare("SELECT revision FROM session_state WHERE id=?").get(id));
    const revision = Number(previous?.revision ?? -1);
    const {
      blockRevisions: _revisions,
      session: { blocks, ...session },
      ...rest
    } = value;
    const run = async () => {
      const writeBlock = this.db.prepare(
        "INSERT INTO session_journal_blocks VALUES (?, ?, ?, ?) ON CONFLICT(session_id,block_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
      );
      for (const block of incremental ? changes.changed.values() : blocks) {
        const stamp = value.blockRevisions?.[block.id] ?? value.revision;
        if (stamp > revision) await writeBlock.run(id, block.id, stamp, JSON.stringify(block));
      }
      if (incremental && journal)
        await this.db
          .prepare("UPDATE session_journal SET revision=?,metadata=? WHERE session_id=?")
          .run(value.revision, JSON.stringify({ ...rest, session }), id);
      else
        await this.db
          .prepare(
            "INSERT INTO session_journal VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata,block_ids=excluded.block_ids",
          )
          .run(
            id,
            value.revision,
            JSON.stringify({ ...rest, session }),
            JSON.stringify(blocks.map((block) => block.id)),
          );
      await this.db
        .prepare(
          "UPDATE session_state SET summary=?, revision=?, updated_at=?, status=?, has_desktop=?, desktop_updated_at=?, provider_session_id=?, harness=?, session_cwd=?, shell_running=? WHERE id=?",
        )
        .run(
          JSON.stringify(summary(value)),
          value.revision,
          value.updatedAt,
          value.status,
          value.desktop == null ? 0 : 1,
          value.desktop?.updatedAt ?? null,
          value.session.providerSessionId || null,
          value.session.harness ?? null,
          value.session.cwd ?? null,
          value.session.blocks.some((block) => block.shell?.running) ? 1 : 0,
          id,
        );
      const insert = this.db.prepare("INSERT INTO events VALUES (?, ?, ?)");
      for (const row of rows) await insert.run(id, row.revision, JSON.stringify(row.event));
      await this.db
        .prepare("DELETE FROM events WHERE session_id=? AND revision<?")
        .run(id, value.revision - 2000);
    };
    if (this.inTransaction) await run();
    else await this.transaction(run);
  }
  async updateSession(
    id: string,
    patch: {
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      linkedWorkItem?: LinkedWorkItem | null;
    },
  ): Promise<HostSessionSummary> {
    return this.db.storeScope(async () => {
      return await this.transaction(async () => {
        const current = await this.session(id);
        if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 200))
          throw new Error("Invalid session title");
        const next = await this.save(
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
    });
  }
  async deleteSession(id: string): Promise<void> {
    return this.db.storeScope(async () => {
      await this.transaction(async () => {
        const current = await this.session(id);
        if (current.status === "running") throw new Error("Stop this session before deleting it");
        this.take(id);
        await this.db.prepare("DELETE FROM events WHERE session_id=?").run(id);
        await this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
        this.cache.delete(id);
        this.commitEffects.push(() => {
          this.stateMetadata.delete(id);
        });
        this.bumpChangeVersion();
        this.touchProject(current.projectId);
      });
    });
  }
  async receipt(id: string, signature: string): Promise<CommandReceipt | undefined> {
    return this.db.storeScope(async () => {
      const row = await this.db.prepare("SELECT * FROM receipts WHERE id=?").get(id);
      if (!row) return undefined;
      if (row.signature !== signature)
        throw new Error("Command ID was already used with a different payload");
      return JSON.parse(String(row.receipt)) as CommandReceipt;
    });
  }
  async receiptStatus(id: string): Promise<CommandReceipt | undefined> {
    return this.db.storeScope(async () => {
      const row = await this.db.prepare("SELECT receipt FROM receipts WHERE id=?").get(id);
      return row ? (JSON.parse(String(row.receipt)) as CommandReceipt) : undefined;
    });
  }
  async recordReceipt(signature: string, receipt: CommandReceipt): Promise<void> {
    return this.db.storeScope(async () => {
      await this.db
        .prepare("INSERT INTO receipts (id, signature, receipt, created_at) VALUES (?, ?, ?, ?)")
        .run(receipt.commandId, signature, JSON.stringify(receipt), Date.now());
      if (++this.receiptWrites % RECEIPT_PRUNE_EVERY === 0) await this.pruneReceipts();
    });
  }
  /** Clients retry a command for seconds to minutes, never days. */
  async pruneReceipts(now = Date.now()): Promise<void> {
    return this.db.storeScope(async () => {
      await this.db
        .prepare("DELETE FROM receipts WHERE created_at IS NULL OR created_at < ?")
        .run(now - RECEIPT_RETENTION_MS);
    });
  }
  async events(
    id: string,
    after: number,
  ): Promise<{
    snapshot?: HostSession;
    events?: unknown[];
    revision: number;
  }> {
    return this.db.storeScope(async () => {
      const snapshot = await this.session(id);
      const rows: {
        revision: number;
        event: unknown;
      }[] = (
        await this.db
          .prepare(
            "SELECT revision, payload FROM events WHERE session_id=? AND revision>? ORDER BY revision",
          )
          .all(id, after)
      ).map((row) => ({
        revision: Number(row.revision),
        event: JSON.parse(String(row.payload)),
      }));
      // Event rows of unwritten soft saves are newer than every stored row.
      for (const row of this.pending.get(id)?.events ?? [])
        if (row.revision > after) rows.push(row);
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
    });
  }
  async issueDevice(name: string): Promise<{
    id: string;
    token: string;
  }> {
    return this.db.storeScope(async () => {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      await this.db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run(id, name, this.hash(token));
      return { id, token };
    });
  }
  async revokeDevice(id: string): Promise<boolean> {
    return this.db.storeScope(async () => {
      this.authCache.clear();
      return Number((await this.db.prepare("DELETE FROM devices WHERE id=?").run(id)).changes) > 0;
    });
  }
  /** Owner-facing metadata only: device token hashes must never leave the store. */
  async pairedDevices(currentToken: string): Promise<{
    devices: {
      id: string;
      name: string;
      isCurrent: boolean;
    }[];
    devicesTruncated: boolean;
  }> {
    return this.db.storeScope(async () => {
      const hash = this.hash(currentToken);
      if (!(await this.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash)))
        throw new Error("Device authorization was revoked");
      const rows = await this.db
        .prepare(
          "SELECT id, name, hash=? AS is_current FROM devices ORDER BY is_current DESC, id LIMIT 257",
        )
        .all(hash);
      return {
        devices: rows.slice(0, 256).map((row) => ({
          id: String(row.id),
          name:
            String(row.name)
              .replace(/[\u0000-\u001f\u007f]/g, " ")
              .trim()
              .slice(0, 160) || String(row.id),
          isCurrent: Number(row.is_current) === 1,
        })),
        devicesTruncated: rows.length > 256,
      };
    });
  }
  /** The current device has a separate explicit revoke-self flow. */
  async revokeOtherDevice(id: string, currentToken: string): Promise<boolean> {
    return this.db.storeScope(async () => {
      const hash = this.hash(currentToken);
      const caller = await this.db.prepare("SELECT id FROM devices WHERE hash=?").get(hash);
      if (!caller) throw new Error("Device authorization was revoked");
      if (caller.id === id) throw new Error("Use the revoke-self action for this device");
      this.authCache.clear();
      return (
        Number(
          (
            await this.db
              .prepare(
                "DELETE FROM devices WHERE id=? AND hash<>? AND EXISTS (SELECT 1 FROM devices WHERE hash=?)",
              )
              .run(id, hash, hash)
          ).changes,
        ) > 0
      );
    });
  }
  /** Lets a desktop revoke only the credential it is using. */
  async revokeToken(token: string): Promise<boolean> {
    return this.db.storeScope(async () => {
      this.authCache.clear();
      return (
        Number(
          (await this.db.prepare("DELETE FROM devices WHERE hash=?").run(this.hash(token))).changes,
        ) > 0
      );
    });
  }
  /** Long polls re-check the credential on every tick, so a positive answer
   * is remembered. It is dropped at once by a revocation through this store,
   * and by any commit from another connection (the CLI revoking from its own
   * process) via SQLite's data_version, which this host's own writes never
   * move. */
  async authenticated(token: string): Promise<boolean> {
    return this.db.storeScope(async () => {
      const version = await this.dataVersion();
      if (this.authCache.get(token) === version) return true;
      this.authCache.delete(token);
      const known = !!(await this.db
        .prepare("SELECT id FROM devices WHERE hash=?")
        .get(this.hash(token)));
      if (known) {
        this.authCache.set(token, version);
        while (this.authCache.size > 256)
          this.authCache.delete(this.authCache.keys().next().value!);
      }
      return known;
    });
  }
  private dataVersionStatement?: StoreStatement;
  private async dataVersion(): Promise<number> {
    this.dataVersionStatement ??= this.db.prepare("PRAGMA data_version");
    return Number((await this.dataVersionStatement.get())?.data_version);
  }
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const closing = this.db.close(() => this.flushAll());
    if (this.db.ownsScope) return closing;
    this.closePromise = closing.finally(() => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
    });
    return this.closePromise;
  }
}
/** Canonical JSON preserves semantic key ordering across RPC implementations. */
function canonicalWorkspaceJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
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
    workspaceId: value.session.workspaceId,
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
