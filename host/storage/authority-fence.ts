import { randomUUID } from "node:crypto";
import type { StoreDatabase } from "../store-db";

export class HostAuthorityFenceError extends Error {
  readonly code = "HOST_AUTHORITY_FENCED";
  constructor() {
    super("Host write authority requires the committed current generation.");
    this.name = "HostAuthorityFenceError";
  }
}
function generation(value?: number): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    throw new HostAuthorityFenceError();
}
/** Same main DB, no connection UDF dependency: historic writers fail only for fenced IDs. */
export async function initializeHostAuthorityFence(db: StoreDatabase): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS host_authority_heads (
    environment_id TEXT NOT NULL, session_id TEXT NOT NULL, generation INTEGER NOT NULL,
    migration_id TEXT NOT NULL, phase TEXT NOT NULL, PRIMARY KEY(environment_id,session_id));
    CREATE TABLE IF NOT EXISTS host_authority_write_permits (
    session_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, nonce TEXT NOT NULL);`);
  // A well-formed writer never commits these rows. A prior defective writer does not
  // grant a restart or another connection continuing authority.
  await db.exec("DELETE FROM host_authority_write_permits");
  for (const [table, key] of [
    ["sessions", "id"],
    ["session_state", "id"],
    ["session_journal", "session_id"],
    ["session_journal_blocks", "session_id"],
    ["events", "session_id"],
  ] as const) {
    const blocked = (
      row: "OLD" | "NEW",
    ) => `EXISTS(SELECT 1 FROM host_authority_heads h WHERE h.session_id=${row}.${key} AND
      (h.phase<>'host-active' OR NOT EXISTS(SELECT 1 FROM host_authority_write_permits p WHERE p.session_id=h.session_id AND p.generation=h.generation)))`;
    for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
      const condition =
        event === "INSERT"
          ? blocked("NEW")
          : event === "DELETE"
            ? blocked("OLD")
            : `(${blocked("OLD")}) OR (${blocked("NEW")})`;
      await db.exec(`CREATE TRIGGER IF NOT EXISTS host_authority_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table}
        WHEN ${condition} BEGIN SELECT RAISE(ABORT,'Host authoritative session write is fenced'); END`);
    }
  }
}

export async function assertHostAuthority(
  db: StoreDatabase,
  sessionId: string,
  expectedGeneration?: number,
): Promise<boolean> {
  generation(expectedGeneration);
  const heads = await db
    .prepare("SELECT generation,phase FROM host_authority_heads WHERE session_id=?")
    .all(sessionId);
  if (!heads.length) {
    if (expectedGeneration !== undefined) throw new HostAuthorityFenceError();
    return false;
  }
  if (
    heads.length !== 1 ||
    heads[0].phase !== "host-active" ||
    expectedGeneration === undefined ||
    Number(heads[0].generation) !== expectedGeneration
  )
    throw new HostAuthorityFenceError();
  return true;
}

/** Must run inside the caller's SQL transaction; finally deletes the permit before COMMIT. */
export async function withHostAuthorityPermit<T>(
  db: StoreDatabase,
  sessionId: string,
  expectedGeneration: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const fenced = await assertHostAuthority(db, sessionId, expectedGeneration);
  if (!fenced) return work();
  const existing = await db
    .prepare("SELECT generation FROM host_authority_write_permits WHERE session_id=?")
    .get(sessionId);
  if (existing) {
    if (Number(existing.generation) !== expectedGeneration) throw new HostAuthorityFenceError();
    return work();
  }
  const nonce = randomUUID();
  await db
    .prepare("INSERT INTO host_authority_write_permits VALUES(?,?,?)")
    .run(sessionId, expectedGeneration!, nonce);
  try {
    return await work();
  } finally {
    await db
      .prepare("DELETE FROM host_authority_write_permits WHERE session_id=? AND nonce=?")
      .run(sessionId, nonce);
  }
}
