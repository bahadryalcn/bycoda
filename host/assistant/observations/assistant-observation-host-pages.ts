import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../../store";
export type HostCrewScope = { threadId: string; generation: string; consumer: string };

/** Coarse Host-owned global Crew invalidation, under a separately held Native privacy capture. */
export class AssistantObservationHostPages {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_observation_host_pages(id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, generation TEXT NOT NULL, consumer TEXT NOT NULL, fingerprint TEXT NOT NULL, count INTEGER NOT NULL, covered INTEGER NOT NULL, offered INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assistant_observation_host_coverage(thread_id TEXT NOT NULL, generation TEXT NOT NULL, consumer TEXT NOT NULL, PRIMARY KEY(thread_id,generation,consumer));
  `),
    );
  }
  async covered(scope: HostCrewScope) {
    await this.ready;
    return !!(await this.store.db
      .prepare(
        "SELECT 1 FROM assistant_observation_host_coverage WHERE thread_id=? AND generation=? AND consumer=?",
      )
      .get(scope.threadId, scope.generation, scope.consumer));
  }
  private async baseline() {
    const triggers = await this.store.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN ('assistant_observe_global_crew_insert','assistant_observe_global_crew_update','assistant_observe_global_crew_delete')",
      )
      .get();
    if (Number(triggers?.count) !== 3)
      throw new Error("Host Crew observation producer unavailable.");
    const row = await this.store.db
      .prepare("SELECT value FROM metadata WHERE key='crews.v2.state'")
      .get();
    let entries: { source: string; sourceId: string; revision: string | null }[] = [];
    if (row) {
      const raw = String(row.value);
      if (Buffer.byteLength(raw, "utf8") > 524288)
        throw new Error("Host Crew baseline exceeds limit.");
      const state: unknown = JSON.parse(raw);
      if (!state || typeof state !== "object" || Array.isArray(state))
        throw new Error("Host Crew baseline is invalid.");
      const data = state as Record<string, unknown>;
      if (
        (data.definitions !== undefined && !Array.isArray(data.definitions)) ||
        (data.agents !== undefined && !Array.isArray(data.agents))
      )
        throw new Error("Host Crew baseline is invalid.");
      const global = [
        ...((data.definitions as unknown[]) ?? []),
        ...((data.agents as unknown[]) ?? []),
      ].some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          throw new Error("Host Crew baseline is invalid.");
        const projectId = (item as { projectId?: unknown }).projectId;
        if (projectId !== undefined && projectId !== null && typeof projectId !== "string")
          throw new Error("Host Crew baseline is invalid.");
        return projectId == null || projectId === "";
      });
      if (global) {
        const revision = await this.store.db
          .prepare(
            "SELECT version FROM assistant_observation_source_revisions WHERE source='crew' AND source_id='crews.global.v1'",
          )
          .get();
        entries = [
          {
            source: "crew",
            sourceId: "crews.global.v1",
            revision: revision ? `db:${revision.version}` : null,
          },
        ];
      }
    }
    const floor = Number(
      (await this.store.db
        .prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1")
        .get())!.sequence,
    );
    return {
      entries,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([entries, floor]))
        .digest("hex"),
    };
  }
  async page(
    scope: HostCrewScope,
    offset: number,
    snapshotId: string | undefined,
    valid: () => boolean,
  ) {
    await this.ready;
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Host Crew observation access changed.");
      await this.store.db
        .prepare("DELETE FROM assistant_observation_host_pages WHERE expires_at<=?")
        .run(Date.now());
      const { entries, fingerprint } = await this.baseline();
      let id = snapshotId,
        state = id
          ? await this.store.db
              .prepare("SELECT * FROM assistant_observation_host_pages WHERE id=?")
              .get(id)
          : undefined;
      if (!id && offset === 0) {
        if (
          Number(
            (await this.store.db
              .prepare("SELECT COUNT(*) AS count FROM assistant_observation_host_pages")
              .get())!.count,
          ) >= 1000
        )
          throw new Error("Host Crew baseline capacity reached.");
        id = randomUUID();
        await this.store.db
          .prepare("INSERT INTO assistant_observation_host_pages VALUES(?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            scope.threadId,
            scope.generation,
            scope.consumer,
            fingerprint,
            entries.length,
            -1,
            -1,
            Date.now() + 3600000,
          );
        state = await this.store.db
          .prepare("SELECT * FROM assistant_observation_host_pages WHERE id=?")
          .get(id);
      }
      if (
        !id ||
        !state ||
        state.thread_id !== scope.threadId ||
        state.generation !== scope.generation ||
        state.consumer !== scope.consumer ||
        state.fingerprint !== fingerprint ||
        Number(state.count) !== entries.length
      )
        throw new Error("Host Crew baseline changed or expired.");
      const covered = Number(state.covered),
        offered = Number(state.offered),
        base = {
          kind: "current-metadata-baseline",
          coverage: ["crew"],
          missingChangesReplayed: false,
        };
      if (offset === entries.length && covered === entries.length) {
        await this.store.db
          .prepare("INSERT OR IGNORE INTO assistant_observation_host_coverage VALUES(?,?,?)")
          .run(scope.threadId, scope.generation, scope.consumer);
        await this.store.db
          .prepare("DELETE FROM assistant_observation_host_pages WHERE id=?")
          .run(id);
        return { complete: true, value: { ...base, entries: [], pagesDelivered: true } };
      }
      if (offset !== Math.max(0, covered) || (offered !== covered && offered !== entries.length))
        throw new Error("Host Crew baseline pages must be delivered in order.");
      await this.store.db
        .prepare("UPDATE assistant_observation_host_pages SET offered=? WHERE id=?")
        .run(entries.length, id);
      if (!valid()) throw new Error("Host Crew observation access changed.");
      return {
        complete: false,
        value: { ...base, snapshotId: id, offset, nextOffset: entries.length, entries },
      };
    });
  }
  async delivered(
    scope: HostCrewScope,
    snapshotId: string,
    offset: number,
    nextOffset: number,
    valid: () => boolean,
  ) {
    await this.ready;
    await this.store.transaction(async () => {
      if (!valid()) throw new Error("Host Crew observation access changed.");
      const row = await this.store.db
        .prepare("SELECT * FROM assistant_observation_host_pages WHERE id=?")
        .get(snapshotId);
      if (
        !row ||
        row.thread_id !== scope.threadId ||
        row.generation !== scope.generation ||
        row.consumer !== scope.consumer ||
        Number(row.expires_at) <= Date.now()
      )
        throw new Error("Host Crew baseline expired.");
      if ((await this.baseline()).fingerprint !== row.fingerprint)
        throw new Error("Host Crew baseline changed.");
      if (Number(row.covered) === nextOffset && Number(row.offered) === nextOffset) return;
      if (
        Math.max(0, Number(row.covered)) !== offset ||
        Number(row.offered) !== nextOffset ||
        nextOffset < offset ||
        (nextOffset === offset && Number(row.count) !== 0)
      )
        throw new Error("Host Crew baseline page was not offered.");
      await this.store.db
        .prepare("UPDATE assistant_observation_host_pages SET covered=? WHERE id=?")
        .run(nextOffset, snapshotId);
      if (!valid()) throw new Error("Host Crew observation access changed.");
    });
  }
}
