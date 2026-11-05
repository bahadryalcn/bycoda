import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import type { HostStore } from "../store";
import type { MediaCustodyScope } from "./media-custody";

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
  constructor(
    private readonly store: HostStore,
    private readonly directory: string,
  ) {}

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
