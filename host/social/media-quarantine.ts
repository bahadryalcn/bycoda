import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { HostStore } from "../store";
import { sanitizeSocialError } from "./core/social-helpers";
import type { MediaCustodyScope, SocialMediaCustody } from "./media-custody";

const UNOWNED_UPLOAD_MS = 7 * 86_400_000;
const QUARANTINE_RETENTION_MS = 30 * 86_400_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;
const SWEEP_BATCH = 50;

type ManagedRow = {
  id: string;
  account_id: string;
  root: string;
  path: string;
  volume: string | null;
  file_id: string | null;
  sha256: string;
  state: string;
  revision: number;
  quarantine_path: string | null;
};

/** Quarantine is recoverable; unknown or replaced files are never unlinked. */
export class SocialMediaQuarantine {
  private nextSweepAt = performance.now() + SWEEP_INTERVAL_MS;

  constructor(
    private readonly store: HostStore,
    private readonly directory: string,
    private readonly custody: SocialMediaCustody,
  ) {}

  /** Runs the retention sweep at most hourly; called from the Social tick. */
  async sweepIfDue(): Promise<void> {
    const now = performance.now();
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    await this.sweep();
  }

  /**
   * Bounded retention. An active upload with no live owner (a referencing record or job holds
   * a durable claim; an editor holds a live claim) is quarantined after 7 days, releasing its
   * owner-less upload claim first. Quarantined bytes are purged after 30 days, and only when
   * the file identity still verifies; otherwise they stay for review.
   */
  async sweep(): Promise<void> {
    // Without a completed reference rebuild, a referenced upload could look unowned.
    try {
      await this.custody.reconciled();
    } catch (error) {
      console.error(
        "Social media retention skipped this pass; reference rebuild incomplete:",
        error,
      );
      return;
    }
    const unowned = (await this.store.db
      .prepare(
        `SELECT * FROM social_media_files f
        WHERE f.state='active' AND f.volume IS NOT NULL AND f.file_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM social_media_claims c
            WHERE c.media_id=f.id AND c.owner_kind!='upload' AND c.state='active')
        ORDER BY f.rowid LIMIT ?`,
      )
      .all(SWEEP_BATCH)) as ManagedRow[];
    for (const row of unowned) {
      try {
        const age = await ageMs(row.path, "mtimeMs");
        if (age === undefined || age < UNOWNED_UPLOAD_MS) continue;
        const revision = await this.store.transaction(async () => {
          const current = await this.store.db
            .prepare("SELECT revision,state FROM social_media_files WHERE id=?")
            .get(row.id);
          if (!current || current.state !== "active") return undefined;
          const owned = await this.store.db
            .prepare(
              "SELECT 1 FROM social_media_claims WHERE media_id=? AND owner_kind!='upload' AND state='active' LIMIT 1",
            )
            .get(row.id);
          if (owned) return undefined;
          await this.store.db
            .prepare(
              "UPDATE social_media_claims SET state='released' WHERE media_id=? AND owner_kind='upload' AND state='active'",
            )
            .run(row.id);
          await this.store.db
            .prepare("UPDATE social_media_files SET revision=revision+1 WHERE id=?")
            .run(row.id);
          return Number(current.revision) + 1;
        });
        if (revision !== undefined)
          await this.quarantine({ accountId: row.account_id }, row.id, revision);
      } catch (error) {
        console.error("Social media retention skipped an upload:", error);
      }
    }

    const retired = (await this.store.db
      .prepare(
        "SELECT * FROM social_media_files WHERE state IN ('quarantined','purging') AND quarantine_path IS NOT NULL ORDER BY rowid LIMIT ?",
      )
      .all(SWEEP_BATCH)) as ManagedRow[];
    for (const row of retired) {
      try {
        const path = row.quarantine_path!;
        if (row.state === "quarantined") {
          // ctime moves on rename, so it dates the quarantine itself.
          const age = await ageMs(path, "ctimeMs");
          if (age === undefined || age < QUARANTINE_RETENTION_MS) continue;
          // Mark first: a crash after this point is retried as "purging" by the next sweep.
          const moved = await this.store.transaction(async () =>
            this.store.db
              .prepare(
                "UPDATE social_media_files SET state='purging',revision=revision+1 WHERE id=? AND state='quarantined' AND revision=?",
              )
              .run(row.id, row.revision),
          );
          if (Number(moved.changes) !== 1) continue;
        }
        const present = await lstat(path).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (present) {
          if (!(await this.verified(path, row))) {
            console.error("Quarantined media identity changed; retained for review.", row.id);
            continue;
          }
          await unlink(path);
        }
        await this.store.transaction(async () => {
          await this.store.db
            .prepare(
              "UPDATE social_media_files SET state='purged',revision=revision+1 WHERE id=? AND state='purging'",
            )
            .run(row.id);
        });
      } catch (error) {
        console.error(
          "Social media purge skipped a quarantined upload:",
          sanitizeSocialError(error),
        );
      }
    }
  }

  async status(scope: MediaCustodyScope, id: string) {
    const row = (await this.store.db
      .prepare("SELECT * FROM social_media_files WHERE id=? AND account_id=?")
      .get(id, scope.accountId)) as ManagedRow | undefined;
    if (!row) throw new Error("Managed media is unavailable for this owner.");
    const count = await this.store.db
      .prepare(
        "SELECT count(*) AS count FROM social_media_claims WHERE media_id=? AND state='active'",
      )
      .get(id);
    return {
      mediaId: id,
      state: row.state,
      revision: Number(row.revision),
      activeClaims: Number(count?.count ?? 0),
      identityKnown: !!row.volume && !!row.file_id,
    };
  }

  private async verified(path: string, row: ManagedRow): Promise<boolean> {
    try {
      const before = await lstat(path, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        String(before.dev) !== row.volume ||
        String(before.ino) !== row.file_id
      )
        return false;
      const handle = await open(path, "r");
      try {
        const stat = await handle.stat({ bigint: true });
        if (stat.dev !== before.dev || stat.ino !== before.ino) return false;
        const digest = createHash("sha256"),
          buffer = Buffer.allocUnsafe(65536);
        let offset = 0;
        for (;;) {
          const part = await handle.read(buffer, 0, buffer.length, offset);
          if (!part.bytesRead) break;
          digest.update(buffer.subarray(0, part.bytesRead));
          offset += part.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        return (
          BigInt(offset) === stat.size &&
          after.size === stat.size &&
          after.mtimeNs === stat.mtimeNs &&
          digest.digest("hex") === row.sha256
        );
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  async quarantine(scope: MediaCustodyScope, id: string, expectedRevision: number) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(expectedRevision))
      throw new Error("Invalid managed media request.");
    // Claims must be fully rebuilt before the active-owner check below can be trusted.
    await this.custody.reconciled();
    const row = await this.store.transaction(async () => {
      const found = (await this.store.db
        .prepare("SELECT * FROM social_media_files WHERE id=? AND account_id=?")
        .get(id, scope.accountId)) as ManagedRow | undefined;
      if (!found) throw new Error("Managed media is unavailable for this owner.");
      if (Number(found.revision) !== expectedRevision)
        throw new Error("Managed media revision changed.");
      if (found.state === "quarantined") return found;
      if (found.state !== "active" && found.state !== "quarantining")
        throw new Error("Managed media requires review.");
      if (!found.volume || !found.file_id)
        throw new Error("Managed media file identity is unknown.");
      const claim = await this.store.db
        .prepare("SELECT 1 FROM social_media_claims WHERE media_id=? AND state='active' LIMIT 1")
        .get(id);
      if (claim) throw new Error("Managed media still has active owners.");
      if (found.state === "active") {
        found.quarantine_path = join(found.root, ".quarantine", `${id}-${randomUUID()}`);
        await this.store.db
          .prepare(
            "UPDATE social_media_files SET state='quarantining',quarantine_path=?,revision=revision+1 WHERE id=?",
          )
          .run(found.quarantine_path, id);
        found.state = "quarantining";
        found.revision = Number(found.revision) + 1;
      }
      return found;
    });
    if (row.state === "quarantined") return this.status(scope, id);
    if (
      !row.quarantine_path ||
      row.path !== join(row.root, id) ||
      (await realpath(join(this.directory, "media"))) !== row.root
    )
      throw new Error("Managed media root changed; quarantine requires review.");
    const quarantineRoot = join(row.root, ".quarantine");
    if (row.quarantine_path !== join(quarantineRoot, row.quarantine_path.split(/[\\/]/).at(-1)!))
      throw new Error("Invalid quarantine path.");
    await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
    if ((await realpath(quarantineRoot)) !== quarantineRoot)
      throw new Error("Quarantine root changed.");
    if (!(await this.verified(row.quarantine_path, row))) {
      if (!(await this.verified(row.path, row)))
        throw new Error("Managed media identity changed; retained for review.");
      try {
        await lstat(row.quarantine_path);
        throw new Error("Quarantine target already exists.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.store.db.checkAuthorization();
      await rename(row.path, row.quarantine_path);
      if (!(await this.verified(row.quarantine_path, row)))
        throw new Error("Quarantine identity changed; retained for review.");
    }
    await this.store.transaction(async () => {
      const updated = await this.store.db
        .prepare(
          "UPDATE social_media_files SET state='quarantined',revision=revision+1 WHERE id=? AND account_id=? AND state='quarantining' AND revision=?",
        )
        .run(id, scope.accountId, row.revision);
      if (Number(updated.changes) !== 1)
        throw new Error("Managed media quarantine changed; retained for review.");
    });
    return this.status(scope, id);
  }
}

/** File times are absolute wall-clock instants, so a monotonic clock cannot age them. */
async function ageMs(path: string, clock: "mtimeMs" | "ctimeMs"): Promise<number | undefined> {
  try {
    return Date.now() - (await lstat(path))[clock];
  } catch {
    return undefined;
  }
}
