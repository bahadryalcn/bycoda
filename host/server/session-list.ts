import { createHash, randomUUID } from "node:crypto";
import { type HostSessionSummary } from "../../src/features/connections/model/protocol";
import { snapshotWeight } from "../../src/features/connections/model/snapshotWeight";
import { branchCache } from "../git/git-actions";
import type { ServerBindings } from "./bindings";
export async function createSessionListRuntime(
  dependencies: Pick<
    ServerBindings,
    "engine" | "desktopWatch" | "desktop" | "catchUp" | "tasks" | "providers"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createSessionListRuntime>>) => void,
) {
  publish({
    get sessionListEpoch() {
      return sessionListEpoch;
    },
    get sourceInvalidations() {
      return sourceInvalidations;
    },
    get settleSourceInvalidation() {
      return settleSourceInvalidation;
    },
    get invalidateSessionSource() {
      return invalidateSessionSource;
    },
    get sessionSourceKey() {
      return sessionSourceKey;
    },
    get sessionSourceEpoch() {
      return sessionSourceEpoch;
    },
    get decoratedSummaries() {
      return decoratedSummaries;
    },
    get buildProjectSessionList() {
      return buildProjectSessionList;
    },
    get projectChangeCache() {
      return projectChangeCache;
    },
    get PROJECT_LIST_SAFETY_MS() {
      return PROJECT_LIST_SAFETY_MS;
    },
    get taskChangeEtag() {
      return taskChangeEtag;
    },
    get projectSessionList() {
      return projectSessionList;
    },
    get projectChangeSnapshot() {
      return projectChangeSnapshot;
    },
  });

  const sessionListEpoch = randomUUID();
  await dependencies.engine.store.db
    .prepare(`CREATE TABLE IF NOT EXISTS session_read_sources (
    session_id TEXT PRIMARY KEY, source_key TEXT NOT NULL, epoch TEXT NOT NULL
  )`)
    .run();
  // Only pending source transitions are held in memory. Persisted epochs prevent
  // an A-B-A owner change from reviving an earlier revision baseline.
  type SourceInvalidation = {
    epoch: string;
    pending: Promise<void>;
    started: boolean;
    previous?: SourceInvalidation;
    run: () => Promise<void>;
  };
  const sourceInvalidations = new Map<string, SourceInvalidation>();
  const settleSourceInvalidation = async (id: string, entry: SourceInvalidation) => {
    try {
      await entry.pending;
    } catch {
      if (!entry.started && entry.previous) {
        await settleSourceInvalidation(id, entry.previous);
        if (!entry.started) entry.pending = entry.run();
        return settleSourceInvalidation(id, entry);
      }
      // A lost acknowledgement is not proof of failure. Reconcile the exact
      // transition token; never issue another update for an uncertain outcome.
      const row = await dependencies.engine.store.db
        .prepare("SELECT epoch FROM session_read_sources WHERE session_id=?")
        .get(id);
      if (!row || row.epoch !== entry.epoch)
        throw new Error("Session read source transition is unresolved; retry reconciliation");
    }
    if (sourceInvalidations.get(id) === entry) sourceInvalidations.delete(id);
  };
  const invalidateSessionSource = (id: string) => {
    const previous = sourceInvalidations.get(id);
    const epoch = randomUUID();
    const entry: SourceInvalidation = {
      epoch,
      started: false,
      previous,
      pending: Promise.resolve(),
      run: async () => {
        entry.started = true;
        await dependencies.engine.store.db.storeScope(async () => {
          await dependencies.engine.store.db
            .prepare(`INSERT INTO session_read_sources (session_id, source_key, epoch)
          VALUES (?, '', ?) ON CONFLICT(session_id) DO UPDATE SET source_key='', epoch=excluded.epoch`)
            .run(id, epoch);
        });
      },
    };
    const pending = (previous ? settleSourceInvalidation(id, previous) : Promise.resolve()).then(
      entry.run,
    );
    entry.pending = pending;
    sourceInvalidations.set(id, entry);
    void pending.then(
      () => {
        if (sourceInvalidations.get(id) === entry) sourceInvalidations.delete(id);
      },
      (error) => {
        console.error("Session read source invalidation failed:", error);
      },
    );
  };
  const sessionSourceKey = async (id: string): Promise<string> => {
    const watch = await dependencies.desktopWatch(id);
    if (watch) {
      const overlay = dependencies.desktop.live.overlay(id);
      return createHash("sha256")
        .update(JSON.stringify([sessionListEpoch, "desktop", overlay?.sourceEpoch ?? null]))
        .digest("hex");
    }
    const session = await dependencies.engine.store.session(id);
    return createHash("sha256")
      .update(
        JSON.stringify([
          sessionListEpoch,
          "host",
          session.authorityGeneration ?? null,
          session.createdAt ?? null,
        ]),
      )
      .digest("hex");
  };
  const sessionSourceEpoch = async (id: string): Promise<string> => {
    while (sourceInvalidations.has(id))
      await settleSourceInvalidation(id, sourceInvalidations.get(id)!);
    const source = await sessionSourceKey(id);
    const epoch = await dependencies.engine.store.transaction(async () => {
      const known = await dependencies.engine.store.db
        .prepare("SELECT source_key, epoch FROM session_read_sources WHERE session_id=?")
        .get(id);
      if (known && known.source_key === source) return String(known.epoch);
      await dependencies.engine.store.db
        .prepare(`INSERT INTO session_read_sources (session_id, source_key, epoch)
        VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET
        source_key=excluded.source_key, epoch=excluded.epoch
        WHERE session_read_sources.source_key <> excluded.source_key`)
        .run(id, source, randomUUID());
      const row = await dependencies.engine.store.db
        .prepare("SELECT epoch FROM session_read_sources WHERE session_id=?")
        .get(id);
      if (!row) throw new Error("Session read source is unavailable");
      return String(row.epoch);
    });
    if (source !== (await sessionSourceKey(id)))
      throw new Error("Session read owner changed; retry");
    return epoch;
  };
  const decoratedSummaries = new WeakMap<
    HostSessionSummary,
    { key: string; value: HostSessionSummary }
  >();
  const buildProjectSessionList = async (
    projectId: string,
    local: HostSessionSummary[],
    etagPrefix: string,
  ) => {
    const project = await dependencies.engine.store.project(projectId);
    const stamps = new Map(local.map((session) => [session.id, session]));
    for (const adopted of await dependencies.engine.store.adopted(projectId)) {
      const stamp = stamps.get(adopted.id);
      // Only a desktop copy newer than the one the host caught up with needs
      // the session loaded; a running one is not pulled yet.
      if (
        adopted.projectId === projectId &&
        stamp &&
        stamp.status !== "running" &&
        stamp.updatedAt > adopted.desktopUpdatedAt
      )
        await dependencies.catchUp(adopted.id, {
          updatedAt: stamp.updatedAt,
          running: false,
        });
    }
    const own = (await dependencies.engine.store.summaries(projectId)).map((session) =>
      session.status !== "running" && stamps.get(session.id)?.status === "running"
        ? { ...session, status: "running" as const }
        : session,
    );
    const known = new Set(own.map((session) => session.id));
    const summaries = [...own, ...local.filter((session) => !known.has(session.id))].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const paths = [...new Set(summaries.map((session) => session.cwd ?? project.cwd))];
    const branches = new Map(
      await Promise.all(paths.map(async (cwd) => [cwd, await branchCache.get(cwd)] as const)),
    );
    const list = summaries.map((session) => {
      const decorationKey = JSON.stringify([
        project.name,
        project.cwd,
        branches.get(session.cwd ?? project.cwd),
      ]);
      const cached = decoratedSummaries.get(session);
      if (cached?.key === decorationKey) return cached.value;
      const value = {
        ...session,
        repo: project.name,
        branch: branches.get(session.cwd ?? project.cwd) || undefined,
        // Desktop rows keep the desktop's path spelling; compare normalized paths.
        worktreeCwd:
          session.cwd && !dependencies.desktop.samePath(session.cwd, project.cwd)
            ? session.cwd
            : undefined,
      };
      decoratedSummaries.set(session, { key: decorationKey, value });
      return value;
    });
    const branchKey = JSON.stringify(paths.map((cwd) => [cwd, branches.get(cwd)]));
    return {
      list,
      // A process epoch prevents version reuse after restart; each input revision
      // already participates in the key. Do not serialize a full history to hash it.
      etag: createHash("sha256")
        .update(sessionListEpoch)
        .update(etagPrefix)
        .update("\0")
        .update(branchKey)
        .digest("base64url"),
      bytes: snapshotWeight(list),
      paths,
      branchKey,
    };
  };
  const projectChangeCache = new Map<
    string,
    {
      key: string;
      refreshed: number;
      paths: string[];
      bytes: number;
      promise: Promise<{ etag: string; list: HostSessionSummary[]; bytes: number }>;
    }
  >();
  /** A rebuild is only needed when an input moved; the safety TTL bounds what no
   * signal reports (an unwatched checkout switching branch). */
  const PROJECT_LIST_SAFETY_MS = 30_000;
  const taskChangeEtag = async () => await dependencies.tasks.changeEtag();
  const projectSessionList = async (projectId: string) => {
    const now = Date.now();
    const project = await dependencies.engine.store.project(projectId);
    const currentProject = async () => {
      if ((await dependencies.engine.store.project(projectId)).cwd !== project.cwd)
        throw new Error("Project changed while reading its sessions.");
    };
    const local = await dependencies.desktop.listSnapshotAsync(
      project.cwd,
      projectId,
      dependencies.providers,
    );
    await currentProject();
    const cached = projectChangeCache.get(projectId);
    const paths = cached?.paths ?? [];
    // Reuse the lightweight branch TTL/singleflight even when this checkout
    // is not watched. Caching a full list must not extend branch staleness
    // from the branch cache's 4s contract to the 30s safety fallback.
    const branches = await Promise.all(paths.map(async (cwd) => await branchCache.get(cwd)));
    await currentProject();
    const prefix = [
      dependencies.engine.store.projectVersion(projectId),
      project.cwd,
      project.name,
      local.fingerprint,
    ].join("\0");
    // Desktop metadata/live state and watched Git revisions are scoped to the
    // actual rows/paths of this project, not global activity on the machine.
    const key = `${prefix}\0${JSON.stringify(paths.map((cwd, index) => [cwd, branches[index]]))}`;
    const current = projectChangeCache.get(projectId);
    if (current && current.key === key && now - current.refreshed < PROJECT_LIST_SAFETY_MS) {
      const result = await current.promise;
      await currentProject();
      return result;
    }
    const promise = buildProjectSessionList(projectId, local.sessions, prefix);
    const entry = { key, refreshed: now, paths, bytes: 0, promise };
    projectChangeCache.set(projectId, entry);
    void promise.then(
      ({ bytes, paths, branchKey }) => {
        if (projectChangeCache.get(projectId) !== entry) return;
        entry.paths = paths;
        entry.key = `${prefix}\0${branchKey}`;
        entry.bytes = bytes;
        let total = 0;
        for (const value of projectChangeCache.values()) total += value.bytes;
        while (total > 16 * 1024 * 1024) {
          const first = projectChangeCache.keys().next().value;
          if (first === undefined) break;
          total -= projectChangeCache.get(first)!.bytes;
          projectChangeCache.delete(first);
        }
      },
      () => {
        // A failed read is never cached as an empty project.
        if (projectChangeCache.get(projectId) === entry) projectChangeCache.delete(projectId);
      },
    );
    while (projectChangeCache.size > 32)
      projectChangeCache.delete(projectChangeCache.keys().next().value!);
    const result = await promise;
    await currentProject();
    return result;
  };
  const projectChangeSnapshot = async (projectId: string) => {
    const { list, etag } = await projectSessionList(projectId);
    return { etag, sessions: list };
  };
  return {
    sessionListEpoch,
    sourceInvalidations,
    settleSourceInvalidation,
    invalidateSessionSource,
    sessionSourceKey,
    sessionSourceEpoch,
    decoratedSummaries,
    buildProjectSessionList,
    projectChangeCache,
    PROJECT_LIST_SAFETY_MS,
    taskChangeEtag,
    projectSessionList,
    projectChangeSnapshot,
  };
}
