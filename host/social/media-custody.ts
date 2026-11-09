import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { HostStore } from "../store";
import { sanitizeSocialError } from "./core/social-helpers";

/** Scope is constructed by the authenticated Social service, never from RPC input. */
export type MediaCustodyScope = Readonly<{ accountId: string }>;
export type MediaClaim = Readonly<{ ownerKind: string; ownerId: string; claimId: string }>;

/** Bump when the trigger definitions change; a matching marker skips the trigger DDL at start. */
const MEDIA_TRIGGER_VERSION = "2";
const MEDIA_TABLES = [
  ["social_records", "'record:' || NEW.kind"],
  ["social_jobs", "'job'"],
  ["social_jobs_cold", "'job-cold'"],
  ["social_programs", "'program'"],
  ["social_occurrences", "'occurrence'"],
] as const;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Rows per reconciliation batch; each batch is one short transaction. */
const RECONCILE_BATCH = 200;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class SocialMediaCustody {
  private reconciliation?: Promise<void>;

  /** `pause` runs between reconciliation batches; tests inject a controllable one. */
  constructor(
    private readonly store: HostStore,
    private readonly directory: string,
    private readonly pause: () => Promise<void> = yieldToEventLoop,
  ) {}

  /**
   * Startup only runs the versioned trigger DDL. The durable reference rebuild runs in the
   * background (see `reconciled`), so a large media history never blocks the Host.
   */
  async initialize(): Promise<void> {
    await this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS social_media_files (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, path TEXT NOT NULL, root TEXT NOT NULL,
        volume TEXT, file_id TEXT, sha256 TEXT NOT NULL, state TEXT NOT NULL,
        revision INTEGER NOT NULL, quarantine_path TEXT
      );
      CREATE TABLE IF NOT EXISTS social_media_claims (
        media_id TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
        claim_id TEXT NOT NULL, state TEXT NOT NULL,
        PRIMARY KEY(media_id, owner_kind, owner_id, claim_id)
      );
      CREATE INDEX IF NOT EXISTS social_media_claims_live ON social_media_claims(media_id,state);
      CREATE TABLE IF NOT EXISTS social_media_operations (scope TEXT NOT NULL,request_id TEXT NOT NULL,signature TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(scope,request_id));
    `);
    await this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS social_media_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    // Trigger definitions are versioned: once the marker matches, a Host start skips the
    // trigger DDL. Triggers exist before reconciliation starts, so any write made while the
    // rebuild runs is claimed by the trigger itself.
    const marker = await this.store.db
      .prepare("SELECT value FROM social_media_meta WHERE key='triggers'")
      .get();
    const triggersCurrent = Boolean(marker && String(marker.value) === MEDIA_TRIGGER_VERSION);
    if (!triggersCurrent)
      await this.store.transaction(async () => {
        await this.installTriggers();
      });
    // Not awaited: startup continues. Every destructive media step awaits `reconciled()`.
    // Started outside the caller's store scope: initialization runs inside a scope that
    // closes when it returns, and the rebuild keeps reading after that.
    this.reconciliation = this.store.db.outsideScope(() => this.reconcileReferences());
    this.reconciliation.catch((error) =>
      console.error("Social media reference reconciliation failed:", sanitizeSocialError(error)),
    );
  }

  /** Resolves when the durable reference rebuild for the current start has completed. */
  reconciled(): Promise<void> {
    return this.reconciliation ?? Promise.reject(new Error("Media custody is not initialized."));
  }

  /** Rebuilds missing durable claims, table by table, in rowid batches. Idempotent. */
  private async reconcileReferences(): Promise<void> {
    for (const [table, kind] of MEDIA_TABLES) {
      const existingKind = kind.replaceAll("NEW.", "r.");
      let after = 0;
      for (;;) {
        const rows = (await this.store.db
          .prepare(`SELECT rowid AS position FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`)
          .all(after, RECONCILE_BATCH)) as Array<{ position: number }>;
        if (!rows.length) break;
        const upper = Number(rows[rows.length - 1]!.position);
        await this.store.transaction(async () => {
          await this.store.db
            .prepare(`INSERT OR IGNORE INTO social_media_claims(media_id,owner_kind,owner_id,claim_id,state)
        SELECT DISTINCT f.id,${existingKind},r.id,'durable','active'
        FROM ${table} r, json_tree(r.value) j JOIN social_media_files f ON f.id=j.value
        WHERE r.rowid>? AND r.rowid<=? AND instr(r.value,'uploadId')>0 AND j.key='uploadId'`)
            .run(after, upper);
        });
        after = upper;
        await this.pause();
      }
    }
  }

  private async installTriggers(): Promise<void> {
    // Database triggers cover every writer, including program generation and recovery.
    for (const [table] of MEDIA_TABLES)
      for (const suffix of [
        "media_insert",
        "media_update",
        "media_after_insert",
        "media_after_update",
        "media_after_delete",
      ])
        await this.store.db.exec(`DROP TRIGGER IF EXISTS ${table}_${suffix};`);
    for (const [table, kind] of MEDIA_TABLES) {
      const oldKind = kind.replaceAll("NEW.", "OLD.");
      // Archival moves an already accepted row to the cold table: it is never refused by media state.
      if (table !== "social_jobs_cold") {
        await this.store.db.exec(`CREATE TRIGGER ${table}_media_insert BEFORE INSERT ON ${table}
            WHEN instr(NEW.value,'uploadId')>0 BEGIN
              SELECT CASE WHEN EXISTS (
                SELECT 1 FROM json_tree(NEW.value) j JOIN social_media_files f ON f.id=j.value
                WHERE j.key='uploadId' AND f.state!='active'
              ) THEN RAISE(ABORT, 'Referenced managed media is not active') END;
            END;`);
        // Only a newly added reference is refused; unrelated updates of a settled job still succeed.
        await this.store.db.exec(`CREATE TRIGGER ${table}_media_update BEFORE UPDATE ON ${table}
            WHEN instr(NEW.value,'uploadId')>0 BEGIN
              SELECT CASE WHEN EXISTS (
                SELECT 1 FROM json_tree(NEW.value) j JOIN social_media_files f ON f.id=j.value
                WHERE j.key='uploadId' AND f.state!='active'
                  AND NOT EXISTS (SELECT 1 FROM json_tree(OLD.value) o WHERE o.key='uploadId' AND o.value=j.value)
              ) THEN RAISE(ABORT, 'Referenced managed media is not active') END;
            END;`);
      }
      const claimRows = `INSERT OR REPLACE INTO social_media_claims(media_id,owner_kind,owner_id,claim_id,state)
              SELECT DISTINCT f.id,${kind},NEW.id,'durable','active'
              FROM json_tree(NEW.value) j JOIN social_media_files f ON f.id=j.value
              WHERE j.key='uploadId' AND f.state='active';`;
      // The revision moves only when a reference is added or removed (a claim-set change).
      // Archival writes the cold row before deleting the hot one: that move changes no claim.
      const insertBump =
        table === "social_jobs_cold"
          ? " AND NOT EXISTS (SELECT 1 FROM social_jobs WHERE id=NEW.id)"
          : "";
      const deleteBump =
        table === "social_jobs"
          ? " AND NOT EXISTS (SELECT 1 FROM social_jobs_cold WHERE id=OLD.id)"
          : "";
      await this.store.db.exec(`CREATE TRIGGER ${table}_media_after_insert AFTER INSERT ON ${table}
          WHEN instr(NEW.value,'uploadId')>0 BEGIN
            ${claimRows}
            UPDATE social_media_files SET revision=revision+1 WHERE id IN (
              SELECT value FROM json_tree(NEW.value) WHERE key='uploadId'
            )${insertBump};
          END;`);
      await this.store.db.exec(`CREATE TRIGGER ${table}_media_after_update AFTER UPDATE ON ${table}
          WHEN instr(NEW.value,'uploadId')>0 OR instr(OLD.value,'uploadId')>0 BEGIN
            DELETE FROM social_media_claims WHERE owner_kind=${oldKind} AND owner_id=OLD.id AND claim_id='durable';
            ${claimRows}
            UPDATE social_media_files SET revision=revision+1 WHERE id IN (
              SELECT value FROM json_tree(NEW.value) WHERE key='uploadId'
              UNION SELECT value FROM json_tree(OLD.value) WHERE key='uploadId'
            ) AND (
              id NOT IN (SELECT value FROM json_tree(NEW.value) WHERE key='uploadId')
              OR id NOT IN (SELECT value FROM json_tree(OLD.value) WHERE key='uploadId')
            );
          END;`);
      await this.store.db.exec(`CREATE TRIGGER ${table}_media_after_delete AFTER DELETE ON ${table}
          WHEN instr(OLD.value,'uploadId')>0 BEGIN
            DELETE FROM social_media_claims WHERE owner_kind=${oldKind} AND owner_id=OLD.id AND claim_id='durable';
            UPDATE social_media_files SET revision=revision+1 WHERE id IN (
              SELECT value FROM json_tree(OLD.value) WHERE key='uploadId'
            )${deleteBump};
          END;`);
    }
    await this.store.db
      .prepare("INSERT OR REPLACE INTO social_media_meta(key,value) VALUES ('triggers',?)")
      .run(MEDIA_TRIGGER_VERSION);
  }

  async upload(scope: MediaCustodyScope, base64: string, format: "image" | "document") {
    // Reject oversized text before decoding it: 4 base64 characters carry 3 bytes.
    if (base64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
      throw new Error(
        format === "document"
          ? "Upload a complete PDF document up to 5 MiB."
          : "Upload a JPEG/PNG image up to 5 MiB.",
      );
    const bytes = Buffer.from(base64, "base64");
    if (
      format === "document" &&
      (!bytes.length ||
        bytes.length > MAX_UPLOAD_BYTES ||
        !/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(bytes.subarray(0, 10).toString("ascii")) ||
        !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii")))
    )
      throw new Error("Upload a complete PDF document up to 5 MiB.");
    if (
      format === "image" &&
      (!bytes.length ||
        bytes.length > MAX_UPLOAD_BYTES ||
        !(
          (bytes[0] === 0xff && bytes[1] === 0xd8) ||
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ))
    )
      throw new Error("Upload a JPEG/PNG image up to 5 MiB.");
    const uploadId = randomUUID();
    await this.registerManagedUpload(scope, uploadId, bytes);
    return { uploadId, managed: { mediaId: uploadId, uploadClaimId: uploadId, revision: 1 } };
  }

  /** New owned files only. Failure leaves unregistered bytes intact, never adopts legacy files. */
  async registerManagedUpload(
    scope: MediaCustodyScope,
    id: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !scope.accountId)
      throw new Error("Invalid managed media identity.");
    const rootPath = join(this.directory, "media");
    await mkdir(rootPath, { recursive: true, mode: 0o700 });
    const root = await realpath(rootPath);
    const path = join(root, id);
    // "wx" proves this call created the file, so a failed registration may remove it.
    const file = await open(path, "wx+", 0o600);
    let registered = false;
    try {
      await file.writeFile(bytes);
      await file.sync();
      const stat = await file.stat({ bigint: true });
      const digest = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let offset = 0;
      for (;;) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        digest.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (
        BigInt(offset) !== stat.size ||
        after.size !== stat.size ||
        after.mtimeNs !== stat.mtimeNs ||
        after.ino !== stat.ino ||
        after.dev !== stat.dev
      )
        throw new Error("Managed media changed during registration.");
      await this.store.transaction(async () => {
        await this.store.db
          .prepare("INSERT INTO social_media_files VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            scope.accountId,
            path,
            root,
            stat.dev === 0n ? null : String(stat.dev),
            stat.ino === 0n ? null : String(stat.ino),
            digest.digest("hex"),
            "active",
            1,
            null,
          );
        await this.store.db
          .prepare("INSERT INTO social_media_claims VALUES (?,?,?,?,?)")
          .run(id, "upload", scope.accountId, id, "active");
      });
      registered = true;
    } finally {
      await file.close();
      if (!registered)
        await rm(path, { force: true }).catch((error) =>
          console.error("Social media orphan cleanup failed:", error),
        );
    }
  }

  private async mutate(
    scope: MediaCustodyScope,
    mediaId: string,
    expectedRevision: number,
    action: () => Promise<void>,
  ): Promise<number> {
    return await this.store.transaction(async () => {
      const file = await this.store.db
        .prepare("SELECT account_id,state,revision FROM social_media_files WHERE id=?")
        .get(mediaId);
      if (!file || file.account_id !== scope.accountId)
        throw new Error("Managed media is unavailable for this owner.");
      if (file.state !== "active") throw new Error("Managed media is not active.");
      if (Number(file.revision) !== expectedRevision)
        throw new Error("Managed media revision changed.");
      await action();
      await this.store.db
        .prepare("UPDATE social_media_files SET revision=revision+1 WHERE id=?")
        .run(mediaId);
      return expectedRevision + 1;
    });
  }

  async editorOperation(
    scope: MediaCustodyScope,
    action: "claim" | "transfer" | "releaseLogical",
    input: Record<string, unknown>,
  ) {
    const mediaId = String(input.mediaId ?? ""),
      editorId = String(input.editorId ?? ""),
      requestId = String(input.requestId ?? "");
    if (action === "claim" && input.inspect === true) {
      if (!/^[a-f0-9-]{36}$/.test(mediaId)) throw new Error("Invalid managed media identity.");
      const row = await this.store.db
        .prepare("SELECT account_id,state,revision FROM social_media_files WHERE id=?")
        .get(mediaId);
      if (!row) return { mediaId, managed: false, revision: 0 };
      if (row.account_id !== scope.accountId || row.state !== "active")
        throw new Error("Managed media is unavailable for this owner.");
      return { mediaId, managed: true, revision: Number(row.revision) };
    }
    const expectedRevision = Number(input.expectedRevision);
    if (
      !/^[a-f0-9-]{36}$/.test(mediaId) ||
      !/^[a-f0-9-]{36}$/.test(editorId) ||
      !/^[a-f0-9-]{36}$/.test(requestId) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    )
      throw new Error("Invalid managed media claim request.");
    const signature = JSON.stringify([action, mediaId, editorId, expectedRevision]);
    return this.store.transaction(async () => {
      const receipt = await this.store.db
        .prepare(
          "SELECT signature,result FROM social_media_operations WHERE scope=? AND request_id=?",
        )
        .get(scope.accountId, requestId);
      if (receipt) {
        if (receipt.signature !== signature) throw new Error("Media request ID was already used.");
        return JSON.parse(String(receipt.result)) as {
          mediaId: string;
          editorId: string;
          revision: number;
        };
      }
      const editor = { ownerKind: "editor", ownerId: scope.accountId, claimId: editorId };
      const revision =
        action === "transfer"
          ? await this.claimOwnerTransfer(
              scope,
              mediaId,
              { ownerKind: "upload", ownerId: scope.accountId, claimId: mediaId },
              editor,
              expectedRevision,
            )
          : action === "claim"
            ? await this.claim(scope, mediaId, editor, expectedRevision)
            : await this.releaseLogicalClaim(scope, mediaId, editor, expectedRevision);
      const result = { mediaId, editorId, revision };
      await this.store.db
        .prepare("INSERT INTO social_media_operations VALUES (?,?,?,?)")
        .run(scope.accountId, requestId, signature, JSON.stringify(result));
      return result;
    });
  }

  async claim(
    scope: MediaCustodyScope,
    mediaId: string,
    claim: MediaClaim,
    expectedRevision: number,
  ): Promise<number> {
    return this.retain(scope, mediaId, claim, expectedRevision);
  }

  async retain(
    scope: MediaCustodyScope,
    mediaId: string,
    claim: MediaClaim,
    expectedRevision: number,
  ): Promise<number> {
    return this.mutate(scope, mediaId, expectedRevision, async () => {
      if (!claim.ownerKind || !claim.ownerId || !claim.claimId)
        throw new Error("Invalid media claim.");
      await this.store.db
        .prepare(`INSERT INTO social_media_claims VALUES (?,?,?,?,?)
        ON CONFLICT(media_id,owner_kind,owner_id,claim_id) DO UPDATE SET state='active'`)
        .run(mediaId, claim.ownerKind, claim.ownerId, claim.claimId, "active");
    });
  }

  async releaseLogicalClaim(
    scope: MediaCustodyScope,
    mediaId: string,
    claim: MediaClaim,
    expectedRevision: number,
  ): Promise<number> {
    return this.mutate(scope, mediaId, expectedRevision, async () => {
      const result = await this.store.db
        .prepare(`UPDATE social_media_claims SET state='released'
        WHERE media_id=? AND owner_kind=? AND owner_id=? AND claim_id=? AND state='active'`)
        .run(mediaId, claim.ownerKind, claim.ownerId, claim.claimId);
      if (Number(result.changes) !== 1) throw new Error("Active media claim not found.");
    });
  }

  async claimOwnerTransfer(
    scope: MediaCustodyScope,
    mediaId: string,
    from: MediaClaim,
    to: MediaClaim,
    expectedRevision: number,
  ): Promise<number> {
    return this.mutate(scope, mediaId, expectedRevision, async () => {
      if (!to.ownerKind || !to.ownerId || !to.claimId) throw new Error("Invalid media claim.");
      const result = await this.store.db
        .prepare(`UPDATE social_media_claims SET state='released'
        WHERE media_id=? AND owner_kind=? AND owner_id=? AND claim_id=? AND state='active'`)
        .run(mediaId, from.ownerKind, from.ownerId, from.claimId);
      if (Number(result.changes) !== 1) throw new Error("Active media claim not found.");
      await this.store.db
        .prepare(`INSERT INTO social_media_claims VALUES (?,?,?,?,?)
        ON CONFLICT(media_id,owner_kind,owner_id,claim_id) DO UPDATE SET state='active'`)
        .run(mediaId, to.ownerKind, to.ownerId, to.claimId, "active");
    });
  }
}
