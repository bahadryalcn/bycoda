import { createHash, randomUUID } from "node:crypto";
import { type HostSessionSummary } from "../../src/features/connections/model/protocol";
import { snapshotWeight } from "../../src/features/connections/model/snapshotWeight";
import { crewSessionRuns } from "../crews/crew-managed-session";
import { branchCache } from "../git/git-actions";
import { withSessionWaits } from "../sessions/session-waits";
import type { ServerBindings } from "./bindings";
export async function createSessionListRuntime(
  dependencies: Pick<
    ServerBindings,
    "engine" | "desktopWatch" | "desktop" | "catchUp" | "tasks" | "providers" | "pullRequestWatch"
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
    const { store } = dependencies.engine;
    const session = await store.sessionStateMetadata(id);
    if (!session) throw new Error("Session not found on this machine");
    if (session.authorityGeneration !== undefined)
      await store.assertAuthority(id, session.authorityGeneration);
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
    const readKnown = () =>
      dependencies.engine.store.db
        .prepare("SELECT source_key, epoch FROM session_read_sources WHERE session_id=?")
        .get(id);
    // The steady state is a match; only a changed source takes the write lock.
    const stored = await readKnown();
    const epoch =
      stored && stored.source_key === source
        ? String(stored.epoch)
        : await dependencies.engine.store.transaction(async () => {
            const known = await readKnown();
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
  // Compared field by field: the decoration inputs are primitives, so an identity check
  // is exact and avoids serializing the same project fields for every row.
  const decoratedSummaries = new WeakMap<
    HostSessionSummary,
    {
      name: string;
      cwd: string;
      branch: string | undefined;
      crewRunId: string | undefined;
      value: HostSessionSummary;
    }
  >();
  /** Other registered ids of the same folder (legacy path spellings), in a stable order. */
  // The registry changes only in addProject, which moves projectRegistryVersion; reuse the
  // loaded rows until then instead of scanning every registered project on each poll.
  let registeredProjects: { version: number; rows: { id: string; cwd: string }[] } | undefined;
  const siblingProjectIds = async (project: { id: string; cwd: string }) => {
    const { store } = dependencies.engine;
    const version = store.projectRegistryVersion;
    let registry = registeredProjects;
    if (registry?.version !== version) {
      registry = { version, rows: await store.projects() };
      registeredProjects = registry;
    }
    return registry.rows
      .filter(
        (other) => other.id !== project.id && dependencies.desktop.samePath(other.cwd, project.cwd),
      )
      .map((other) => other.id)
      .sort();
  };
  const buildProjectSessionList = async (
    project: { id: string; name: string; cwd: string },
    local: HostSessionSummary[],
    etagPrefix: string,
    wakeSources: ReturnType<ServerBindings["pullRequestWatch"]["wakeSources"]>,
    siblingIds?: string[],
  ) => {
    const projectId = project.id;
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
    // The Host directory lists one entry per folder, so sessions stored under a
    // legacy duplicate id of the same folder stay visible through the listed id.
    const folderSessions = (
      await Promise.all(
        [projectId, ...(siblingIds ?? (await siblingProjectIds(project)))].map((id) =>
          dependencies.engine.store.summaries(id),
        ),
      )
    ).flat();
    const own = folderSessions.map((session) =>
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
    // Read with the list, so a new crew assignment shows on the next rebuild (a session
    // change or the PROJECT_LIST_SAFETY_MS refresh), like branch names.
    const crews = await crewSessionRuns(dependencies.engine.store, projectId);
    const decorated = summaries.map((session) => {
      const crewRunId = crews.get(session.id);
      const branch = branches.get(session.cwd ?? project.cwd);
      const cached = decoratedSummaries.get(session);
      if (
        cached &&
        cached.name === project.name &&
        cached.cwd === project.cwd &&
        cached.branch === branch &&
        cached.crewRunId === crewRunId
      )
        return cached.value;
      const value = {
        ...session,
        repo: project.name,
        branch: branch || undefined,
        // Desktop rows keep the desktop's path spelling; compare normalized paths.
        worktreeCwd:
          session.cwd && !dependencies.desktop.samePath(session.cwd, project.cwd)
            ? session.cwd
            : undefined,
        ...(crewRunId ? { crewRunId } : {}),
      };
      decoratedSummaries.set(session, {
        name: project.name,
        cwd: project.cwd,
        branch,
        crewRunId,
        value,
      });
      return value;
    });
    const list = withSessionWaits(decorated, wakeSources);
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
        .update("\0")
        .update(JSON.stringify([...crews]))
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
  const allProjectSessions = async (projectId: string) => {
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
    const cached = projectChangeCache.get(projectId);
    const paths = cached?.paths ?? [];
    // Reuse the lightweight branch TTL/singleflight even when this checkout
    // is not watched. Caching a full list must not extend branch staleness
    // from the branch cache's 4s contract to the 30s safety fallback.
    const branches = await Promise.all(paths.map(async (cwd) => await branchCache.get(cwd)));
    // Watches live outside the store: their wake sources key the cached list too.
    const wakeSources = dependencies.pullRequestWatch.wakeSources(projectId);
    // One project-table read per list, shared with the build. Every store call is a
    // turn in the single database queue that approvals and authorization also wait in.
    const siblingIds = await siblingProjectIds(project);
    const prefix = [
      dependencies.engine.store.projectVersion(projectId),
      siblingIds.map((id) => `${id}:${dependencies.engine.store.projectVersion(id)}`).join(","),
      project.cwd,
      project.name,
      local.fingerprint,
      JSON.stringify([...wakeSources]),
    ].join("\0");
    // Desktop metadata/live state and watched Git revisions are scoped to the
    // actual rows/paths of this project, not global activity on the machine.
    const key = `${prefix}\0${JSON.stringify(paths.map((cwd, index) => [cwd, branches[index]]))}`;
    const current = projectChangeCache.get(projectId);
    if (current && current.key === key && now - current.refreshed < PROJECT_LIST_SAFETY_MS) {
      // A hit makes the entry the newest, so the byte budget and count cap evict
      // the least recently used project, not the one polled on every request.
      projectChangeCache.delete(projectId);
      projectChangeCache.set(projectId, current);
      const result = await current.promise;
      await currentProject();
      return result;
    }
    const promise = buildProjectSessionList(
      project,
      local.sessions,
      prefix,
      wakeSources,
      siblingIds,
    );
    const entry = { key, refreshed: now, paths, bytes: 0, promise };
    // Map.set on an existing key keeps its old position; delete first so a rebuilt
    // project is also the newest entry.
    projectChangeCache.delete(projectId);
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
    // The byte budget above bounds memory; the count only has to cover every project a
    // phone polls, or each poll evicts the next group's lists and rebuilds all of them.
    while (projectChangeCache.size > 512)
      projectChangeCache.delete(projectChangeCache.keys().next().value!);
    const result = await promise;
    await currentProject();
    return result;
  };
  const projectSessionList = async (projectId: string, parentSessionId?: string) => {
    const result = await allProjectSessions(projectId);
    const list = result.list.filter((row) =>
      parentSessionId === undefined
        ? !row.delegationParent
        : row.delegationParent?.parentSessionId === parentSessionId,
    );
    const etag = createHash("sha256")
      .update(result.etag)
      .update("\0")
      .update(JSON.stringify(parentSessionId ?? null))
      .digest("base64url");
    return { ...result, list, etag };
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
