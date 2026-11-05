import { createHash, randomUUID } from "node:crypto";
import type { HostStore } from "../../store";

export type ProjectObservationSource = "task" | "session" | "goal";
export type ProjectPageScope = {
  threadId: string;
  projectId: string;
  consumer: string;
  source: ProjectObservationSource;
};
export type GoalObservationProjectProof = { projectId: string; cwd: string };

/** Internal discovery only. Caller must capture every returned project through the real Native privacy authority before disclosure. */
export async function collectGoalObservationProjects(
  store: HostStore,
  targetProjectId: string,
): Promise<GoalObservationProjectProof[]> {
  const rows = await store.db
    .prepare(
      "SELECT value FROM goals WHERE EXISTS (SELECT 1 FROM json_each(goals.value,'$.projectIds') WHERE json_each.value=?) LIMIT 2049",
    )
    .all(targetProjectId);
  if (rows.length > 2048) throw new Error("Goal observation scope is unavailable.");
  const ids = new Set<string>([targetProjectId]);
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(String(row.value));
    } catch {
      throw new Error("Goal observation scope is unavailable.");
    }
    const projects = (value as { projectIds?: unknown })?.projectIds;
    if (
      !Array.isArray(projects) ||
      projects.length > 2048 ||
      projects.some((id) => typeof id !== "string" || !id || id.length > 300)
    )
      throw new Error("Goal observation scope is unavailable.");
    for (const id of projects as string[]) ids.add(id);
    if (ids.size > 2048) throw new Error("Goal observation scope is unavailable.");
  }
  const result: GoalObservationProjectProof[] = [];
  for (const projectId of [...ids].sort()) {
    const project = await store.db.prepare("SELECT cwd FROM projects WHERE id=?").get(projectId);
    if (typeof project?.cwd !== "string" || !project.cwd || project.cwd.length > 4096)
      throw new Error("Goal observation scope is unavailable.");
    result.push({ projectId, cwd: project.cwd });
  }
  return result;
}

/** Receipts cover one canonical Host source, never the entire project. */
export class AssistantObservationProjectPages {
  readonly ready: Promise<void>;
  constructor(private readonly store: HostStore) {
    this.ready = store.ready.then(() =>
      store.db.exec(`CREATE TABLE IF NOT EXISTS assistant_observation_project_pages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL, consumer TEXT NOT NULL,
      source TEXT NOT NULL, fingerprint TEXT NOT NULL, count INTEGER NOT NULL,
      covered INTEGER NOT NULL, offered INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`),
    );
  }
  private async baseline(scope: ProjectPageScope, proofs?: readonly GoalObservationProjectProof[]) {
    let goalProjects: GoalObservationProjectProof[] | undefined;
    if (scope.source === "goal") {
      if (!proofs || !Array.isArray(proofs))
        throw new Error("Goal observation scope is unavailable.");
      goalProjects = await collectGoalObservationProjects(this.store, scope.projectId);
      const captured = [...proofs]
        .map((proof) => ({ projectId: proof.projectId, cwd: proof.cwd }))
        .sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
      if (JSON.stringify(captured) !== JSON.stringify(goalProjects))
        throw new Error("Goal observation scope is unavailable.");
    }
    const table =
      scope.source === "task" ? "tasks" : scope.source === "goal" ? "goals" : "sessions";
    const triggers = await this.store.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?,?)",
      )
      .get(
        ...["insert", "update", "delete", "scope_removed"].map(
          (suffix) => `assistant_observe_${table}_${suffix}`,
        ),
      );
    if (Number(triggers?.count) !== 4)
      throw new Error("Observation source producer is unavailable.");
    const predicate =
      scope.source === "task"
        ? "json_extract(value,'$.projectId')=?"
        : scope.source === "goal"
          ? "EXISTS (SELECT 1 FROM json_each(goals.value,'$.projectIds') WHERE json_each.value=?)"
          : "project_id=?";
    const rows = await this.store.db
      .prepare(`SELECT source.id,revision.version FROM (SELECT id FROM ${table} WHERE ${predicate} ORDER BY id LIMIT 2049) source
      LEFT JOIN assistant_observation_source_revisions revision ON revision.source=? AND revision.source_id=source.id ORDER BY source.id`)
      .all(scope.projectId, scope.source);
    const entries = rows.map((row) => ({
      source: scope.source,
      sourceId: String(row.id),
      revision: row.version == null ? null : `db:${row.version}`,
    }));
    const floor = Number(
      (await this.store.db
        .prepare("SELECT sequence FROM assistant_observation_floor WHERE id=1")
        .get())!.sequence,
    );
    return {
      entries,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([entries, floor, goalProjects]))
        .digest("hex"),
    };
  }
  async page(
    scope: ProjectPageScope,
    offset: number,
    snapshotId: string | undefined,
    valid: () => boolean,
    proofs?: readonly GoalObservationProjectProof[],
  ) {
    await this.ready;
    if (
      !["task", "session", "goal"].includes(scope.source) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid observation source page.");
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Observation source access changed.");
      await this.store.db
        .prepare("DELETE FROM assistant_observation_project_pages WHERE expires_at<=?")
        .run(Date.now());
      const { entries, fingerprint } = await this.baseline(scope, proofs);
      if (!valid()) throw new Error("Observation source access changed.");
      const base = {
        kind: "current-metadata-baseline",
        coverage: [scope.source],
        missingChangesReplayed: false,
      };
      if (entries.length > 2048 || Buffer.byteLength(JSON.stringify(entries), "utf8") > 524288)
        return {
          complete: false,
          value: {
            ...base,
            reason: "Source baseline exceeds the 2048-row or 512 KiB metadata limit.",
          },
        };
      let id = snapshotId;
      let state = id
        ? await this.store.db
            .prepare("SELECT * FROM assistant_observation_project_pages WHERE id=?")
            .get(id)
        : undefined;
      if (!id && offset === 0) {
        if (
          Number(
            (await this.store.db
              .prepare("SELECT COUNT(*) AS count FROM assistant_observation_project_pages")
              .get())!.count,
          ) >= 1000
        )
          throw new Error("Observation baseline receipt capacity reached.");
        id = randomUUID();
        await this.store.db
          .prepare("INSERT INTO assistant_observation_project_pages VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            scope.threadId,
            scope.projectId,
            scope.consumer,
            scope.source,
            fingerprint,
            entries.length,
            -1,
            -1,
            Date.now() + 3600000,
          );
        state = await this.store.db
          .prepare("SELECT * FROM assistant_observation_project_pages WHERE id=?")
          .get(id);
      }
      if (
        !id ||
        !state ||
        state.thread_id !== scope.threadId ||
        state.project_id !== scope.projectId ||
        state.consumer !== scope.consumer ||
        state.source !== scope.source ||
        state.fingerprint !== fingerprint ||
        Number(state.count) !== entries.length
      )
        throw new Error("Observation baseline changed or expired. Restart at offset zero.");
      const covered = Number(state.covered),
        offered = Number(state.offered);
      if (offset === entries.length && covered === entries.length) {
        await this.store.db
          .prepare("DELETE FROM assistant_observation_project_pages WHERE id=?")
          .run(id);
        if (!valid()) throw new Error("Observation source access changed.");
        return { complete: true, value: { ...base, entries: [], pagesDelivered: true } };
      }
      if (
        offset !== Math.max(0, covered) ||
        (offered !== covered && offered !== Math.min(offset + 8, entries.length))
      )
        throw new Error("Observation baseline pages must be delivered in order.");
      const end = Math.min(offset + 8, entries.length);
      await this.store.db
        .prepare("UPDATE assistant_observation_project_pages SET offered=? WHERE id=?")
        .run(end, id);
      if (!valid()) throw new Error("Observation source access changed.");
      return {
        complete: false,
        value: {
          ...base,
          snapshotId: id,
          offset,
          nextOffset: end,
          entries: entries.slice(offset, end),
        },
      };
    });
  }
  async delivered(
    scope: ProjectPageScope,
    snapshotId: string,
    offset: number,
    nextOffset: number,
    valid: () => boolean,
    proofs?: readonly GoalObservationProjectProof[],
  ) {
    await this.ready;
    return this.store.transaction(async () => {
      if (!valid()) throw new Error("Observation source access changed.");
      const row = await this.store.db
        .prepare("SELECT * FROM assistant_observation_project_pages WHERE id=?")
        .get(snapshotId);
      if (
        !row ||
        row.thread_id !== scope.threadId ||
        row.project_id !== scope.projectId ||
        row.consumer !== scope.consumer ||
        row.source !== scope.source ||
        Number(row.expires_at) <= Date.now()
      )
        throw new Error("Observation baseline receipt expired.");
      const current = await this.baseline(scope, proofs);
      if (!valid()) throw new Error("Observation source access changed.");
      if (current.fingerprint !== row.fingerprint)
        throw new Error("Observation baseline changed. Restart at offset zero.");
      if (Number(row.covered) === nextOffset && Number(row.offered) === nextOffset) return;
      if (
        Math.max(0, Number(row.covered)) !== offset ||
        Number(row.offered) !== nextOffset ||
        nextOffset < offset ||
        (nextOffset === offset && Number(row.count) !== 0)
      )
        throw new Error("Observation baseline page was not offered.");
      await this.store.db
        .prepare("UPDATE assistant_observation_project_pages SET covered=? WHERE id=?")
        .run(nextOffset, snapshotId);
      if (!valid()) throw new Error("Observation source access changed.");
    });
  }
}
