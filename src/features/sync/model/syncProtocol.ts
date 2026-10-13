/**
 * Wire types for library sync between this desktop and a paired machine's
 * host. Shared by `host/sync.ts` (the authoritative store) and every
 * `src/features/sync/model/*` client module. A table's `value` shape is
 * opaque here on purpose: each table's own module (syncProjects,
 * syncGroups, syncLock) validates its own fields before trusting them.
 */
export const SYNC_TABLES = [
  "project",
  "projectPath",
  "group",
  "assignment",
  "railLayout",
  "groupOrder",
  "lock",
  "appearance",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export type SyncProjectValue = { id: string; createdAt: number };
/** Stored under its `projectId`: one record per folder, whoever pushes it. */
export type SyncProjectPathValue = {
  projectId: string;
  path: string;
  /** Whether the machine that holds the folder has it archived. */
  archived: boolean;
  /** The host running on the folder's machine, through which it can be opened remotely. */
  hostEnvironmentId?: string;
  /** Only for a desktop without a host of its own. */
  machineId?: string;
};
export type SyncGroupValue = {
  id: string;
  name: string;
  /** Per-machine UI state; never sent, only tolerated from older clients. */
  collapsed?: boolean;
  colorIndex?: number;
  customColor?: string;
  mascot?: string;
  workspaceFile?: string;
  workspaceFolders?: string[];
  lockable?: boolean;
};
export type SyncAssignmentValue = { projectId: string; groupId: string };
export type SyncRailLayoutValue = { order: string[]; pinned: string[] };
export type SyncGroupOrderValue = { order: string[] };
export type SyncLockValue = { record: unknown | null };
/** A project's rail look. The logo is a local image file and stays per-machine. */
export type SyncAppearanceValue = {
  projectId: string;
  label?: string;
  colorIndex?: number;
  customColor?: string;
  mascot?: string;
};

export type SyncRecordValue =
  | SyncProjectValue
  | SyncProjectPathValue
  | SyncGroupValue
  | SyncAssignmentValue
  | SyncRailLayoutValue
  | SyncGroupOrderValue
  | SyncLockValue
  | SyncAppearanceValue;

/** One row in the host's sync store. `value === null` is a tombstone: the
 * record existed at an earlier revision and was deleted. */
export type SyncRecord = {
  table: SyncTable;
  id: string;
  rev: number;
  value: SyncRecordValue | null;
};

/** A pending local change, sent to `sync.push`. `baseRev` is the revision
 * this device last saw for this exact record (0 for one it has never seen),
 * so the host can tell a stale edit from a fresh one. */
export type SyncOp = {
  table: SyncTable;
  id: string;
  baseRev: number;
  value: SyncRecordValue | null;
};

export const SYNC_PUSH_BATCH_BYTES = 1024 * 1024;

/** Batches leave room for the RPC envelope under the host's 4 MiB limit. */
export function syncPushBatches(ops: readonly SyncOp[]): {
  batches: SyncOp[][];
  invalid: SyncOp[];
} {
  const batches: SyncOp[][] = [];
  const invalid: SyncOp[] = [];
  let batch: SyncOp[] = [];
  let bytes = 256;
  const encoder = new TextEncoder();
  for (const op of ops) {
    const size = encoder.encode(JSON.stringify(op)).byteLength + 1;
    if (size + 256 > SYNC_PUSH_BATCH_BYTES) {
      invalid.push(op);
      continue;
    }
    if (batch.length && (bytes + size > SYNC_PUSH_BATCH_BYTES || batch.length >= 100)) {
      batches.push(batch);
      batch = [];
      bytes = 256;
    }
    batch.push(op);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return { batches, invalid };
}

export type SyncPullResult = {
  rev: number;
  records: SyncRecord[];
  more?: boolean;
  /** Fixed end of a paginated pass. Writes beyond this are read next cycle. */
  untilRev?: number;
};
export type SyncPushResult = {
  rev: number;
  applied: { table: SyncTable; id: string; rev: number }[];
  rejected: { table: SyncTable; id: string; current: SyncRecord }[];
  invalid?: { table: string; id: string; error: string }[];
};

function isSyncTable(value: unknown): value is SyncTable {
  return typeof value === "string" && (SYNC_TABLES as readonly string[]).includes(value);
}

/** A record read back from the host, or `null` when it is malformed. The
 * value's own shape is not re-validated here; each table's module does
 * that against the fields it actually reads. */
export function parseSyncRecord(value: unknown): SyncRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SyncRecord>;
  if (!isSyncTable(raw.table)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (!Number.isInteger(raw.rev)) return null;
  if (raw.value !== null && (typeof raw.value !== "object" || Array.isArray(raw.value)))
    return null;
  return {
    table: raw.table,
    id: raw.id,
    rev: raw.rev as number,
    value: raw.value ?? null,
  };
}
