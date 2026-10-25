import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import type { HostStore } from "./store";
import { attachmentPath, collectAttachmentGarbage } from "./attachments";
export const ATTACHMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
/** Complete offline drafts retain non-expiring claims. Only explicitly managed
 * uploads are candidates; files made by older clients remain unknown/pinned. */
export class AttachmentOwnership {
  private timer?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<string[]>;
  private closed = false;
  private cursor = "";
  readonly ready: Promise<void>;
  constructor(
    private readonly store: HostStore,
    private readonly now = Date.now,
  ) {
    this.ready = this.store.db.scope(async () => await this.initialize());
    void this.ready.catch(() => undefined);
  }
  private async initialize(): Promise<void> {
    await this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS attachment_ownership_files (
        id TEXT PRIMARY KEY, legacy INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachment_ownership_claims (
        id TEXT NOT NULL, principal TEXT NOT NULL, owner_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL, claim_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(id, principal, owner_id, claim_id)
      );
      CREATE INDEX IF NOT EXISTS attachment_ownership_claim_expiry
        ON attachment_ownership_claims(id, updated_at);
      CREATE INDEX IF NOT EXISTS attachment_ownership_claim_owner
        ON attachment_ownership_claims(principal, owner_id, id, claim_id);
    `);
  }
  private parse(input: Record<string, unknown>): {
    ids: string[];
    ownerId: string;
    claimId: string;
  } {
    if (
      typeof input.ownerId !== "string" ||
      input.ownerId.length > 128 ||
      !input.ownerId.trim() ||
      hasControlCharacter(input.ownerId)
    )
      throw new Error("Invalid attachment owner ID");
    if (
      !Array.isArray(input.ids) ||
      input.ids.length > 20 ||
      input.ids.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid attachment ownership IDs");
    if (
      input.claimId !== undefined &&
      (typeof input.claimId !== "string" ||
        input.claimId.length > 128 ||
        (input.claimId.length > 0 && !input.claimId.trim()) ||
        hasControlCharacter(input.claimId))
    )
      throw new Error("Invalid attachment claim ID");
    const ids = [...new Set(input.ids as string[])].map((id) => {
      attachmentPath(this.store, id);
      if (id !== id.toLowerCase())
        throw new Error("Managed attachment IDs must use lowercase UUIDs");
      return id;
    });
    return {
      ids,
      ownerId: input.ownerId,
      claimId: typeof input.claimId === "string" ? input.claimId : "",
    };
  }
  async claim(principal: string, input: Record<string, unknown>): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      const { ids, ownerId, claimId } = this.parse(input);
      const actor = createHash("sha256").update(principal).digest("hex");
      const now = this.now();
      await this.store.transaction(async () => {
        for (const id of ids) {
          // A new ownership claim cannot retroactively establish the owners of an
          // existing legacy file, even when its bytes happen to match.
          const preexisting = !!lstatSync(attachmentPath(this.store, id), {
            throwIfNoEntry: false,
          });
          await this.store.db
            .prepare(
              "INSERT INTO attachment_ownership_files(id,legacy,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
            )
            .run(id, preexisting ? 1 : 0, now);
          await this.store.db
            .prepare(
              "INSERT INTO attachment_ownership_claims VALUES(?,?,?,?,?) ON CONFLICT(id,principal,owner_id,claim_id) DO UPDATE SET updated_at=excluded.updated_at",
            )
            .run(id, actor, ownerId, now, claimId);
        }
      });
    });
  }
  /** Called before status/upload; absent ownership is a permanent compatibility pin. */
  async touch(principal: string, input: Record<string, unknown>): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      const id = String(input.id ?? "");
      attachmentPath(this.store, id);
      if (input.ownerId !== undefined || input.claimId !== undefined)
        await this.claim(principal, { ids: [id], ownerId: input.ownerId, claimId: input.claimId });
      else
        await this.store.db
          .prepare(
            "INSERT INTO attachment_ownership_files(id,legacy,updated_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET legacy=1,updated_at=excluded.updated_at",
          )
          .run(id.toLowerCase(), this.now());
    });
  }
  async uploaded(input: Record<string, unknown>, offset: number): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      if (offset !== input.size) return;
      const id = String(input.id ?? "");
      const info = lstatSync(attachmentPath(this.store, id), { throwIfNoEntry: false });
      if (info?.isFile() && info.size === input.size)
        await this.store.db
          .prepare("UPDATE attachment_ownership_files SET complete=1,updated_at=? WHERE id=?")
          .run(this.now(), id.toLowerCase());
    });
  }
  async release(principal: string, input: Record<string, unknown>): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      const { ids, ownerId, claimId } = this.parse(input);
      const actor = createHash("sha256").update(principal).digest("hex");
      await this.store.transaction(async () => {
        for (const id of ids) {
          const removed = await this.store.db
            .prepare(
              "DELETE FROM attachment_ownership_claims WHERE id=? AND principal=? AND owner_id=? AND claim_id=?",
            )
            .run(id, actor, ownerId, claimId);
          if (removed.changes)
            await this.store.db
              .prepare("UPDATE attachment_ownership_files SET updated_at=? WHERE id=?")
              .run(this.now(), id);
        }
      });
    });
  }
  /** Read-only recovery inventory for one authenticated device and owner. A
   * queue response can establish claims whose response never reached its client. */
  async claims(
    principal: string,
    input: Record<string, unknown>,
  ): Promise<{
    claims: Array<{
      id: string;
      claimId: string;
    }>;
    next?: {
      id: string;
      claimId: string;
    };
  }> {
    return this.store.db.scope(async () => {
      await this.ready;
      const { ownerId } = this.parse({ ids: [], ownerId: input.ownerId });
      let afterId = "",
        afterClaimId = "";
      if (input.after !== undefined) {
        if (!input.after || typeof input.after !== "object" || Array.isArray(input.after))
          throw new Error("Invalid attachment claims cursor");
        const cursor = input.after as Record<string, unknown>;
        if (typeof cursor.id !== "string" || typeof cursor.claimId !== "string")
          throw new Error("Invalid attachment claims cursor");
        try {
          this.parse({ ids: [cursor.id], ownerId, claimId: cursor.claimId });
        } catch {
          throw new Error("Invalid attachment claims cursor");
        }
        afterId = cursor.id;
        afterClaimId = cursor.claimId;
      }
      const actor = createHash("sha256").update(principal).digest("hex");
      const rows = await this.store.db
        .prepare(`
      SELECT id,claim_id FROM attachment_ownership_claims
      WHERE principal=? AND owner_id=? AND (id,claim_id)>(?,?)
      ORDER BY id,claim_id LIMIT 201
    `)
        .all(actor, ownerId, afterId, afterClaimId);
      const claims = rows
        .slice(0, 200)
        .map((row) => ({ id: String(row.id), claimId: String(row.claim_id) }));
      return { claims, ...(rows.length > 200 ? { next: claims.at(-1)! } : {}) };
    });
  }
  async validateExposure(input: Record<string, unknown>): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      if (input.ownerId !== undefined || input.claimId !== undefined)
        this.parse({ ids: [], ownerId: input.ownerId, claimId: input.claimId });
    });
  }
  /** A queue response may become an offline draft before its server row is
   * removed by another device. Establish that ownership before exposing IDs. */
  async expose(
    principal: string,
    ids: readonly string[],
    input: Record<string, unknown>,
  ): Promise<void> {
    return this.store.db.scope(async () => {
      await this.ready;
      const unique = [...new Set(ids)];
      await this.store.transaction(async () => {
        if (input.ownerId !== undefined || input.claimId !== undefined) {
          this.parse({ ids: [], ownerId: input.ownerId, claimId: input.claimId });
          for (let at = 0; at < unique.length; at += 20)
            await this.claim(principal, {
              ids: unique.slice(at, at + 20),
              ownerId: input.ownerId,
              claimId: input.claimId,
            });
        } else {
          // Older clients do not report when a cached queue becomes a local
          // draft. Their unknown references must conservatively pin known files.
          const pin = this.store.db.prepare(
            "UPDATE attachment_ownership_files SET legacy=1,updated_at=? WHERE id=?",
          );
          for (const id of unique) await pin.run(this.now(), id.toLowerCase());
        }
      });
    });
  }
  /** Startup/hourly sweeps are bounded, non-overlapping and never touch legacy files. */
  async collect(): Promise<string[]> {
    if (this.closed) return [];
    if (this.sweeping) return this.sweeping;
    const operation = this.collectScoped();
    this.sweeping = operation;
    const clear = () => {
      if (this.sweeping === operation) this.sweeping = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }
  private async collectScoped(): Promise<string[]> {
    return this.store.db.scope(async () => {
      await this.ready;
      if (this.closed) return Promise.resolve([]);
      const now = this.now();
      const page = async (after: string) =>
        await this.store.db
          .prepare("SELECT id FROM attachment_ownership_files WHERE id>? ORDER BY id LIMIT 1000")
          .all(after);
      let after = this.cursor;
      let rows = await page(after);
      if (!rows.length && after) {
        after = "";
        rows = await page(after);
      }
      const end = rows.length ? String(rows.at(-1)!.id) : after;
      // Bound eligibility work as well as deletion: an archive of non-expiring
      // offline claims must not force a synchronous full-ledger query per hour.
      const eligible = new Set(
        (
          await this.store.db
            .prepare(`
      SELECT file.id FROM attachment_ownership_files file
      WHERE file.id>? AND file.id<=? AND file.legacy=0 AND file.updated_at<=? AND NOT EXISTS (
        SELECT 1 FROM attachment_ownership_claims claim WHERE claim.id=file.id
          AND (file.complete=1 OR claim.updated_at>?)
      ) ORDER BY file.id LIMIT 200
    `)
            .all(after, end, now - ATTACHMENT_GRACE_MS, now - ATTACHMENT_GRACE_MS)
        ).map((row) => String(row.id)),
      );
      this.cursor = eligible.size === 200 ? Array.from(eligible).at(-1)! : end;
      const operation = collectAttachmentGarbage(
        this.store,
        async () => {
          if (this.closed) return undefined;
          // Claims may have arrived while the reference scan yielded. Recheck
          // synchronously in the same final phase as reference scanning/deletion.
          // Query exact IDs individually so the 200-item page never hides a claim.
          const protectedIds = new Set<string>();
          for (const id of eligible) {
            const file = await this.store.db
              .prepare(`SELECT 1 FROM attachment_ownership_files file
          WHERE file.id=? AND file.legacy=0 AND file.updated_at<=? AND NOT EXISTS (
            SELECT 1 FROM attachment_ownership_claims claim WHERE claim.id=file.id AND (file.complete=1 OR claim.updated_at>?)
          )`)
              .get(id, now - ATTACHMENT_GRACE_MS, now - ATTACHMENT_GRACE_MS);
            if (!file) protectedIds.add(id);
          }
          return protectedIds;
        },
        now,
        ATTACHMENT_GRACE_MS,
        eligible,
        async (id) => {
          await this.store.db.prepare("DELETE FROM attachment_ownership_claims WHERE id=?").run(id);
          await this.store.db.prepare("DELETE FROM attachment_ownership_files WHERE id=?").run(id);
        },
        () => !this.closed,
      );
      return operation;
    });
  }
  async start(): Promise<void> {
    await this.ready;
    if (this.timer || this.closed) return;
    const sweep = () =>
      this.store.db.outsideScope(() => {
        void this.collect().catch(
          (error: unknown) =>
            !this.closed &&
            console.error(
              "Attachment maintenance deferred:",
              (error instanceof Error ? error.message : String(error)).slice(0, 300),
            ),
        );
      });
    this.timer = this.store.db.outsideScope(() => setInterval(sweep, SWEEP_INTERVAL_MS));
    this.timer.unref?.();
    sweep();
  }
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
